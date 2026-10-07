use tauri::{
    menu::{Menu, MenuItem},
    AppHandle, Manager, WebviewUrl, WebviewWindowBuilder,
};

pub const MENU_ID: &str = "mozhi-about";
pub fn title() -> &'static str {
    crate::language::text("关于墨知", "About MoZhi", "MoZhi について")
}

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let menu = Menu::default(app)?;
    let items = menu.items()?;
    #[cfg(target_os = "macos")]
    let submenu = items.first().and_then(|item| item.as_submenu());
    #[cfg(not(target_os = "macos"))]
    let submenu = items
        .iter()
        .find(|item| item.id().as_ref() == tauri::menu::HELP_SUBMENU_ID)
        .and_then(|item| item.as_submenu());
    if let Some(submenu) = submenu {
        // The default menu places the native About action first in this submenu.
        submenu.remove_at(0)?;
        submenu.insert(
            &MenuItem::with_id(app, MENU_ID, title(), true, None::<&str>)?,
            0,
        )?;
    }
    app.set_menu(menu)?;
    Ok(())
}

pub fn refresh_language(app: &AppHandle) {
    if let Some(menu) = app.menu() {
        for item in menu.items().unwrap_or_default() {
            if let Some(item) = item.as_submenu().and_then(|submenu| submenu.get(MENU_ID)) {
                if let Some(item) = item.as_menuitem() {
                    let _ = item.set_text(title());
                }
            }
        }
    }
    if let Some(window) = app.get_webview_window("about") {
        let _ = window.set_title(title());
    }
}

pub fn open(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("about") {
        window.show()?;
        return window.set_focus();
    }
    let mut builder = WebviewWindowBuilder::new(
        app,
        "about",
        WebviewUrl::App("index.html?view=about".into()),
    )
    .title(title())
    .inner_size(440., 480.)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .skip_taskbar(true)
    .center();
    if let Some(main) = app.get_webview_window("main") {
        builder = builder.parent(&main)?;
    }
    builder.build()?;
    Ok(())
}
