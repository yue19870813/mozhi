//! Desktop adapter. MCP protocol never invokes Tauri commands or React.
use crate::{
    ai, blocking, failure, mcp_credentials, with_access, with_active, workspace, ApiResult,
    AppState,
};
use mozhi_core::{ai as core_ai, markdown, vault};
use mozhi_mcp::{Backend, ToolError, ToolFuture};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    sync::{Arc, Mutex},
};
use tauri::{Emitter, Manager, State};
use tokio_util::sync::CancellationToken;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub enabled: bool,
    pub port: u16,
    pub vault_id: String,
    pub vault_name: String,
    pub read: bool,
    pub create: bool,
    pub ask: bool,
    pub model_binding: String,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            enabled: false,
            port: 37891,
            vault_id: String::new(),
            vault_name: String::new(),
            read: false,
            create: false,
            ask: false,
            model_binding: String::new(),
        }
    }
}
#[derive(Default)]
struct Runtime {
    settings: Settings,
    running: Option<mozhi_mcp::Running>,
    cancel: CancellationToken,
    error: Option<String>,
}
#[derive(Clone, Default)]
pub struct McpState(Arc<Mutex<Runtime>>, Arc<tokio::sync::Mutex<()>>);
impl McpState {
    pub fn cancel_requests(&self) {
        if let Ok(mut r) = self.0.lock() {
            r.cancel.cancel();
            r.cancel = CancellationToken::new();
        }
    }
    pub fn revoke_model(&self, app: &tauri::AppHandle) -> ApiResult<()> {
        self.cancel_requests();
        let mut r = self.0.lock().map_err(|_| failure("MCP 服务不可用"))?;
        r.settings.ask = false;
        r.settings.model_binding.clear();
        let path = config_path(app)?;
        fs::create_dir_all(path.parent().ok_or_else(|| failure("配置路径无效"))?)
            .map_err(|_| failure("无法保存 MCP 授权"))?;
        vault::atomic_write(&path, &serde_json::to_vec(&r.settings).map_err(failure)?)?;
        Ok(())
    }
    async fn stop(&self) {
        let server = if let Ok(mut r) = self.0.lock() {
            r.cancel.cancel();
            r.cancel = CancellationToken::new();
            r.error = None;
            r.running.take()
        } else {
            None
        };
        if let Some(server) = server {
            server.shutdown().await;
        }
    }
    pub fn shutdown(&self) {
        if let Ok(mut r) = self.0.lock() {
            r.cancel.cancel();
            if let Some(server) = r.running.take() {
                server.stop();
            }
        }
    }
}
fn binding(app: &tauri::AppHandle) -> String {
    ai::config(app)
        .ok()
        .map(|c| {
            vault::hash(format!("{}:{}:{}", c.base_url, c.model, ai::revision(app)).as_bytes())
        })
        .unwrap_or_default()
}
fn config_path(app: &tauri::AppHandle) -> ApiResult<std::path::PathBuf> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(failure)?
        .join("mcp-settings.json"))
}
fn settings(app: &tauri::AppHandle) -> ApiResult<Settings> {
    let s = app.state::<McpState>();
    let r = s.0.lock().map_err(|_| failure("MCP 服务不可用"))?;
    Ok(r.settings.clone())
}
fn err(code: &'static str, msg: &'static str) -> ToolError {
    ToolError::new(code, msg)
}
fn safe_error(e: crate::ApiError) -> ToolError {
    match e.code {
        "MODEL_CONFIG" => err("MODEL_CONFIG", "Check model configuration in MoZhi"),
        "MODEL_CREDENTIALS" => err("MODEL_CREDENTIALS", "Check model credentials in MoZhi"),
        "TIMEOUT" => err("TIMEOUT", "Model request timed out"),
        "RATE_LIMITED" => err(
            "RATE_LIMITED",
            "Model rate limit reached; retry manually later",
        ),
        "NETWORK_FAILED" => err("NETWORK_FAILED", "Model connection failed"),
        "MODEL_ERROR" => err("MODEL_ERROR", "Model request failed"),
        "INVALID_PATH" => err(
            "INVALID_PATH",
            "Path is outside the vault or not a Markdown file",
        ),
        "NOT_FOUND" => err("NOT_FOUND", "Note does not exist"),
        "CONTENT_CONFLICT" => err("CONFLICT", "Note conflicts with an existing version"),
        "NOTE_TOO_LARGE" => err("TOO_LARGE", "Note exceeds size limit"),
        _ => err(
            "OPERATION_FAILED",
            "Operation failed; check MoZhi for details",
        ),
    }
}
#[derive(Clone)]
struct Desktop(tauri::AppHandle);
impl Backend for Desktop {
    fn call(&self, name: String, args: Value, client_cancel: CancellationToken) -> ToolFuture<'_> {
        Box::pin(async move {
            let runtime = self.0.state::<McpState>();
            let (s, epoch) = {
                let r = runtime
                    .0
                    .lock()
                    .map_err(|_| err("UNAVAILABLE", "MCP unavailable"))?;
                (r.settings.clone(), r.cancel.clone())
            };
            if !s.enabled || !s.read {
                return Err(err("PERMISSION_DENIED", "MCP read access is disabled"));
            }
            let state = self.0.state::<AppState>().inner().clone();
            let active = state
                .0
                .lock()
                .map_err(|_| err("UNAVAILABLE", "Vault state unavailable"))?
                .as_ref()
                .is_some_and(|a| a.id == s.vault_id);
            if name == "get_vault_info" {
                return Ok(
                    json!({"vaultId":s.vault_id,"name":s.vault_name,"available":active,"read":s.read,"create":s.create,"ask":s.ask&&s.model_binding==binding(&self.0)}),
                );
            }
            check_tool_access(
                &s,
                &name,
                args.get("vaultId").and_then(Value::as_str),
                active,
                &binding(&self.0),
            )?;
            let app = self.0.clone();
            let id = s.vault_id.clone();
            if name == "ask_notes" {
                let question = args
                    .get("question")
                    .and_then(Value::as_str)
                    .filter(|q| !q.trim().is_empty() && q.len() <= 64000)
                    .ok_or_else(|| {
                        err(
                            "INVALID_ARGUMENT",
                            "Question is required and must be within 64000 bytes",
                        )
                    })?
                    .to_owned();
                let work = ai::mcp_answer(
                    app.clone(),
                    state,
                    id.clone(),
                    question,
                    epoch.clone(),
                    client_cancel.clone(),
                );
                return tokio::select! {
                  result=work=> result.map_err(|e| {if e.message.contains("超时"){err("TIMEOUT","Model request timed out")}else if e.message.contains("API Key")||e.message.contains("凭据"){err("MODEL_CREDENTIALS","Check model credentials in MoZhi")}else if e.message.contains("配置"){err("MODEL_CONFIG","Check model configuration in MoZhi")}else if e.message.contains("已停止生成"){err("CANCELLED","Request cancelled")}else if e.message.contains("停止当前生成"){err("BUSY","Another generation is in progress")}else if e.message.contains("未找到参考"){err("NO_CONTEXT","No matching saved notes")}else{safe_error(e)}}),
                  _=client_cancel.cancelled()=>Err(err("CANCELLED","Request cancelled")),
                  _=epoch.cancelled()=>Err(err("CANCELLED","Vault or authorization changed")),
                };
            }
            let name_for_event = name.clone();
            let result = blocking(move || {
                if epoch.is_cancelled() || client_cancel.is_cancelled() {
                    return Err(failure("MCP request cancelled"));
                }
                let current = settings(&app)?;
                if !current.enabled
                    || current.vault_id != id
                    || !current.read
                    || name == "create_note" && !current.create
                {
                    return Err(failure("MCP permission changed"));
                }
                if name == "create_note" {
                    let path = args
                        .get("path")
                        .and_then(Value::as_str)
                        .ok_or_else(|| failure("INVALID_ARGUMENT"))?;
                    let body = args
                        .get("body")
                        .and_then(Value::as_str)
                        .ok_or_else(|| failure("INVALID_ARGUMENT"))?;
                    let tags: Vec<String> =
                        serde_json::from_value(args.get("tags").cloned().unwrap_or(json!([])))
                            .map_err(|_| failure("INVALID_ARGUMENT"))?;
                    if tags.len() > 100 || tags.iter().any(|t| t.len() > 256) {
                        return Err(failure("INVALID_ARGUMENT"));
                    }
                    return with_active(&state, |a| {
                        workspace::identity(a, &id)?;
                        if epoch.is_cancelled() {
                            return Err(failure("CANCELLED"));
                        }
                        create_saved(a, path, body, &tags)
                    });
                }
                let hybrid_requested=name=="search_notes"&&args.get("mode").and_then(Value::as_str)==Some("hybrid");
                let hybrid_available=hybrid_requested&&with_access(&state,true,|a|{workspace::identity(a,&id)?;Ok(crate::semantic::enabled(&a.private))})?;
                let semantic = if name == "search_notes"
                    && args.get("mode").and_then(Value::as_str) == Some("hybrid")
                {
                    crate::semantic::retrieve(
                        &app,
                        &state,
                        &id,
                        args.get("query").and_then(Value::as_str).unwrap_or(""),
                    )?
                } else {
                    vec![]
                };
                with_access(&state, true, |a| {
                    if epoch.is_cancelled()||client_cancel.is_cancelled(){return Err(failure("CANCELLED"));}
                    workspace::identity(a, &id)?;
                    match name.as_str() {
                        "list_notes" | "read_note" => read_saved(a, &name, &args),
                        "search_notes" => {
                            let query = args
                                .get("query")
                                .and_then(Value::as_str)
                                .ok_or_else(|| failure("INVALID_ARGUMENT"))?;
                            if query.len() > 64000 {
                                return Err(failure("INVALID_ARGUMENT"));
                            }
                            let limit = args
                                .get("limit")
                                .and_then(Value::as_u64)
                                .unwrap_or(50)
                                .clamp(1, 200) as usize;
                            let lexical = a.index.query(query, "")?;
                            let mut hits = lexical.hits;
                            let actual = if hybrid_available {"hybrid"}else{"keyword"};
                            for source in semantic {
                                if !hits.iter().any(|h| h.path == source.path) {
                                    hits.push(mozhi_core::search::SearchHit {
                                        title: markdown::parse(&source.path, &source.text).title,
                                        path: source.path,
                                        excerpt: source.text,
                                    });
                                }
                            }
                            hits.truncate(limit);
                            Ok(json!({"hits":hits,"mode":actual,"fallbackReason":if hybrid_requested&&!hybrid_available {Some("Semantic search is disabled; keyword search used")}else{None}}))
                        }
                        _ => Err(failure("UNKNOWN_TOOL")),
                    }
                })
            })
            .await
            .map_err(|e| match e.message.as_str() {
                "ALREADY_EXISTS" => err("ALREADY_EXISTS", "Destination already exists"),
                "SYNC_BLOCKED" => err("SYNC_BLOCKED", "Resolve sync before creating notes"),
                "DRAFT_CONFLICT" => err(
                    "DRAFT_CONFLICT",
                    "Resolve a recovery draft before creating this note",
                ),
                "INVALID_ARGUMENT" => err("INVALID_ARGUMENT", "Invalid tool arguments"),
                "CANCELLED"|"MCP request cancelled"=>err("CANCELLED","Request cancelled"),
                "MCP permission changed"=>err("PERMISSION_DENIED","Authorization changed"),
                "UNKNOWN_TOOL"=>err("UNKNOWN_TOOL","Unknown tool"),
                _ if e.message.contains("同步") => err("SYNC_BLOCKED", "Vault is syncing"),
                _ => safe_error(e),
            })?;
            if name_for_event == "create_note" {
                crate::tray::mark_saved(&self.0, &s.vault_id);
                let _ = self
                    .0
                    .emit("mcp_note_created", json!({"vaultId":s.vault_id}));
                let _ = self
                    .0
                    .emit("vault_files_changed", json!({"vaultId":s.vault_id}));
            }
            Ok(result)
        })
    }
}
async fn launch(app: tauri::AppHandle) -> ApiResult<()> {
    let state = app.state::<McpState>();
    let s = settings(&app)?;
    if !s.enabled {
        return Ok(());
    }
    if s.port == 0 {
        return Err(failure("请授权读取并填写有效端口"));
    }
    let token = blocking(mcp_credentials::get).await?;
    let running = mozhi_mcp::start(s.port, token, Arc::new(Desktop(app.clone())))
        .await
        .map_err(|_| failure("MCP 端口不可用，请修改端口后重试"))?;
    let mut r = state.0.lock().map_err(|_| failure("MCP 服务不可用"))?;
    r.running = Some(running);
    r.error = None;
    Ok(())
}
pub fn restore(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<McpState>();
        let _serial = state.1.lock().await;
        if let Ok(path) = config_path(&app) {
            if let Ok(bytes) = fs::read(path) {
                if let Ok(s) = serde_json::from_slice::<Settings>(&bytes) {
                    if let Ok(mut r) = app.state::<McpState>().0.lock() {
                        r.settings = s;
                    }
                }
            }
        }
        if let Err(e) = launch(app.clone()).await {
            if let Ok(mut r) = app.state::<McpState>().0.lock() {
                r.error = Some(e.message);
            }
        }
    });
}
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum Request {
    Status,
    Configure {
        enabled: bool,
        port: u16,
        read: bool,
        create: bool,
        ask: bool,
    },
    Rotate,
}
#[tauri::command]
pub async fn mcp_request(
    app: tauri::AppHandle,
    state: State<'_, McpState>,
    request: Request,
) -> ApiResult<Value> {
    let _serial = state.1.lock().await;
    match request {
        Request::Status => {}
        Request::Configure {
            enabled,
            port,
            read,
            create,
            ask,
        } => {
            if port == 0 || enabled && !read {
                return Err(failure("请授权读取并填写有效端口"));
            }
            let (id, name) = with_access(&app.state::<AppState>(), true, |a| {
                Ok((
                    a.id.clone(),
                    a.vault
                        .root()
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned(),
                ))
            })?;
            let model_binding = if ask {
                let b = binding(&app);
                if b.is_empty() {
                    return Err(failure("请先配置 AI 模型"));
                }
                b
            } else {
                String::new()
            };
            if enabled {
                blocking(mcp_credentials::ensure).await?;
            }
            state.stop().await;
            let s = Settings {
                enabled,
                port,
                vault_id: id,
                vault_name: name,
                read,
                create,
                ask,
                model_binding,
            };
            let path = config_path(&app)?;
            fs::create_dir_all(path.parent().ok_or_else(|| failure("配置路径无效"))?)
                .map_err(|_| failure("无法保存 MCP 授权"))?;
            vault::atomic_write(&path, &serde_json::to_vec(&s).map_err(failure)?)?;
            state
                .0
                .lock()
                .map_err(|_| failure("MCP 服务不可用"))?
                .settings = s;
            if let Err(e) = launch(app.clone()).await {
                state.0.lock().map_err(|_| failure("MCP 服务不可用"))?.error =
                    Some(e.message.clone());
                return Err(e);
            }
        }
        Request::Rotate => {
            state.stop().await;
            blocking(|| mcp_credentials::generate().map(|_| ())).await?;
            launch(app.clone()).await?;
        }
    }
    let (mut s, running, error) = {
        let r = state.0.lock().map_err(|_| failure("MCP 服务不可用"))?;
        (r.settings.clone(), r.running.is_some(), r.error.clone())
    };
    if s.model_binding != binding(&app) {
        s.ask = false;
    }
    let active = app
        .state::<AppState>()
        .0
        .lock()
        .ok()
        .and_then(|a| a.as_ref().map(|a| a.id == s.vault_id))
        .unwrap_or(false);
    Ok(
        json!({"settings":s,"running":running,"available":active,"error":error,"url":format!("http://127.0.0.1:{}/mcp",s.port)}),
    )
}
#[tauri::command]
pub async fn mcp_token(app: tauri::AppHandle) -> ApiResult<()> {
    let (send, receive) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = send.send(mcp_credentials::show());
    })
    .map_err(|_| failure("无法打开原生凭据窗口"))?;
    blocking(move || receive.recv().map_err(|_| failure("凭据输入未完成"))?).await
}

fn create_saved(
    a: &mut crate::Active,
    path: &str,
    body: &str,
    tags: &[String],
) -> ApiResult<Value> {
    if a.private.join("sync-pending.json").exists() {
        return Err(failure("SYNC_BLOCKED"));
    }
    if a.vault.read_creation_draft(path)?.is_some() {
        return Err(failure("DRAFT_CONFLICT"));
    }
    if mozhi_core::operations::checked(a.vault.root(), path, false)?.exists() {
        return Err(failure("ALREADY_EXISTS"));
    }
    core_ai::save_generated_with_tags(&a.vault, path, body, tags)?;
    let note = a.vault.read(path)?;
    let metadata = markdown::parse(path, &note.content);
    let warning = a
        .index
        .upsert(path, &note.content)
        .err()
        .map(|_| "Note created; search index refresh required");
    Ok(json!({"path":path,"id":metadata.id,"contentHash":note.content_hash,"indexWarning":warning}))
}

fn read_saved(a: &mut crate::Active, name: &str, args: &Value) -> ApiResult<Value> {
    match name {
        "list_notes" => {
            let offset = args.get("offset").and_then(Value::as_u64).unwrap_or(0) as usize;
            let limit = args
                .get("limit")
                .and_then(Value::as_u64)
                .unwrap_or(50)
                .clamp(1, 200) as usize;
            let directory = args.get("directory").and_then(Value::as_str).unwrap_or("");
            if !directory.is_empty() {
                let path = mozhi_core::operations::checked(
                    a.vault.root(),
                    directory.trim_end_matches('/'),
                    true,
                )?;
                if !path.is_dir() {
                    return Err(mozhi_core::Error::InvalidPath.into());
                }
            }
            let tag = args.get("tag").and_then(Value::as_str).unwrap_or("");
            let mut notes = a
                .vault
                .list()?
                .into_iter()
                .filter_map(|e| a.vault.read(&e.path).ok())
                .map(|n| markdown::parse(&n.path, &n.content))
                .filter(|n| {
                    (directory.is_empty()
                        || n.path
                            .starts_with(&format!("{}/", directory.trim_end_matches('/'))))
                        && (tag.is_empty() || n.tags.iter().any(|t| t == tag))
                })
                .collect::<Vec<_>>();
            notes.sort_by(|a, b| a.path.cmp(&b.path));
            let total = notes.len();
            Ok(
                json!({"notes":notes.into_iter().skip(offset).take(limit).collect::<Vec<_>>(),"total":total,"offset":offset,"limit":limit}),
            )
        }
        "read_note" => {
            let path = args
                .get("path")
                .and_then(Value::as_str)
                .ok_or_else(|| failure("INVALID_ARGUMENT"))?;
            let n = a.vault.read(path)?;
            let metadata = markdown::parse(path, &n.content);
            let (front, body) = core_ai::split_body(&n.content);
            Ok(
                json!({"path":n.path,"markdown":n.content,"body":body,"frontMatter":front,"metadata":metadata,"contentHash":n.content_hash}),
            )
        }
        _ => Err(failure("UNKNOWN_TOOL")),
    }
}

fn check_tool_access(
    s: &Settings,
    name: &str,
    vault_id: Option<&str>,
    active: bool,
    model: &str,
) -> Result<(), ToolError> {
    if !s.enabled || !s.read {
        return Err(err("PERMISSION_DENIED", "MCP read access is disabled"));
    }
    if !active || vault_id != Some(s.vault_id.as_str()) {
        return Err(err(
            "VAULT_CHANGED",
            "Requested vault is not the active authorized vault",
        ));
    }
    if name == "create_note" && !s.create
        || name == "ask_notes" && (!s.ask || s.model_binding.is_empty() || s.model_binding != model)
    {
        return Err(err("PERMISSION_DENIED", "This tool is not authorized"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (tempfile::TempDir, tempfile::TempDir, AppState) {
        let root = tempfile::tempdir().unwrap();
        let private = tempfile::tempdir().unwrap();
        let state = AppState::default();
        *state.0.lock().unwrap() = Some(crate::Active {
            demo: false,
            id: "synthetic".into(),
            vault: mozhi_core::vault::Vault::open(root.path(), private.path()).unwrap(),
            index: mozhi_core::search::SearchIndex::open(&private.path().join("index.db")).unwrap(),
            private: private.path().into(),
            _watcher: None,
            recovery_warnings: vec![],
        });
        (root, private, state)
    }
    #[test]
    fn new_notes_preserve_existing_files_and_reject_paths_and_sync() {
        let (root, private, state) = fixture();
        with_active(&state, |a| {
            create_saved(a, "a.md", "# Synthetic", &["tag".into()])
        })
        .ok()
        .unwrap();
        assert!(with_active(&state, |a| create_saved(a, "a.md", "overwrite", &[])).is_err());
        assert!(with_active(&state, |a| create_saved(a, "../escape.md", "bad", &[])).is_err());
        assert!(with_active(&state, |a| create_saved(a, ".hidden.md", "bad", &[])).is_err());
        assert!(with_active(&state, |a| create_saved(a, "nested/new.md", "bad", &[])).is_err());
        fs::write(private.path().join("sync-pending.json"), "{}").unwrap();
        assert!(with_active(&state, |a| create_saved(a, "blocked.md", "bad", &[])).is_err());
        assert!(!root.path().join("blocked.md").exists());
        fs::remove_file(private.path().join("sync-pending.json")).unwrap();
        state.1.store(true, std::sync::atomic::Ordering::SeqCst);
        assert!(with_active(&state, |a| create_saved(a, "blocked.md", "bad", &[])).is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(private.path(), root.path().join("link")).unwrap();
            state.1.store(false, std::sync::atomic::Ordering::SeqCst);
            assert!(with_active(&state, |a| create_saved(a, "link/new.md", "bad", &[])).is_err());
        }
    }
    #[test]
    fn pagination_and_reads_use_disk_and_preserve_recovery_drafts() {
        let (root, _private, state) = fixture();
        fs::write(root.path().join("a.md"), "# Disk").unwrap();
        fs::write(
            root.path().join("b.md"),
            "---\ntags: [target]\n---\n# Second",
        )
        .unwrap();
        with_active(&state, |a| {
            a.vault.draft("a.md", "unsaved")?;
            Ok(())
        })
        .ok()
        .unwrap();
        let read = with_access(&state, true, |a| {
            read_saved(a, "read_note", &json!({"path":"a.md"}))
        })
        .ok()
        .unwrap();
        assert_eq!(read["markdown"], "# Disk");
        let list = with_access(&state, true, |a| {
            read_saved(a, "list_notes", &json!({"offset":1,"limit":1}))
        })
        .ok()
        .unwrap();
        assert_eq!(list["total"], 2);
        assert_eq!(list["notes"][0]["path"], "b.md");
        let list = with_access(&state, true, |a| {
            read_saved(a, "list_notes", &json!({"tag":"target"}))
        })
        .ok()
        .unwrap();
        assert_eq!(list["total"], 1);
        assert!(with_active(&state, |a| create_saved(a, "a.md", "replacement", &[])).is_err());
        with_access(&state, true, |a| {
            assert!(a.vault.read_draft("a.md")?.is_some());
            assert!(workspace::identity(a, "different").is_err());
            Ok(())
        })
        .ok()
        .unwrap();
    }
    #[test]
    fn cancellation_epochs_and_preferences_do_not_serialize_tokens() {
        let state = McpState::default();
        let epoch = state.0.lock().unwrap().cancel.clone();
        state.cancel_requests();
        assert!(epoch.is_cancelled());
        assert!(!state.0.lock().unwrap().cancel.is_cancelled());
        let defaults = Settings::default();
        assert!(!defaults.enabled && !defaults.read && !defaults.create && !defaults.ask);
        assert_eq!(defaults.port, 37891);
        let saved = serde_json::to_string(&defaults).unwrap();
        assert!(!saved.contains("token"));
        assert!(!saved.contains("Authorization"));
    }
    #[test]
    fn explicit_vault_and_cloud_authorization_are_independent_and_bound_to_model() {
        let mut s = Settings {
            enabled: true,
            read: true,
            vault_id: "one".into(),
            ..Default::default()
        };
        assert!(check_tool_access(&s, "read_note", Some("one"), true, "").is_ok());
        for (id, active) in [(None, true), (Some("two"), true), (Some("one"), false)] {
            assert_eq!(
                check_tool_access(&s, "read_note", id, active, "")
                    .unwrap_err()
                    .code,
                "VAULT_CHANGED"
            );
        }
        assert!(check_tool_access(&s, "create_note", Some("one"), true, "").is_err());
        assert!(check_tool_access(&s, "ask_notes", Some("one"), true, "ui-authorized").is_err());
        s.create = true;
        s.ask = true;
        s.model_binding = "provider-a".into();
        assert!(check_tool_access(&s, "create_note", Some("one"), true, "").is_ok());
        assert!(check_tool_access(&s, "ask_notes", Some("one"), true, "provider-a").is_ok());
        assert!(check_tool_access(&s, "ask_notes", Some("one"), true, "provider-b").is_err());
        s.ask = false;
        s.model_binding.clear();
        assert!(check_tool_access(&s, "ask_notes", Some("one"), true, "provider-a").is_err());
    }
    #[test]
    fn creating_a_deleted_note_with_a_recovery_draft_is_rejected() {
        let (root, _private, state) = fixture();
        fs::write(root.path().join("lost.md"), "disk").unwrap();
        with_active(&state, |a| {
            a.vault.draft("lost.md", "unsaved")?;
            Ok(())
        })
        .ok()
        .unwrap();
        fs::remove_file(root.path().join("lost.md")).unwrap();
        let error = with_active(&state, |a| create_saved(a, "lost.md", "replacement", &[]))
            .err()
            .unwrap();
        assert_eq!(error.message, "DRAFT_CONFLICT");
        assert!(!root.path().join("lost.md").exists());
    }
    #[test]
    fn failed_indexing_returns_success_and_warning_after_atomic_creation() {
        let (root, _private, state) = fixture();
        with_active(&state,|a|{
            a.index=mozhi_core::search::SearchIndex::open(&a.private.join("failing.db"))?;
            let connection=rusqlite::Connection::open(a.private.join("failing.db")).map_err(|_|failure("test setup"))?;
            connection.execute_batch("CREATE TRIGGER fail_index BEFORE INSERT ON note_hashes BEGIN SELECT RAISE(FAIL, 'synthetic index failure'); END;").map_err(|_|failure("test setup"))?;
            let result=create_saved(a,"created.md","# Synthetic",&[])?;
            assert!(result["indexWarning"].is_string());assert!(result["id"].is_string());Ok(())
        }).ok().unwrap();
        assert!(root.path().join("created.md").exists());
    }
    #[cfg(unix)]
    #[test]
    fn unwritable_directory_leaves_no_created_note() {
        use std::os::unix::fs::PermissionsExt;
        let (root, _private, state) = fixture();
        let permissions = fs::metadata(root.path()).unwrap().permissions();
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o500)).unwrap();
        let result = with_active(&state, |a| create_saved(a, "failure.md", "text", &[]));
        fs::set_permissions(root.path(), permissions).unwrap();
        assert!(result.is_err());
        assert!(!root.path().join("failure.md").exists());
    }
    #[test]
    fn tool_errors_never_include_provider_secrets_or_absolute_paths() {
        for code in [
            "OPERATION_FAILED",
            "MODEL_CREDENTIALS",
            "MODEL_CONFIG",
            "TIMEOUT",
            "INVALID_PATH",
            "NOT_FOUND",
            "RATE_LIMITED",
        ] {
            let error = safe_error(crate::ApiError {
                code,
                message: "provider raw response secret-token /Users/synthetic/private.md".into(),
            });
            let response = serde_json::to_string(&error).unwrap();
            assert!(!response.contains("secret-token"));
            assert!(!response.contains("/Users/"));
            assert!(!response.contains("provider raw response"));
        }
    }
}
