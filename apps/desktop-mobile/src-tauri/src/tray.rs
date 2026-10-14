use crate::{blocking, failure, workspace, ApiResult, AppState};
use serde::{Deserialize, Serialize};
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

const SHOW_ID: &str = "mozhi-tray-show";
const QUIT_ID: &str = "mozhi-tray-quit";

fn show_label() -> &'static str {
    crate::language::text("显示墨知", "Show MoZhi", "墨知を表示", "顯示墨知")
}
fn quit_label() -> &'static str {
    crate::language::text("退出墨知", "Quit MoZhi", "墨知を終了", "結束墨知")
}

struct TrayMenu {
    show: MenuItem<tauri::Wry>,
    quit: MenuItem<tauri::Wry>,
}

pub fn refresh_language(app: &AppHandle) {
    if let Some(menu) = app.try_state::<TrayMenu>() {
        let _ = menu.show.set_text(show_label());
        let _ = menu.quit.set_text(quit_label());
    }
}

pub fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn request_quit(app: &AppHandle) {
    let hidden = app
        .get_webview_window("main")
        .and_then(|window| window.is_visible().ok())
        == Some(false);
    if hidden && !app.state::<AppState>().1.load(Ordering::SeqCst) {
        app.exit(0);
        return;
    }
    show(app);
    let _ = app.emit("tray_quit_requested", ());
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSchedule {
    vault_id: String,
    enabled: bool,
    on_open: bool,
    after_save: bool,
    idle_seconds: u64,
    interval_minutes: u64,
    opened: bool,
    saved_at: Option<u64>,
    last_sync_at: u64,
    paused: bool,
    blocked: bool,
    #[serde(skip)]
    running: bool,
    #[serde(skip)]
    revision: u64,
    #[serde(skip)]
    last_error: Option<String>,
    #[serde(skip)]
    completed: bool,
}

impl SyncSchedule {
    fn due(&self, now: u64) -> bool {
        self.enabled
            && !self.paused
            && !self.blocked
            && !self.running
            && ((self.opened && self.on_open)
                || (self.after_save
                    && self
                        .saved_at
                        .is_some_and(|at| now.saturating_sub(at) >= self.idle_seconds * 1000))
                || now.saturating_sub(self.last_sync_at) >= self.interval_minutes * 60_000)
    }
    fn validate(&self) -> ApiResult<()> {
        if !(10..=600).contains(&self.idle_seconds) || !(1..=60).contains(&self.interval_minutes) {
            return Err(failure("自动同步间隔无效"));
        }
        Ok(())
    }
}

#[derive(Default)]
pub struct TraySyncState(Mutex<Option<SyncSchedule>>, AtomicU64);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    vault_id: String,
    running: bool,
    revision: u64,
    last_sync_at: u64,
    last_error: Option<String>,
    completed: bool,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[tauri::command]
pub fn hide_to_tray(app: AppHandle, mut schedule: Option<SyncSchedule>) -> ApiResult<()> {
    if app.state::<AppState>().1.load(Ordering::SeqCst) {
        return Err(failure("请等待同步完成后再关闭窗口"));
    }
    if let Some(ref schedule) = schedule {
        schedule.validate()?;
        let state = app.state::<AppState>();
        crate::with_access(&state, true, |active| {
            workspace::identity(active, &schedule.vault_id)
        })?;
    }
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| failure("主窗口不可用"))?;
    window.hide().map_err(failure)?;
    let state = app.state::<TraySyncState>();
    if let Some(ref mut schedule) = schedule {
        schedule.revision = state.1.fetch_add(2, Ordering::SeqCst) + 2;
    }
    *state.0.lock().map_err(failure)? = schedule;
    Ok(())
}

#[tauri::command]
pub fn tray_sync_status(app: AppHandle) -> ApiResult<Option<SyncStatus>> {
    let guard = app.state::<TraySyncState>();
    let schedule = guard.0.lock().map_err(failure)?;
    Ok(schedule.as_ref().map(|s| SyncStatus {
        vault_id: s.vault_id.clone(),
        running: s.running,
        revision: s.revision,
        last_sync_at: s.last_sync_at,
        last_error: s.last_error.clone(),
        completed: s.completed,
    }))
}

#[tauri::command]
pub fn quit_app(app: AppHandle) -> ApiResult<()> {
    if app.state::<AppState>().1.load(Ordering::SeqCst) {
        return Err(failure("请等待同步完成后再退出"));
    }
    app.exit(0);
    Ok(())
}

pub fn mark_saved(app: &AppHandle, vault_id: &str) {
    if let Ok(mut state) = app.state::<TraySyncState>().0.lock() {
        if let Some(schedule) = state
            .as_mut()
            .filter(|schedule| schedule.vault_id == vault_id)
        {
            schedule.saved_at = Some(now_ms());
        }
    }
}

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, SHOW_ID, show_label(), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT_ID, quit_label(), true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let builder = TrayIconBuilder::new()
        .tooltip("墨知 · MoZhi")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            SHOW_ID => self::show(app),
            QUIT_ID => request_quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } | TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                }
            ) {
                self::show(tray.app_handle());
            }
        });
    #[cfg(target_os = "macos")]
    let builder = builder
        .icon(Image::new(TRAY_ICON_RGBA, 32, 32))
        .icon_as_template(true);
    #[cfg(not(target_os = "macos"))]
    let builder = builder.icon(
        app.default_window_icon()
            .ok_or(tauri::Error::FailedToReceiveMessage)?
            .clone(),
    );
    builder.build(app)?;
    app.manage(TrayMenu { show, quit });
    Ok(())
}

#[cfg(target_os = "macos")]
const TRAY_ICON_RGBA: &[u8] = include_bytes!("../icons/tray-template.rgba");

pub fn start_sync_timer(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut timer = tokio::time::interval(Duration::from_secs(5));
        loop {
            timer.tick().await;
            if app
                .get_webview_window("main")
                .and_then(|w| w.is_visible().ok())
                != Some(false)
            {
                continue;
            }
            let due = {
                let state = app.state::<TraySyncState>();
                let Ok(mut guard) = state.0.lock() else {
                    continue;
                };
                guard.as_mut().filter(|s| s.due(now_ms())).map(|s| {
                    s.running = true;
                    (s.vault_id.clone(), s.revision)
                })
            };
            let Some((vault_id, revision)) = due else {
                continue;
            };
            let _ = app.emit("tray_sync_started", &vault_id);
            let state = app.state::<AppState>().inner().clone();
            let sync_app = app.clone();
            let sync_id = vault_id.clone();
            let result =
                blocking(move || workspace::background_sync(&sync_app, &state, &sync_id)).await;
            let error = result.as_ref().err().map(|e| e.message.clone());
            let updated = {
                let state = app.state::<TraySyncState>();
                let Ok(mut guard) = state.0.lock() else {
                    continue;
                };
                if let Some(schedule) = guard
                    .as_mut()
                    .filter(|s| s.vault_id == vault_id && s.revision == revision)
                {
                    schedule.running = false;
                    schedule.revision += 1;
                    schedule.completed = true;
                    schedule.last_error = error.clone();
                    if error.is_some() {
                        schedule.paused = true;
                    } else {
                        schedule.opened = false;
                        schedule.saved_at = None;
                        schedule.last_sync_at = now_ms();
                    }
                    true
                } else {
                    false
                }
            };
            if updated {
                let _ = app.emit("tray_sync_finished", &vault_id);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    fn schedule() -> SyncSchedule {
        SyncSchedule {
            vault_id: "test".into(),
            enabled: true,
            on_open: false,
            after_save: true,
            idle_seconds: 30,
            interval_minutes: 5,
            opened: false,
            saved_at: Some(1_000),
            last_sync_at: 1_000,
            paused: false,
            blocked: false,
            running: false,
            revision: 0,
            last_error: None,
            completed: false,
        }
    }
    #[test]
    fn background_sync_respects_idle_interval_and_pause() {
        let mut s = schedule();
        assert!(!s.due(30_999));
        assert!(s.due(31_000));
        s.running = true;
        assert!(!s.due(31_000));
        s.running = false;
        s.paused = true;
        assert!(!s.due(31_000));
        s.paused = false;
        s.blocked = true;
        assert!(!s.due(31_000));
        s.blocked = false;
        s.saved_at = None;
        assert!(s.due(301_000));
    }
}
