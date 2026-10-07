//! Long-lived secrets never cross IPC. Native password fields write to OS credential stores.
use crate::{failure, ApiResult};
use mozhi_core::sync::Config;
#[cfg(target_os = "macos")]
use mozhi_core::vault::hash;
#[cfg(target_os = "macos")]
const SERVICE: &str = "app.mozhi.notes.git";
#[cfg(target_os = "macos")]
fn account(config: &Config) -> String {
    hash(format!("{}:{}", config.url, config.username).as_bytes())
}
#[cfg(target_os = "macos")]
pub fn get(config: &Config) -> ApiResult<String> {
    let bytes = security_framework::passwords::get_generic_password(SERVICE, &account(config))
        .map_err(|_| failure("Keychain 中没有可用 Token，请先设置凭据"))?;
    String::from_utf8(bytes).map_err(|_| failure("Keychain 凭据格式无效"))
}
#[cfg(target_os = "macos")]
pub fn prompt(config: &Config) -> ApiResult<bool> {
    prompt_named(
        config,
        SERVICE,
        crate::language::text(
            "保存 Git Token 到 macOS Keychain",
            "Save Git token to macOS Keychain",
            "Git Token を macOS Keychain に保存",
        ),
    )
}
#[cfg(target_os = "macos")]
pub fn prompt_named(config: &Config, service: &str, title: &str) -> ApiResult<bool> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSAlert, NSSecureTextField};
    use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};
    let mtm = MainThreadMarker::new().ok_or_else(|| failure("凭据对话框必须在主线程运行"))?;
    let alert = NSAlert::new(mtm);
    alert.setMessageText(&NSString::from_str(title));
    alert.setInformativeText(&NSString::from_str(&format!(
        "{}: {}\n{}: {}\n{}",
        crate::language::text("服务", "Service", "サービス"),
        config.url,
        crate::language::text("账户", "Account", "アカウント"),
        config.username,
        crate::language::text("凭据仅由原生 Rust 读取，不进入网页、日志或设置文件。", "Credentials are read only by native Rust, never by web pages, logs, or settings files.", "資格情報はネイティブ Rust のみが読み取り、ウェブ画面、ログ、設定ファイルには保存しません。")
    )));
    alert.addButtonWithTitle(&NSString::from_str(crate::language::text(
        "保存", "Save", "保存",
    )));
    alert.addButtonWithTitle(&NSString::from_str(crate::language::text(
        "取消",
        "Cancel",
        "キャンセル",
    )));
    let field = NSSecureTextField::new(mtm);
    field.setFrame(NSRect::new(NSPoint::new(0., 0.), NSSize::new(360., 28.)));
    field.setPlaceholderString(Some(&NSString::from_str(crate::language::text(
        "输入凭据",
        "Enter credential",
        "資格情報を入力",
    ))));
    alert.setAccessoryView(Some(&field));
    if alert.runModal() != 1000 {
        return Ok(false);
    }
    let token = field.stringValue().to_string();
    if token.is_empty() {
        return Err(failure("Token 不能为空"));
    }
    security_framework::passwords::set_generic_password(
        service,
        &account(config),
        token.as_bytes(),
    )
    .map_err(|_| failure("无法写入 Keychain"))?;
    Ok(true)
}
#[cfg(not(any(target_os = "macos", windows)))]
pub fn get(_config: &Config) -> ApiResult<String> {
    Err(failure("此平台尚未实现系统凭据存储"))
}
#[cfg(not(any(target_os = "macos", windows)))]
pub fn prompt(_config: &Config) -> ApiResult<bool> {
    Err(failure("此平台尚未实现系统凭据存储"))
}

#[cfg(windows)]
pub fn get(config: &Config) -> ApiResult<String> {
    mozhi_windows::credentials::get(&mozhi_windows::Config {
        url: config.url.clone(),
        username: config.username.clone(),
    })
    .map_err(failure)
}
#[cfg(windows)]
pub fn prompt(config: &Config) -> ApiResult<bool> {
    mozhi_windows::credentials::prompt_localized(
        &mozhi_windows::Config {
            url: config.url.clone(),
            username: config.username.clone(),
        },
        crate::language::text(
            "墨知 · 保存 Git Token",
            "MoZhi · Save Git token",
            "MoZhi · Git Token を保存",
        ),
        &crate::language::credential_instructions(&config.url, &config.username),
    )
    .map_err(failure)
}
