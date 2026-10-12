//! Local-only CPU embeddings. Model downloads never contain vault text or credentials.
use crate::{blocking, failure, with_access, workspace, ApiResult, AppState};
use fastembed::{
    InitOptionsUserDefined, Pooling, QuantizationMode, TextEmbedding, TokenizerFiles,
    UserDefinedEmbeddingModel,
};
use futures_util::StreamExt;
use mozhi_core::{
    ai::Source,
    semantic::{self, Chunk, Index},
    vault::{self},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{Manager, State};
const REV: &str = "2c4055b12046f11709e9df2c122e59ffbdc2f900";
const REPO: &str = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const FILES: [(&str, u64, &str); 5] = [
    (
        "onnx/model_quantized.onnx",
        118308126,
        "66fc00f5f29afcaff34092e1bdd20008ca3918265a82fb9695a551e510cc4ebc",
    ),
    (
        "tokenizer.json",
        17082913,
        "b60b6b43406a48bf3638526314f3d232d97058bc93472ff2de930d43686fa441",
    ),
    (
        "config.json",
        673,
        "05b570bff786faa5c4604152aa16f19f77ed6dfc31e47dd0f3dd987078693ac7",
    ),
    (
        "special_tokens_map.json",
        280,
        "06e405a36dfe4b9604f484f6a1e619af1a7f7d09e34a8555eb0b77b66318067f",
    ),
    (
        "tokenizer_config.json",
        496,
        "3f5961b9ac86288cccdb97f32fb848d6187c78e1603958c53f3ea1f296b7d8a2",
    ),
];
#[derive(Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    phase: String,
    vault_id: String,
    done: usize,
    total: usize,
    error: String,
}
#[derive(Clone, Default)]
pub struct SemanticState {
    model: Arc<Mutex<Option<TextEmbedding>>>,
    progress: Arc<Mutex<Progress>>,
    busy: Arc<AtomicBool>,
    cancel: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
}
struct Job(SemanticState);
impl Drop for Job {
    fn drop(&mut self) {
        self.0.busy.store(false, Ordering::SeqCst);
    }
}
impl SemanticState {
    pub fn cancel_vault(&self) {
        self.paused.store(false, Ordering::SeqCst);
        if self.progress.lock().is_ok_and(|p| !p.vault_id.is_empty()) {
            self.cancel.store(true, Ordering::SeqCst);
        }
    }
    fn job(&self) -> ApiResult<Job> {
        if self
            .busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err(failure("语义索引正在处理，请稍后重试"));
        }
        self.cancel.store(false, Ordering::SeqCst);
        Ok(Job(self.clone()))
    }
    fn report(&self, phase: &str, id: &str, done: usize, total: usize, error: &str) {
        if let Ok(mut p) = self.progress.lock() {
            *p = Progress {
                phase: phase.into(),
                vault_id: id.into(),
                done,
                total,
                error: error.into(),
            };
        }
    }
    fn check(&self) -> ApiResult<()> {
        if self.cancel.load(Ordering::SeqCst) {
            Err(failure("语义索引已停止"))
        } else {
            Ok(())
        }
    }
}
fn directory(app: &tauri::AppHandle) -> ApiResult<PathBuf> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(failure)?
        .join("embedding-models")
        .join(semantic::MODEL_ID))
}
fn ready(dir: &Path) -> bool {
    FILES.iter().all(|(name, size, _)| {
        fs::metadata(dir.join(name)).is_ok_and(|m| m.is_file() && m.len() == *size)
    }) && dir.join("verified.json").is_file()
}
fn enabled(private: &Path) -> bool {
    fs::read(private.join("semantic-enabled.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<bool>(&b).ok())
        .unwrap_or(false)
}
fn load(runtime: &SemanticState, dir: &Path) -> ApiResult<()> {
    let mut slot = runtime
        .model
        .lock()
        .map_err(|_| failure("本地模型不可用"))?;
    if slot.is_some() {
        return Ok(());
    }
    if !ready(dir) {
        return Err(failure("请先下载本地向量模型"));
    }
    for (name, _, hash) in FILES {
        let bytes = fs::read(dir.join(name)).map_err(failure)?;
        if vault::hash(&bytes) != hash {
            return Err(failure("模型文件校验失败，请重新下载"));
        }
    }
    let read = |name: &str| fs::read(dir.join(name)).map_err(failure);
    let files = TokenizerFiles {
        tokenizer_file: read("tokenizer.json")?,
        config_file: read("config.json")?,
        special_tokens_map_file: read("special_tokens_map.json")?,
        tokenizer_config_file: read("tokenizer_config.json")?,
    };
    let model = UserDefinedEmbeddingModel::new(read("onnx/model_quantized.onnx")?, files)
        .with_pooling(Pooling::Mean)
        .with_quantization(QuantizationMode::Dynamic);
    *slot = Some(
        TextEmbedding::try_new_from_user_defined(
            model,
            InitOptionsUserDefined::new()
                .with_max_length(128)
                .with_intra_threads(2),
        )
        .map_err(|_| failure("本地模型加载失败，请重新下载模型"))?,
    );
    Ok(())
}
fn split_tokens(model: &TextEmbedding, chunk: Chunk, out: &mut Vec<Chunk>) -> ApiResult<()> {
    let tokens = model
        .tokenizer
        .encode(chunk.text.as_str(), true)
        .map_err(|_| failure("文本分词失败"))?;
    // Fastembed tokenizer has truncation configured: inspect without truncation to avoid silent data loss.
    if tokens.get_overflowing().is_empty() {
        out.push(chunk);
        return Ok(());
    }
    let chars: Vec<char> = chunk.text.chars().collect();
    if chars.len() < 2 {
        return Err(failure("文本分词失败"));
    }
    let mid = chars.len() / 2;
    split_tokens(
        model,
        Chunk {
            start: chunk.start,
            end: chunk.start + mid,
            text: chars[..mid].iter().collect(),
        },
        out,
    )?;
    split_tokens(
        model,
        Chunk {
            start: chunk.start + mid,
            end: chunk.end,
            text: chars[mid..].iter().collect(),
        },
        out,
    )
}
fn infer(
    runtime: &SemanticState,
    parts: Vec<Chunk>,
    cancellable: bool,
) -> ApiResult<(Vec<Chunk>, Vec<Vec<f32>>)> {
    let mut lock = runtime
        .model
        .lock()
        .map_err(|_| failure("本地模型不可用"))?;
    let model = lock
        .as_mut()
        .ok_or_else(|| failure("请先下载本地向量模型"))?;
    let mut pieces = Vec::new();
    for c in parts {
        split_tokens(model, c, &mut pieces)?;
    }
    let mut vectors = Vec::new();
    for batch in pieces.chunks(8) {
        if cancellable {
            runtime.check()?;
        }
        vectors.extend(
            model
                .embed(
                    batch.iter().map(|c| c.text.as_str()).collect::<Vec<_>>(),
                    Some(8),
                )
                .map_err(|_| failure("本地向量计算失败"))?,
        );
    }
    Ok((pieces, vectors))
}
fn active_id(state: &AppState) -> ApiResult<String> {
    with_access(state, true, |a| Ok(a.id.clone()))
}
fn snapshot(state: &AppState, id: &str) -> ApiResult<(PathBuf, vault::Vault)> {
    with_access(state, true, |a| {
        workspace::identity(a, id)?;
        Ok((
            a.private.clone(),
            vault::Vault::open(a.vault.root(), a.vault.recovery_dir())?,
        ))
    })
}
fn status(
    app: &tauri::AppHandle,
    state: &AppState,
    runtime: &SemanticState,
    id: &str,
) -> ApiResult<Value> {
    let dir = directory(app)?;
    let (private, vault) = snapshot(state, id)?;
    let index = Index::open(&private.join("semantic.db"))?;
    let hashes = index.hashes()?;
    let entries = vault.list()?;
    let paths = entries
        .iter()
        .map(|e| e.path.as_str())
        .collect::<std::collections::HashSet<_>>();
    let mut pending = hashes
        .keys()
        .filter(|p| !paths.contains(p.as_str()))
        .count();
    for entry in &entries {
        if vault
            .read(&entry.path)
            .map_or(true, |n| hashes.get(&n.path) != Some(&n.content_hash))
        {
            pending += 1;
        }
    }
    with_access(state, true, |a| workspace::identity(a, id))?;
    let progress = runtime
        .progress
        .lock()
        .map_err(|_| failure("语义索引不可用"))?
        .clone();
    Ok(
        json!({"vaultId":id,"modelReady":ready(&dir),"enabled":enabled(&private),"paused":runtime.paused.load(Ordering::SeqCst),"busy":runtime.busy.load(Ordering::SeqCst),"stats":index.stats()?,"pending":pending,"progress":progress,"model":"paraphrase-multilingual-MiniLM-L12-v2 (INT8)","modelBytes":135392488}),
    )
}
fn reconcile(
    app: &tauri::AppHandle,
    state: &AppState,
    runtime: &SemanticState,
    id: &str,
    rebuild: bool,
) -> ApiResult<()> {
    let (private, vault) = snapshot(state, id)?;
    let entries = vault.list()?;
    runtime.report("loading", id, 0, 0, "");
    load(runtime, &directory(app)?)?;
    let mut index = Index::open(&private.join("semantic.db"))?;
    if rebuild {
        index.clear()?;
    }
    let hashes = index.hashes()?;
    let total = entries.len();
    let mut failures = 0;
    for (i, entry) in entries.iter().enumerate() {
        runtime.check()?;
        runtime.report("indexing", id, i, total, "");
        with_access(state, true, |a| workspace::identity(a, id))?;
        let note = match vault.read(&entry.path) {
            Ok(note) => note,
            Err(mozhi_core::Error::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => {
                failures += 1;
                continue;
            }
        };
        if hashes.get(&note.path) != Some(&note.content_hash) {
            match infer(runtime, semantic::chunks(&note.content), true) {
                Ok((parts, vectors)) => {
                    runtime.check()?;
                    with_access(state, true, |a| {
                        workspace::identity(a, id)?;
                        if a.vault
                            .read(&note.path)
                            .is_ok_and(|current| current.content_hash == note.content_hash)
                        {
                            index.replace(&note, &parts, &vectors)?;
                        }
                        Ok(())
                    })?;
                }
                Err(e) => {
                    runtime.check()?;
                    let _ = e;
                    failures += 1;
                }
            }
        }
    }
    runtime.check()?;
    let current = vault.list()?.into_iter().map(|e| e.path).collect();
    with_access(state, true, |a| {
        workspace::identity(a, id)?;
        index.prune(&current)?;
        Ok(())
    })?;
    if failures > 0 {
        return Err(failure(
            "部分笔记索引失败，请检查文件访问权限并更新索引重试",
        ));
    }
    runtime.report("ready", id, total, total, "");
    Ok(())
}
async fn download(app: tauri::AppHandle, runtime: SemanticState, mirror: bool) -> ApiResult<()> {
    let _job = runtime.job()?;
    runtime.report(
        "downloading",
        "",
        0,
        FILES.iter().map(|f| f.1 as usize).sum(),
        "",
    );
    let dir = directory(&app)?;
    fs::create_dir_all(dir.join("onnx")).map_err(failure)?;
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(600))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || attempt.url().scheme() != "https" {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|_| failure("模型下载失败"))?;
    let host = if mirror {
        "https://hf-mirror.com"
    } else {
        "https://huggingface.co"
    };
    let total = FILES.iter().map(|f| f.1 as usize).sum();
    let mut done = 0;
    for (name, size, hash) in FILES {
        runtime.check()?;
        let destination = dir.join(name);
        if fs::read(&destination).is_ok_and(|b| vault::hash(&b) == hash) {
            done += size as usize;
            continue;
        }
        let route = if size < 1000 { "raw" } else { "resolve" };
        let url = format!("{host}/{REPO}/{route}/{REV}/{name}");
        let request = client.get(url).send();
        tokio::pin!(request);
        let response = loop {
            runtime.check()?;
            tokio::select! {
                response=&mut request => break response.map_err(|_|failure("模型下载失败，请检查网络或切换下载源"))?,
                _=tokio::time::sleep(Duration::from_millis(150))=>continue,
            }
        }.error_for_status().map_err(|_| failure("模型下载失败，请检查网络或切换下载源"))?;
        let mut file =
            tempfile::NamedTempFile::new_in(destination.parent().unwrap()).map_err(failure)?;
        let mut received = 0u64;
        let mut stream = response.bytes_stream();
        loop {
            runtime.check()?;
            let next = tokio::select! {part=stream.next()=>part,_=tokio::time::sleep(Duration::from_millis(150))=>continue};
            let Some(part) = next else {
                break;
            };
            let bytes = part.map_err(|_| failure("模型下载失败"))?;
            received += bytes.len() as u64;
            if received > size {
                return Err(failure("模型文件校验失败"));
            }
            file.write_all(&bytes).map_err(failure)?;
            runtime.report("downloading", "", done + received as usize, total, "");
        }
        if received != size {
            return Err(failure("模型文件校验失败"));
        }
        file.as_file().sync_all().map_err(failure)?;
        let mut bytes = Vec::new();
        fs::File::open(file.path())
            .map_err(failure)?
            .read_to_end(&mut bytes)
            .map_err(failure)?;
        if vault::hash(&bytes) != hash {
            return Err(failure("模型文件校验失败"));
        }
        file.persist(destination).map_err(failure)?;
        done += size as usize;
    }
    vault::atomic_write(
        &dir.join("LICENSE.txt"),
        include_bytes!("../licenses/Apache-2.0.txt"),
    )?;
    vault::atomic_write(&dir.join("NOTICE.txt"), b"paraphrase-multilingual-MiniLM-L12-v2 by sentence-transformers; ONNX conversion by Xenova. Apache-2.0. https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2")?;
    vault::atomic_write(
        &dir.join("verified.json"),
        serde_json::to_string(&FILES).map_err(failure)?.as_bytes(),
    )?;
    runtime.report("ready", "", total, total, "");
    Ok(())
}
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum Request {
    Status,
    Download { mirror: bool },
    Configure { enabled: bool },
    Index { rebuild: bool },
    Cancel,
}
#[tauri::command]
pub async fn semantic_request(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    runtime: State<'_, SemanticState>,
    vault_id: String,
    request: Request,
) -> ApiResult<Value> {
    let state = state.inner().clone();
    let runtime = runtime.inner().clone();
    match request {
        Request::Cancel => {
            runtime.cancel.store(true, Ordering::SeqCst);
            runtime.paused.store(true, Ordering::SeqCst);
            Ok(Value::Null)
        }
        Request::Download { mirror } => {
            let result = download(app, runtime.clone(), mirror).await;
            if let Err(e) = &result {
                runtime.report("error", "", 0, 0, &e.message);
            }
            result.map(|_| Value::Null)
        }
        other => {
            blocking(move || {
                let id = if vault_id.is_empty() {
                    active_id(&state)?
                } else {
                    vault_id
                };
                match other {
                    Request::Status => status(&app, &state, &runtime, &id),
                    Request::Configure { enabled: value } => {
                        if value && !ready(&directory(&app)?) {
                            return Err(failure("请先下载本地向量模型"));
                        }
                        with_access(&state, true, |a| {
                            workspace::identity(a, &id)?;
                            vault::atomic_write(
                                &a.private.join("semantic-enabled.json"),
                                if value { b"true" } else { b"false" },
                            )?;
                            Ok(())
                        })?;
                        runtime.paused.store(false, Ordering::SeqCst);
                        if !value {
                            runtime.cancel.store(true, Ordering::SeqCst);
                        }
                        Ok(Value::Null)
                    }
                    Request::Index { rebuild } => {
                        let _job = runtime.job()?;
                        runtime.paused.store(false, Ordering::SeqCst);
                        let result = reconcile(&app, &state, &runtime, &id, rebuild);
                        if let Err(e) = &result {
                            runtime.report("error", &id, 0, 0, &e.message);
                            if active_id(&state).is_ok_and(|active| active == id) {
                                runtime.paused.store(true, Ordering::SeqCst);
                            }
                        }
                        result.map(|_| Value::Null)
                    }
                    _ => Err(failure("无效操作")),
                }
            })
            .await
        }
    }
}
/// Semantic candidates are revalidated against current disk state before becoming AI sources.
pub fn retrieve(
    app: &tauri::AppHandle,
    state: &AppState,
    id: &str,
    query: &str,
) -> ApiResult<Vec<Source>> {
    if query.len() > 64000 {
        return Err(failure("请求内容过多"));
    }
    let runtime = app.state::<SemanticState>();
    let (private, vault) = snapshot(state, id)?;
    if !enabled(&private) {
        return Ok(vec![]);
    }
    load(&runtime, &directory(app)?)?;
    let (_, vectors) = infer(
        &runtime,
        vec![Chunk {
            start: 0,
            end: query.chars().count(),
            text: query.into(),
        }],
        false,
    )?;
    if vectors.is_empty() {
        return Ok(vec![]);
    }
    let mut query_vector = vec![0.0; semantic::DIM];
    for vector in &vectors {
        for (a, b) in query_vector.iter_mut().zip(vector) {
            *a += b / vectors.len() as f32;
        }
    }
    let vector = &query_vector;
    let hits = Index::open(&private.join("semantic.db"))?.search(vector, 40)?;
    let mut sources: Vec<Source> = vec![];
    for hit in hits {
        if vault
            .read(&hit.path)
            .map_or(true, |n| !semantic::matches(&n, &hit))
        {
            continue;
        }
        let part = format!(
            "[正文字符 {}–{}]\n{}",
            hit.chunk.start + 1,
            hit.chunk.end,
            hit.chunk.text
        );
        if let Some(s) = sources.iter_mut().find(|s| s.path == hit.path) {
            if !s.text.contains(&part) && s.text.chars().count() + part.chars().count() + 2 <= 5000
            {
                s.text.push_str("\n\n");
                s.text.push_str(&part);
            }
        } else if sources.len() < 10 {
            sources.push(Source {
                id: sources.len() + 1,
                path: hit.path,
                text: part,
                content_hash: hit.hash,
                truncated: true,
            });
        }
    }
    with_access(state, true, |a| workspace::identity(a, id))?;
    Ok(sources)
}
pub fn start(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(20)).await;
            let handle = app.clone();
            let _ = blocking(move || {
                let state = handle.state::<AppState>();
                let runtime = handle.state::<SemanticState>();
                if runtime.busy.load(Ordering::SeqCst) || runtime.paused.load(Ordering::SeqCst) {
                    return Ok(());
                }
                let id = with_access(&state, true, |a| {
                    Ok(if enabled(&a.private) {
                        Some(a.id.clone())
                    } else {
                        None
                    })
                })?;
                if let Some(id) = id {
                    let _job = runtime.job()?;
                    if let Err(e) = reconcile(&handle, &state, &runtime, &id, false) {
                        runtime.report("error", &id, 0, 0, &e.message);
                        if active_id(&state).is_ok_and(|active| active == id) {
                            runtime.paused.store(true, Ordering::SeqCst);
                        }
                    }
                }
                Ok(())
            })
            .await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancellation_and_busy_state_are_reusable_without_network() {
        let runtime = SemanticState::default();
        let job = runtime.job().ok().unwrap();
        assert!(runtime.job().is_err());
        runtime.cancel.store(true, Ordering::SeqCst);
        assert!(runtime.check().is_err());
        drop(job);
        assert!(!runtime.busy.load(Ordering::SeqCst));
        let _job = runtime.job().ok().unwrap();
        assert!(runtime.check().is_ok());
        runtime.report("indexing", "old-vault", 1, 3, "");
        runtime.cancel_vault();
        assert!(runtime.check().is_err());
    }
    #[test]
    fn incomplete_model_and_disabled_vault_never_start_inference() {
        let directory = tempfile::tempdir().unwrap();
        assert!(!ready(directory.path()));
        assert!(!enabled(directory.path()));
        fs::write(directory.path().join("semantic-enabled.json"), "true").unwrap();
        assert!(enabled(directory.path()));
        fs::write(directory.path().join("semantic-enabled.json"), "garbage").unwrap();
        assert!(!enabled(directory.path()));
        let runtime = SemanticState::default();
        assert!(load(&runtime, directory.path()).is_err());
        assert!(runtime.model.lock().unwrap().is_none());
    }
    #[test]
    #[ignore = "requires explicitly downloaded, verified model; set MOZHI_SEMANTIC_TEST_MODEL_DIR"]
    fn real_cpu_model_embeds_synthetic_multilingual_text_without_truncation() {
        let directory = PathBuf::from(std::env::var("MOZHI_SEMANTIC_TEST_MODEL_DIR").unwrap());
        let runtime = SemanticState::default();
        load(&runtime, &directory).ok().unwrap();
        let body = format!("# 测试\n\n{}", "整理笔记，保留技术细节。".repeat(100));
        let (parts, vectors) = infer(&runtime, semantic::chunks(&body), true).ok().unwrap();
        assert_eq!(parts.len(), vectors.len());
        assert!(vectors
            .iter()
            .all(|v| v.len() == 384 && v.iter().all(|x| x.is_finite())));
        let lock = runtime.model.lock().unwrap();
        let model = lock.as_ref().unwrap();
        for part in &parts {
            assert!(model
                .tokenizer
                .encode(part.text.as_str(), true)
                .unwrap()
                .get_overflowing()
                .is_empty());
        }
        drop(lock);
        let mut covered = std::collections::HashSet::new();
        for part in &parts {
            covered.extend(part.start..part.end);
        }
        assert_eq!(covered.len(), body.chars().count());
        let (_, vectors) = infer(
            &runtime,
            vec![Chunk {
                start: 0,
                end: 13,
                text: "How to organize notes? ノートを整理する方法".into(),
            }],
            true,
        )
        .ok()
        .unwrap();
        assert!(!vectors.is_empty());
    }
}
