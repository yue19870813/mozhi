//! Per-vault ownership stops the Windows listener when switching libraries.
#[cfg(windows)]
pub struct Watcher {
    _inner: mozhi_windows::watcher::Watcher,
}
#[cfg(windows)]
impl Watcher {
    pub fn start(app: tauri::AppHandle, root: &std::path::Path, vault_id: String) -> Option<Self> {
        use tauri::Emitter;
        mozhi_windows::watcher::Watcher::start(
            move |sequence| {
                let _ = app.emit(
                    "vault_files_changed",
                    serde_json::json!({"vaultId":vault_id,"sequence":sequence}),
                );
            },
            root,
        )
        .map(|inner| Self { _inner: inner })
    }
}
#[cfg(not(windows))]
pub struct Watcher;
#[cfg(not(windows))]
impl Watcher {
    pub fn start(
        _app: tauri::AppHandle,
        _root: &std::path::Path,
        _vault_id: String,
    ) -> Option<Self> {
        None
    }
}
