use crate::{failure, ApiResult};
use tauri::AppHandle;

#[derive(Default)]
pub struct TraySyncState;

#[tauri::command]
pub fn hide_to_tray(_app: AppHandle) -> ApiResult<()> {
    Err(failure("此设备不支持系统托盘"))
}

#[tauri::command]
pub fn tray_sync_status() -> ApiResult<Option<()>> {
    Ok(None)
}

#[tauri::command]
pub fn quit_app(app: AppHandle) -> ApiResult<()> {
    app.exit(0);
    Ok(())
}

pub fn mark_saved(_app: &AppHandle, _vault_id: &str) {}

pub fn install(_app: &AppHandle) -> tauri::Result<()> {
    Ok(())
}

pub fn start_sync_timer(_app: AppHandle) {}

pub fn request_quit(app: &AppHandle) {
    app.exit(0);
}
