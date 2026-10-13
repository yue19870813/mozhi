use crate::{failure, ApiResult};
#[cfg(windows)]
fn config() -> mozhi_windows::Config {
    mozhi_windows::Config {
        url: "mcp:local".into(),
        username: "server".into(),
    }
}
pub fn get() -> ApiResult<String> {
    #[cfg(target_os = "macos")]
    {
        let b = security_framework::passwords::get_generic_password(
            "app.mozhi.notes.mcp",
            "local-server",
        )
        .map_err(|e| crate::credentials::keychain_error(e.code()))?;
        String::from_utf8(b).map_err(|_| failure("MCP 凭据无效"))
    }
    #[cfg(windows)]
    {
        mozhi_windows::credentials::get(&config()).map_err(failure)
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        Err(failure("当前平台不支持 MCP 凭据"))
    }
}
pub fn generate() -> ApiResult<String> {
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    #[cfg(target_os = "macos")]
    security_framework::passwords::set_generic_password(
        "app.mozhi.notes.mcp",
        "local-server",
        token.as_bytes(),
    )
    .map_err(|e| crate::credentials::keychain_error(e.code()))?;
    #[cfg(windows)]
    mozhi_windows::credentials::store(&config(), token.as_bytes()).map_err(failure)?;
    #[cfg(not(any(target_os = "macos", windows)))]
    return Err(failure("当前平台不支持 MCP 凭据"));
    #[cfg(any(target_os = "macos", windows))]
    Ok(token)
}
pub fn show() -> ApiResult<()> {
    let token = get()?;
    #[cfg(target_os = "macos")]
    {
        use objc2::MainThreadMarker;
        use objc2_app_kit::{NSAlert, NSPasteboard, NSPasteboardTypeString, NSTextField};
        use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};
        let mtm = MainThreadMarker::new().ok_or_else(|| failure("原生窗口必须在主线程运行"))?;
        let alert = NSAlert::new(mtm);
        alert.setMessageText(&NSString::from_str("MoZhi MCP Token"));
        alert.setInformativeText(&NSString::from_str(crate::language::text(
            "选中令牌后按 ⌘C 复制。请勿分享或写入笔记库。",
            "Select the token and press ⌘C to copy. Do not share or store it in your vault.",
            "トークンを選択して ⌘C でコピー。共有やノート庫への保存は避けてください。",
            "選中令牌後按 ⌘C 複製。請勿分享或寫入筆記庫。",
        )));
        let field = NSTextField::new(mtm);
        field.setFrame(NSRect::new(NSPoint::new(0., 0.), NSSize::new(550., 28.)));
        field.setStringValue(&NSString::from_str(&token));
        field.setEditable(false);
        field.setSelectable(true);
        alert.setAccessoryView(Some(&field));
        alert.addButtonWithTitle(&NSString::from_str(crate::language::text(
            "复制令牌",
            "Copy token",
            "トークンをコピー",
            "複製令牌",
        )));
        alert.addButtonWithTitle(&NSString::from_str(crate::language::text(
            "关闭",
            "Close",
            "閉じる",
            "關閉",
        )));
        if alert.runModal() == 1000 {
            let board = NSPasteboard::generalPasteboard();
            board.clearContents();
            // SAFETY: AppKit's immutable global string constant is initialized by the framework.
            if !board.setString_forType(&NSString::from_str(&token), unsafe {
                NSPasteboardTypeString
            }) {
                return Err(failure("无法复制 MCP 令牌"));
            }
        }
    }
    #[cfg(windows)]
    mozhi_windows::credentials::show_local_secret(
        &token,
        crate::language::text(
            "是否复制访问令牌？",
            "Copy this access token?",
            "アクセストークンをコピーしますか？",
            "是否複製訪問令牌？",
        ),
    )
    .map_err(failure)?;
    Ok(())
}

/// Never replace a credential merely because the keychain is locked or access denied.
pub fn ensure() -> ApiResult<()> {
    #[cfg(target_os = "macos")]
    match security_framework::passwords::get_generic_password("app.mozhi.notes.mcp", "local-server")
    {
        Ok(_) => Ok(()),
        Err(e) if e.code() == -25300 => generate().map(|_| ()),
        Err(e) => Err(crate::credentials::keychain_error(e.code())),
    }
    #[cfg(windows)]
    {
        mozhi_windows::credentials::ensure_local(&config(), || {
            format!(
                "{}{}",
                uuid::Uuid::new_v4().simple(),
                uuid::Uuid::new_v4().simple()
            )
        })
        .map_err(failure)
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        Err(failure("当前平台不支持 MCP 凭据"))
    }
}
