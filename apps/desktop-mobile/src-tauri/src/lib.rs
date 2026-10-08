mod about;
mod ai;
mod ai_credentials;
mod credentials;
mod demo;
mod file_manager;
mod language;
mod ssh_agent;
mod vault_history;
mod watcher;
mod workspace;
use mozhi_core::{
    git_probe,
    search::{self, SearchIndex, SearchResults},
    vault::{self, Entry, Note, Vault},
    Error,
};
use serde::Serialize;
use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

struct Active {
    demo: bool,
    vault: Vault,
    index: SearchIndex,
    id: String,
    private: PathBuf,
    _watcher: Option<watcher::Watcher>,
    recovery_warnings: Vec<String>,
}
#[derive(Clone, Default)]
struct AppState(
    Arc<Mutex<Option<Active>>>,
    Arc<std::sync::atomic::AtomicBool>,
);
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiError {
    code: &'static str,
    message: String,
}
impl From<Error> for ApiError {
    fn from(error: Error) -> Self {
        let code = match &error {
            Error::Conflict => "CONTENT_CONFLICT",
            Error::InvalidPath => "INVALID_PATH",
            Error::TooLarge => "NOTE_TOO_LARGE",
            _ => "OPERATION_FAILED",
        };
        Self {
            code,
            message: error.to_string(),
        }
    }
}
type ApiResult<T> = Result<T, ApiError>;
fn failure(message: impl ToString) -> ApiError {
    ApiError {
        code: "OPERATION_FAILED",
        message: message.to_string(),
    }
}
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> ApiResult<T> + Send + 'static,
) -> ApiResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(failure)?
}
fn with_active<T>(state: &AppState, f: impl FnOnce(&mut Active) -> ApiResult<T>) -> ApiResult<T> {
    with_access(state, false, f)
}
fn with_access<T>(
    state: &AppState,
    read: bool,
    f: impl FnOnce(&mut Active) -> ApiResult<T>,
) -> ApiResult<T> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| failure("笔记库正在执行操作，请稍后重试"))?;
    let active = guard.as_mut().ok_or_else(|| failure("请先打开笔记库"))?;
    if !read && state.1.load(std::sync::atomic::Ordering::SeqCst) {
        return Err(failure("同步期间暂不能修改笔记库，请等待同步完成"));
    }
    // Network phases release vault.lock; sync.lock still excludes all mutations.
    let sync_lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(active.private.join("sync.lock"))
        .map_err(failure)?;
    if !read {
        fs2::FileExt::try_lock_shared(&sync_lock)
            .map_err(|_| failure("笔记库正在同步，请等待同步完成后修改"))?;
    }
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(active.private.join("vault.lock"))
        .map_err(failure)?;
    let result = if read {
        fs2::FileExt::lock_shared(&lock)
    } else {
        fs2::FileExt::try_lock_exclusive(&lock)
    };
    result.map_err(|_| failure("笔记库正在被另一个窗口或进程操作"))?;
    f(active)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenedVault {
    id: String,
    name: String,
    demo: bool,
    entries: Vec<Entry>,
    skipped: Vec<String>,
}
fn activate(app: &tauri::AppHandle, state: &AppState, root: PathBuf) -> ApiResult<OpenedVault> {
    let mut guard = state.0.lock().map_err(failure)?;
    if state.1.load(std::sync::atomic::Ordering::SeqCst) {
        return Err(failure("请等待同步完成后切换笔记库"));
    }
    app.state::<ai::AiState>().cancel_all();
    let root = root.canonicalize().map_err(failure)?;
    let demo = demo::is_demo(&app.path().app_data_dir().map_err(failure)?, &root);
    let key = vault::hash(root.to_string_lossy().as_bytes());
    let private = app
        .path()
        .app_data_dir()
        .map_err(failure)?
        .join("vaults")
        .join(&key);
    fs::create_dir_all(&private).map_err(failure)?;
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(private.join("vault.lock"))
        .map_err(failure)?;
    fs2::FileExt::try_lock_exclusive(&lock).map_err(|_| failure("笔记库正在被另一个进程操作"))?;
    let vault = Vault::open(&root, &private.join("recovery"))?;
    if demo {
        demo::update_welcome(&vault)?;
    }
    let entries = vault.list()?;
    if entries.len() > 10_000 {
        return Err(failure("当前笔记库上限为 10000 篇，请选择更小的目录"));
    }
    let mut notes = Vec::new();
    let mut skipped = Vec::new();
    for entry in &entries {
        match vault.read(&entry.path) {
            Ok(note) => notes.push((note.path, note.content)),
            Err(_) => skipped.push(entry.path.clone()),
        }
    }
    let mut index = SearchIndex::open(&private.join("index.sqlite"))?;
    index.replace_all(&notes)?;
    let name = root
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let saved_root = root.to_string_lossy().to_string();
    vault_history::remember(&app.path().app_data_dir().map_err(failure)?, &saved_root)?;
    vault::atomic_write(
        &app.path()
            .app_data_dir()
            .map_err(failure)?
            .join("last-vault.json"),
        &serde_json::to_vec(&saved_root).unwrap(),
    )?;
    let watcher = watcher::Watcher::start(app.clone(), &root, key.clone());
    let recovery_warnings = workspace::automatic_recovery_cleanup(&vault);
    *guard = Some(Active {
        demo,
        vault,
        index,
        id: key.clone(),
        private,
        _watcher: watcher,
        recovery_warnings,
    });
    Ok(OpenedVault {
        id: key,
        name,
        demo,
        entries,
        skipped,
    })
}
#[tauri::command]
async fn open_demo(app: tauri::AppHandle, state: State<'_, AppState>) -> ApiResult<OpenedVault> {
    let state = state.inner().clone();
    blocking(move || {
        let settings = app
            .path()
            .app_data_dir()
            .map_err(failure)?
            .join("last-vault.json");
        if let Ok(bytes) = fs::read(settings) {
            if let Ok(path) = serde_json::from_slice::<String>(&bytes) {
                if std::path::Path::new(&path).is_dir() {
                    return activate(&app, &state, PathBuf::from(path));
                }
            }
        }
        activate(&app, &state, demo_root(&app)?)
    })
    .await
}
fn demo_root(app: &tauri::AppHandle) -> ApiResult<PathBuf> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(failure)?
        .join("墨知示例笔记");
    fs::create_dir_all(&root).map_err(failure)?;
    for (name, content) in [
        (
            "欢迎使用.md",
            include_str!("../../../../tests/fixtures/欢迎使用.md"),
        ),
        (
            "中文输入检查.md",
            include_str!("../../../../tests/fixtures/中文输入检查.md"),
        ),
        (
            "项目计划.md",
            include_str!("../../../../tests/fixtures/项目计划.md"),
        ),
    ] {
        let path = root.join(name);
        if !path.exists() {
            vault::atomic_write(&path, content.as_bytes())?;
        }
    }
    Ok(root)
}
#[tauri::command]
async fn open_vault(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> ApiResult<Option<OpenedVault>> {
    let state = state.inner().clone();
    blocking(move || {
        let Some(path) = app
            .dialog()
            .file()
            .set_title(language::text(
                "选择 Markdown 笔记目录",
                "Choose Markdown vault folder",
                "Markdown 保管庫のフォルダーを選択",
            ))
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        let root = path.into_path().map_err(failure)?;
        activate(&app, &state, root).map(Some)
    })
    .await
}
#[tauri::command]
async fn read_note(state: State<'_, AppState>, vault_id: String, path: String) -> ApiResult<Note> {
    let state = state.inner().clone();
    blocking(move || {
        with_access(&state, true, |a| {
            workspace::identity(a, &vault_id)?;
            Ok(a.vault.read(&path)?)
        })
    })
    .await
}
#[tauri::command]
async fn read_draft(
    state: State<'_, AppState>,
    vault_id: String,
    path: String,
) -> ApiResult<Option<String>> {
    let state = state.inner().clone();
    blocking(move || {
        with_access(&state, true, |a| {
            workspace::identity(a, &vault_id)?;
            Ok(a.vault.read_draft(&path)?)
        })
    })
    .await
}
#[tauri::command]
async fn save_draft(
    state: State<'_, AppState>,
    vault_id: String,
    path: String,
    content: String,
) -> ApiResult<()> {
    let state = state.inner().clone();
    blocking(move || {
        with_active(&state, |a| {
            workspace::identity(a, &vault_id)?;
            Ok(a.vault.draft(&path, &content)?)
        })
    })
    .await
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveResult {
    note: Note,
    index_warning: Option<String>,
}
#[tauri::command]
async fn save_note(
    state: State<'_, AppState>,
    vault_id: String,
    path: String,
    expected_content_hash: String,
    content: String,
) -> ApiResult<SaveResult> {
    let state = state.inner().clone();
    blocking(move || {
        with_active(&state, |a| {
            workspace::identity(a, &vault_id)?;
            if a.private.join("sync-pending.json").exists() {
                return Err(failure("存在未完成同步或冲突，请先处理；草稿可以继续保留"));
            }
            let note = a.vault.save(&path, &expected_content_hash, &content)?;
            // Disk success must remain success even if the rebuildable index fails.
            let index_warning = a
                .index
                .upsert(&path, &content)
                .err()
                .map(|_| "笔记已保存，搜索索引更新失败；请重新打开笔记库重建索引".into());
            Ok(SaveResult {
                note,
                index_warning,
            })
        })
    })
    .await
}
#[tauri::command]
async fn search_notes(
    state: State<'_, AppState>,
    vault_id: String,
    query: String,
    directory: String,
) -> ApiResult<SearchResults> {
    let state = state.inner().clone();
    blocking(move || {
        with_active(&state, |a| {
            workspace::identity(a, &vault_id)?;
            Ok(a.index.query(&query, &directory)?)
        })
    })
    .await
}
#[tauri::command]
async fn run_probes() -> ApiResult<serde_json::Value> {
    blocking(move || {
        Ok(serde_json::json!({ "search": search::benchmark(10_000)?, "git": git_probe::run()? }))
    })
    .await
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .manage(ai::AiState::default())
        .setup(|app| {
            about::install(app.handle())?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == about::MENU_ID {
                if let Err(error) = about::open(app) {
                    eprintln!("Could not open About window: {error}");
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            workspace::workspace,
            ai::ai_request,
            ai::ai_key,
            workspace::set_credentials,
            workspace::clone_vault,
            ssh_agent::select_ssh_key,
            ssh_agent::check_ssh_agent,
            open_demo,
            language::system_locale,
            language::ui_language,
            open_vault,
            vault_history::vault_catalog,
            read_note,
            read_draft,
            save_draft,
            save_note,
            search_notes,
            run_probes
        ])
        .run(tauri::generate_context!())
        .expect("无法启动墨知");
}
