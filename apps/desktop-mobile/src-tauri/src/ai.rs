use crate::{ai_credentials, blocking, failure, with_active, workspace, ApiResult, AppState};
use futures_util::StreamExt;
use mozhi_core::{
    ai::{self, Config, Source},
    vault,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{Emitter, Manager, State};
use tokio::sync::watch;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Prepared {
    id: String,
    vault_id: String,
    config: Config,
    mode: String,
    question: String,
    sources: Vec<Source>,
    authorized: bool,
    history: Vec<Value>,
    revision: String,
}
#[derive(Default)]
struct Runtime {
    prepared: HashMap<String, Prepared>,
    running: HashMap<String, (String, watch::Sender<bool>)>,
    history: HashMap<String, Vec<Value>>,
}
#[derive(Clone, Default)]
pub struct AiState(Arc<Mutex<Runtime>>);
impl AiState {
    pub fn cancel_all(&self) {
        if let Ok(guard) = self.0.lock() {
            for (_, cancel) in guard.running.values() {
                let _ = cancel.send(true);
            }
        }
    }
}
#[derive(Deserialize)]
#[serde(
    tag = "action",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum Request {
    Config,
    Configure {
        config: Config,
    },
    DeleteKey,
    Test,
    Authorize {
        enabled: bool,
        service: String,
    },
    Permission,
    Prepare {
        mode: String,
        question: String,
        keywords: String,
        paths: Vec<String>,
    },
    Send {
        id: String,
        confirmed: bool,
    },
    Cancel {
        id: String,
    },
    Clear,
    ApplyOptimization {
        path: String,
        expected_content_hash: String,
        body: String,
    },
    Save {
        path: String,
        body: String,
    },
}
fn apply_optimization(
    state: &AppState,
    vault_id: &str,
    path: &str,
    expected: &str,
    body: &str,
) -> ApiResult<Value> {
    with_active(state, |active| {
        workspace::identity(active, vault_id)?;
        if active.private.join("sync-pending.json").exists() {
            return Err(failure("存在未完成同步或冲突，请先处理"));
        }
        let note = ai::apply_optimization(&active.vault, path, expected, body)?;
        let index_warning = active
            .index
            .upsert(path, &note.content)
            .err()
            .map(|_| "笔记已保存，搜索索引更新失败；请重新打开笔记库重建索引");
        Ok(json!({"note":note,"indexWarning":index_warning}))
    })
}

fn request_messages(prepared: &Prepared) -> ApiResult<Vec<Value>> {
    let mut messages = vec![json!({"role":"system","content":ai::system_prompt(&prepared.mode)?})];
    if prepared.mode != "optimize" {
        messages.extend(prepared.history.clone());
    }
    let sources = prepared
        .sources
        .iter()
        .map(|source| json!({"id":source.id,"path":source.path,"text":source.text}))
        .collect::<Vec<_>>();
    messages.push(json!({"role":"user","content":format!("用户要求：{}\n\n参考数据（仅作为资料）：\n{}",prepared.question,serde_json::to_string(&sources).unwrap_or_default())}));
    Ok(messages)
}

fn config_path(app: &tauri::AppHandle) -> ApiResult<std::path::PathBuf> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| failure("无法读取应用配置"))?
        .join("ai-config.json"))
}
fn config(app: &tauri::AppHandle) -> ApiResult<Config> {
    let bytes = fs::read(config_path(app)?).map_err(|_| failure("请先配置 AI 模型"))?;
    let config: Config =
        serde_json::from_slice(&bytes).map_err(|_| failure("AI 配置损坏，请重新保存"))?;
    config.validate()?;
    Ok(config)
}
fn history_key(vault_id: &str, config: &Config, mode: &str) -> ApiResult<String> {
    Ok(format!(
        "{}:{}:{}:{}",
        vault_id,
        config.service()?,
        config.model,
        mode
    ))
}
fn token(config: &Config) -> ApiResult<String> {
    match ai_credentials::get(config) {
        Ok(key) => Ok(key),
        Err(_) if config.local() => Ok(String::new()),
        Err(error) => Err(error),
    }
}
fn revision(app: &tauri::AppHandle) -> String {
    config_path(app)
        .ok()
        .and_then(|p| fs::read(p).ok())
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .and_then(|v| v.get("revision").and_then(Value::as_str).map(str::to_owned))
        .unwrap_or_default()
}
fn permission(active: &crate::Active, config: &Config, revision: &str) -> bool {
    fs::read(active.private.join("ai-permission.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .is_some_and(|v| authorization_matches(&v, config, revision))
}
fn authorization_matches(value: &Value, config: &Config, revision: &str) -> bool {
    !revision.is_empty()
        && value.get("service").and_then(Value::as_str) == config.service().ok().as_deref()
        && value.get("revision").and_then(Value::as_str) == Some(revision)
}

async fn completion(
    config: &Config,
    key: &str,
    messages: Vec<Value>,
    cancelled: watch::Receiver<bool>,
    emit: impl FnMut(&str),
) -> ApiResult<String> {
    completion_with_timeout(
        config,
        key,
        messages,
        cancelled,
        emit,
        Duration::from_secs(120),
    )
    .await
}
async fn completion_with_timeout(
    config: &Config,
    key: &str,
    messages: Vec<Value>,
    mut cancelled: watch::Receiver<bool>,
    mut emit: impl FnMut(&str),
    timeout: Duration,
) -> ApiResult<String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(timeout)
        .build()
        .map_err(|_| failure("无法初始化模型连接"))?;
    let mut request = client
        .post(config.validate()?.as_str())
        .json(&json!({"model":config.model,"messages":messages,"stream":true}));
    if !key.is_empty() {
        request = request.bearer_auth(key);
    }
    let work = async {
        let response = request
            .send()
            .await
            .map_err(|_| failure("模型连接失败，请检查地址与网络"))?;
        let status = response.status();
        if !status.is_success() {
            return Err(failure(match status.as_u16() {
                401 | 403 => "模型认证失败，请检查 API Key 与权限",
                429 => "模型服务限流，请稍后手动重试",
                300..=399 => "模型地址返回重定向，请配置最终服务地址",
                _ => "模型服务返回错误",
            }));
        }
        let mut stream = response.bytes_stream();
        let mut parser = ai::SseParser::default();
        let mut result = String::new();
        let mut received = 0;
        let mut finished = false;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| failure("模型响应中断"))?;
            received += chunk.len();
            if received > 2 * 1024 * 1024 {
                return Err(failure("模型响应超过大小限制"));
            }
            for data in parser.feed(&chunk)? {
                if data == "[DONE]" {
                    if result.is_empty() {
                        return Err(failure("模型返回空内容"));
                    }
                    return Ok(result);
                }
                let value: Value =
                    serde_json::from_str(&data).map_err(|_| failure("模型流式响应格式无效"))?;
                if value.get("error").is_some() {
                    return Err(failure("模型服务返回错误"));
                }
                if value
                    .pointer("/choices/0/finish_reason")
                    .and_then(Value::as_str)
                    .is_some_and(|reason| reason != "stop")
                {
                    return Err(failure("模型响应未完成，请手动重试"));
                }
                if value
                    .pointer("/choices/0/finish_reason")
                    .is_some_and(|reason| reason == "stop")
                {
                    finished = true;
                }
                if let Some(text) = value
                    .pointer("/choices/0/delta/content")
                    .and_then(Value::as_str)
                {
                    result.push_str(text);
                    if result.len() > 1024 * 1024 {
                        return Err(failure("生成内容超过大小限制"));
                    }
                    emit(text);
                }
            }
        }
        if result.is_empty() {
            Err(failure("模型未返回兼容的流式内容"))
        } else if finished {
            Ok(result)
        } else {
            Err(failure("模型响应未完成，请手动重试"))
        }
    };
    tokio::select! {
        _=cancelled.changed()=>Err(failure("已停止生成")),
        _=tokio::time::sleep(timeout)=>Err(failure("模型请求超时，请手动重试")),
        result=work=>result,
    }
}

#[tauri::command]
pub async fn ai_key(app: tauri::AppHandle) -> ApiResult<bool> {
    let config = config(&app)?;
    let (send, receive) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = send.send(ai_credentials::prompt(&config));
    })
    .map_err(|_| failure("无法打开原生凭据窗口"))?;
    blocking(move || receive.recv().map_err(|_| failure("凭据输入未完成"))?).await
}

#[tauri::command]
pub async fn ai_request(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    ai_state: State<'_, AiState>,
    vault_id: String,
    request: Request,
) -> ApiResult<Value> {
    let state = state.inner().clone();
    let runtime = ai_state.inner().clone();
    if let Request::Send { id, confirmed } = request {
        let prepared = runtime
            .0
            .lock()
            .map_err(|_| failure("AI 状态不可用"))?
            .prepared
            .remove(&id)
            .ok_or_else(|| failure("参考预览已失效，请重新准备"))?;
        if prepared.vault_id != vault_id {
            return Err(failure("笔记库已切换"));
        }
        if config(&app)? != prepared.config || revision(&app) != prepared.revision {
            return Err(failure("模型配置已更改，请重新准备"));
        }
        let key = token(&prepared.config)?;
        let (cancel, receiver) = watch::channel(false);
        let history_key = history_key(&vault_id, &prepared.config, &prepared.mode)?;
        with_active(&state, |active| {
            workspace::identity(active, &vault_id)?;
            if config(&app)? != prepared.config || revision(&app) != prepared.revision {
                return Err(failure("模型配置已更改，请重新准备"));
            }
            if !confirmed && !permission(active, &prepared.config, &prepared.revision) {
                return Err(failure("请确认发送参考片段"));
            }
            ai::validate_sources(&active.vault, &prepared.sources)?;
            if prepared.mode == "optimize" {
                for source in &prepared.sources {
                    ai::check_optimization_draft(&active.vault, &active.vault.read(&source.path)?)?;
                }
            }
            let mut guard = runtime.0.lock().map_err(|_| failure("AI 状态不可用"))?;
            if guard.running.values().any(|(vault, _)| vault == &vault_id) {
                return Err(failure("请先停止当前生成"));
            }
            guard.running.insert(id.clone(), (vault_id.clone(), cancel));
            Ok(())
        })?;
        let messages = request_messages(&prepared)?;
        let outcome = completion(&prepared.config, &key, messages, receiver, |text| {
            let _ = app.emit(
                "ai_delta",
                json!({"requestId":id,"vaultId":vault_id,"text":text}),
            );
        })
        .await;
        runtime
            .0
            .lock()
            .map_err(|_| failure("AI 状态不可用"))?
            .running
            .remove(&id);
        let text = outcome?;
        // Only responses from the still-active vault enter its in-memory session.
        with_active(&state, |active| workspace::identity(active, &vault_id))?;
        if prepared.mode == "optimize" {
            let text = ai::optimization_body(&text)?;
            return Ok(json!({"text":text,"sources":prepared.sources}));
        }
        let mut guard = runtime.0.lock().map_err(|_| failure("AI 状态不可用"))?;
        let history = guard.history.entry(history_key).or_default();
        history.push(json!({"role":"user","content":prepared.question.chars().take(4000).collect::<String>()}));
        history.push(
            json!({"role":"assistant","content":text.chars().take(4000).collect::<String>()}),
        );
        while history.len() > 6 {
            history.drain(..2);
        }
        Ok(json!({"text":text,"sources":prepared.sources}))
    } else if let Request::Test = request {
        let config = config(&app)?;
        let key = token(&config)?;
        let (_sender, receiver) = watch::channel(false);
        completion(
            &config,
            &key,
            vec![json!({"role":"user","content":"Reply OK."})],
            receiver,
            |_| {},
        )
        .await?;
        Ok(json!(true))
    } else {
        blocking(move || match request {
            Request::ApplyOptimization { path, expected_content_hash, body } =>
                apply_optimization(&state, &vault_id, &path, &expected_content_hash, &body),
            Request::Config => {
                let value = config(&app).ok();
                let has_key = value
                    .as_ref()
                    .is_some_and(|c| ai_credentials::get(c).is_ok());
                Ok(json!({"config":value,"hasKey":has_key}))
            }
            Request::Configure { config } => {
                config.validate()?;
                let _active = state.0.lock().map_err(|_| failure("笔记库状态不可用"))?;
                let path = config_path(&app)?;
                fs::create_dir_all(path.parent().ok_or_else(|| failure("配置路径无效"))?)
                    .map_err(|_| failure("无法创建 AI 配置"))?;
                let old=self::config(&app).ok();
                let old_revision=revision(&app);
                let revision=if !old_revision.is_empty()&&old.as_ref().is_some_and(|c|c.service().ok()==config.service().ok()){old_revision}else{std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos().to_string()};
                runtime.cancel_all();
                vault::atomic_write(&path, &serde_json::to_vec(&json!({"baseUrl":config.base_url,"model":config.model,"revision":revision})).unwrap())?;
                Ok(json!(true))
            }
            Request::DeleteKey => {
                ai_credentials::delete(&config(&app)?)?;
                Ok(json!(true))
            }
            Request::Cancel { id } => {
                let guard = runtime.0.lock().map_err(|_| failure("AI 状态不可用"))?;
                if let Some((vault, cancel)) = guard.running.get(&id) {
                    if vault == &vault_id {
                        let _ = cancel.send(true);
                    }
                }
                Ok(Value::Null)
            }
            Request::Clear => {
                let mut guard = runtime.0.lock().map_err(|_| failure("AI 状态不可用"))?;
                guard
                    .history
                    .retain(|key, _| !key.starts_with(&format!("{vault_id}:")));
                guard.prepared.retain(|_, p| p.vault_id != vault_id);
                Ok(Value::Null)
            }
            other => with_active(&state, |active| {
                workspace::identity(active, &vault_id)?;
                match other {
                    Request::Permission => Ok(json!(permission(active, &config(&app)?,&revision(&app)))),
                    Request::Authorize { enabled,service } => {
                        let config=config(&app)?;
                        if enabled&&config.base_url!=service{return Err(failure("模型地址已更改，请重新确认授权"));}
                        let value=if enabled{json!({"service":config.service()?,"revision":revision(&app)})}else{Value::Null};
                        vault::atomic_write(
                            &active.private.join("ai-permission.json"),
                            &serde_json::to_vec(&value).unwrap(),
                        )?;
                        Ok(json!(enabled))
                    }
                    Request::Prepare {
                        mode,
                        question,
                        keywords,
                        paths,
                    } => {
                        ai::system_prompt(&mode)?;
                        if question.len() > 64000 || keywords.len() > 64000 || paths.len() > 100 {
                            return Err(failure("请求内容过多"));
                        }
                        let config = config(&app)?;
                        let mut selected = paths;
                        if mode == "ask" {
                            let query = if keywords.trim().is_empty() {
                                &question
                            } else {
                                &keywords
                            };
                            selected.extend(
                                active
                                    .index
                                    .query(query, "")?
                                    .hits
                                    .into_iter()
                                    .take(10)
                                    .map(|h| h.path),
                            );
                        }
                        let sources = if mode == "optimize" {
                            ai::optimization_context(&active.vault, &selected, &question)?
                        } else { ai::context(&active.vault, &selected)? };
                        if mode != "generate" && sources.is_empty() {
                            return Err(failure("未找到参考笔记，请调整关键词或手动选择笔记"));
                        }
                        let id = format!(
                            "{}-{}",
                            std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_nanos(),
                            ai::source_digest(&sources)
                        );
                        let mut guard = runtime.0.lock().map_err(|_| failure("AI 状态不可用"))?;
                        let history=if mode == "optimize" { Vec::new() } else { guard.history.get(&history_key(&vault_id,&config,&mode)?).cloned().unwrap_or_default() };
                        let rev=revision(&app);
                        let prepared = Prepared {
                            id: id.clone(),
                            vault_id: vault_id.clone(),
                            config: config.clone(),
                            mode,
                            question,
                            sources,
                            authorized: permission(active, &config,&rev),
                            history,
                            revision:rev,
                        };
                        guard.prepared.retain(|_, p| p.vault_id != vault_id);
                        guard.prepared.insert(id, prepared.clone());
                        Ok(json!(prepared))
                    }
                    Request::Save { path, body } => {
                        if active.private.join("sync-pending.json").exists() {
                            return Err(failure("存在未完成同步或冲突，请先处理"));
                        }
                        ai::save_generated(&active.vault, &path, &body)?;
                        let index_warning = active.vault.read(&path)
                            .and_then(|note| active.index.upsert(&path, &note.content))
                            .err().map(|_| "笔记已保存，搜索索引更新失败；请重新打开笔记库重建索引");
                        Ok(json!({"path":path,"indexWarning":index_warning}))
                    }
                    _ => Err(failure("AI 操作无效")),
                }
            }),
        })
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
    };
    #[test]
    fn optimization_apply_rejects_other_vaults_and_sync_before_writing() {
        let root = tempfile::tempdir().unwrap();
        let private = tempfile::tempdir().unwrap();
        fs::write(root.path().join("a.md"), "original").unwrap();
        let vault = vault::Vault::open(root.path(), private.path()).unwrap();
        let note = vault.read("a.md").unwrap();
        let state = AppState::default();
        *state.0.lock().unwrap() = Some(crate::Active {
            demo: false,
            vault,
            index: mozhi_core::search::SearchIndex::open(&private.path().join("index.db")).unwrap(),
            id: "test".into(),
            private: private.path().to_path_buf(),
            _watcher: None,
            recovery_warnings: vec![],
        });
        assert!(apply_optimization(&state, "other", "a.md", &note.content_hash, "new").is_err());
        state.1.store(true, std::sync::atomic::Ordering::SeqCst);
        assert!(apply_optimization(&state, "test", "a.md", &note.content_hash, "new").is_err());
        state.1.store(false, std::sync::atomic::Ordering::SeqCst);
        fs::write(private.path().join("sync-pending.json"), "{}").unwrap();
        assert!(apply_optimization(&state, "test", "a.md", &note.content_hash, "new").is_err());
        assert_eq!(
            fs::read_to_string(root.path().join("a.md")).unwrap(),
            "original"
        );
        fs::remove_file(private.path().join("sync-pending.json")).unwrap();
        assert!(apply_optimization(&state, "test", "a.md", &note.content_hash, "new").is_ok());
        assert_eq!(fs::read_to_string(root.path().join("a.md")).unwrap(), "new");
    }
    #[test]
    fn optimization_request_contains_only_target_body_and_current_instructions() {
        let prepared = Prepared {
            id: "test".into(),
            vault_id: "vault".into(),
            config: Config {
                base_url: "https://example.test/v1".into(),
                model: "test".into(),
            },
            mode: "optimize".into(),
            question: "改善结构".into(),
            sources: vec![Source {
                id: 1,
                path: "笔记.md".into(),
                text: "完整正文".into(),
                content_hash: "private-hash".into(),
                truncated: false,
            }],
            authorized: false,
            history: vec![json!({"role":"user","content":"other mode secret"})],
            revision: "revision".into(),
        };
        let messages = request_messages(&prepared).ok().unwrap();
        assert_eq!(messages.len(), 2);
        let text = serde_json::to_string(&messages).unwrap();
        assert!(text.contains("改善结构"));
        assert!(text.contains("完整正文"));
        assert!(!text.contains("other mode secret"));
        assert!(!text.contains("private-hash"));
        assert!(text.contains("不要输出 front matter"));
    }
    fn mock(
        status: u16,
        body: &'static str,
        delay: Duration,
    ) -> (Config, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut request = Vec::new();
            let mut buffer = [0; 4096];
            loop {
                let n = stream.read(&mut buffer).unwrap();
                if n == 0 {
                    break;
                }
                request.extend_from_slice(&buffer[..n]);
                let text = String::from_utf8_lossy(&request);
                if let Some(end) = text.find("\r\n\r\n") {
                    let length = text[..end]
                        .lines()
                        .find_map(|line| {
                            line.to_lowercase()
                                .strip_prefix("content-length:")
                                .and_then(|s| s.trim().parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    if request.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            std::thread::sleep(delay);
            let response=format!("HTTP/1.1 {status} Test\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nLocation: http://127.0.0.1:1/steal\r\nConnection: close\r\n\r\n{body}",body.len());
            let _ = stream.write_all(response.as_bytes());
            String::from_utf8(request).unwrap()
        });
        (
            Config {
                base_url: format!("http://127.0.0.1:{port}/prefix/v1/"),
                model: "mock-model".into(),
            },
            handle,
        )
    }
    const RESPONSE: &str =
        "data: {\"choices\":[{\"delta\":{\"content\":\"测试 [1]\"}}]}\r\n\r\ndata: [DONE]\n\n";
    #[tokio::test(flavor = "current_thread")]
    async fn truncated_response_is_rejected_even_with_done_marker() {
        let (config, server) = mock(200,
            "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"},\"finish_reason\":\"length\"}]}\n\ndata: [DONE]\n\n",
            Duration::ZERO);
        let (_sender, receiver) = watch::channel(false);
        let error = completion(&config, "", vec![], receiver, |_| {})
            .await
            .err()
            .unwrap();
        assert!(error.message.contains("未完成"));
        server.join().unwrap();
    }
    #[tokio::test(flavor = "current_thread")]
    async fn streams_content_and_uses_prefixed_endpoint_without_keys_in_body() {
        let (config, server) = mock(200, RESPONSE, Duration::ZERO);
        let (_cancel, receiver) = watch::channel(false);
        let mut emitted = String::new();
        let result = completion(
            &config,
            "synthetic-test-key",
            vec![json!({"role":"user","content":"synthetic note"})],
            receiver,
            |text| emitted.push_str(text),
        )
        .await;
        assert_eq!(result.ok().unwrap(), "测试 [1]");
        assert_eq!(emitted, "测试 [1]");
        let request = server.join().unwrap();
        assert!(request.starts_with("POST /prefix/v1/chat/completions "));
        let (headers, body) = request.split_once("\r\n\r\n").unwrap();
        assert!(headers.contains("Bearer synthetic-test-key"));
        assert!(!body.contains("synthetic-test-key"));
    }
    #[tokio::test(flavor = "current_thread")]
    async fn authentication_rate_limits_and_redirects_are_sanitized_without_retry() {
        for (status, message) in [(401, "认证失败"), (429, "限流"), (302, "重定向")] {
            let (config, server) = mock(status, "secret-provider-response", Duration::ZERO);
            let (_cancel, receiver) = watch::channel(false);
            let error = completion(&config, "test-key", vec![], receiver, |_| {})
                .await
                .err()
                .unwrap();
            assert!(error.message.contains(message));
            assert!(!error.message.contains("secret-provider-response"));
            assert!(!error.message.contains("test-key"));
            server.join().unwrap();
        }
    }
    #[tokio::test(flavor = "current_thread")]
    async fn cancel_and_timeout_drop_pending_network_requests() {
        let (config, server) = mock(200, RESPONSE, Duration::from_millis(100));
        let (cancel, receiver) = watch::channel(false);
        let operation = completion(&config, "", vec![], receiver, |_| {});
        let cancellation = async {
            tokio::time::sleep(Duration::from_millis(30)).await;
            cancel.send(true).unwrap();
        };
        let (result, _) = tokio::join!(operation, cancellation);
        assert!(result.err().unwrap().message.contains("停止"));
        server.join().unwrap();
        let (config, server) = mock(200, RESPONSE, Duration::from_millis(100));
        let (_cancel, receiver) = watch::channel(false);
        assert!(completion_with_timeout(
            &config,
            "",
            vec![],
            receiver,
            |_| {},
            Duration::from_millis(30)
        )
        .await
        .is_err());
        server.join().unwrap();
    }
    #[test]
    fn authorization_rejects_revocation_service_changes_and_configuration_epochs() {
        let config = Config {
            base_url: "https://host/v1".into(),
            model: "test".into(),
        };
        let approved = json!({"service":config.service().unwrap(),"revision":"one"});
        assert!(authorization_matches(&approved, &config, "one"));
        assert!(!authorization_matches(&Value::Null, &config, "one"));
        assert!(!authorization_matches(&approved, &config, "two"));
        let other = Config {
            base_url: "https://other/v1".into(),
            ..config.clone()
        };
        assert!(!authorization_matches(&approved, &other, "one"));
        assert_ne!(
            history_key("a", &config, "ask").ok().unwrap(),
            history_key("b", &config, "ask").ok().unwrap()
        );
    }
    #[test]
    fn switching_vaults_cancels_registered_requests() {
        let runtime = AiState::default();
        let (cancel, receiver) = watch::channel(false);
        runtime
            .0
            .lock()
            .unwrap()
            .running
            .insert("request".into(), ("vault".into(), cancel));
        runtime.cancel_all();
        assert!(*receiver.borrow());
    }
}
