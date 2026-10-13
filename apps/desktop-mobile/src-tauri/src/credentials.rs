//! Long-lived secrets never cross IPC. Native password fields write to OS credential stores.
use crate::{failure, ApiResult};
use mozhi_core::sync::Config;
#[cfg(target_os = "macos")]
use mozhi_core::vault::hash;
#[cfg(target_os = "macos")]
const SERVICE: &str = "app.mozhi.notes.git";
#[cfg(target_os = "macos")]
pub(crate) fn keychain_error(code: i32) -> crate::ApiError {
    let message = match code {
        -67050 | -67045 => crate::language::text("Keychain 拒绝当前应用签名。请退出并重新打开墨知；开发版重新编译后，可能需要在“钥匙串访问”中重新授权该凭据。", "Keychain rejected the app signature. Quit and reopen MoZhi; rebuilt development apps may need credential access authorized again in Keychain Access.", "Keychain がアプリの署名を拒否しました。MoZhi を終了して再起動してください。開発版の再ビルド後はキーチェーンアクセスで再認証が必要な場合があります。", "Keychain 拒絕當前應用簽名。請退出並重新打開墨知；開發版重新編譯後，可能需要在“鑰匙串訪問”中重新授權該憑據。"),
        -25293 | -25308 => crate::language::text("Keychain 访问被拒绝或钥匙串已锁定。请在“钥匙串访问”中解锁登录钥匙串，并允许墨知访问该凭据。", "Keychain access was denied or locked. Unlock the login keychain in Keychain Access and allow MoZhi to access this credential.", "Keychain へのアクセスが拒否されたか、ロックされています。キーチェーンアクセスでログインキーチェーンを解除し、MoZhi にアクセスを許可してください。", "Keychain 訪問被拒絕或鑰匙串已鎖定。請在“鑰匙串訪問”中解鎖登錄鑰匙串，並允許墨知訪問該憑據。"),
        -128 => crate::language::text("已取消 Keychain 授权", "Keychain authorization cancelled", "Keychain の認証がキャンセルされました", "已取消 Keychain 授權"),
        _ => crate::language::text("无法访问 Keychain", "Could not access Keychain", "Keychain にアクセスできませんでした", "無法訪問 Keychain"),
    };
    // Only the OS status is exposed, never the secret or arbitrary native error text.
    failure(format!("{message} (OSStatus {code})"))
}
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
            "保存 Git Token 到 macOS Keychain",
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
        crate::language::text("服务", "Service", "サービス", "服務"),
        config.url,
        crate::language::text("账户", "Account", "アカウント", "賬戶"),
        config.username,
        crate::language::text("凭据仅由原生 Rust 读取，不进入网页、日志或设置文件。", "Credentials are read only by native Rust, never by web pages, logs, or settings files.", "資格情報はネイティブ Rust のみが読み取り、ウェブ画面、ログ、設定ファイルには保存しません。", "憑據僅由原生 Rust 讀取，不進入網頁、日誌或設置文件。")
    )));
    alert.addButtonWithTitle(&NSString::from_str(crate::language::text(
        "保存", "Save", "保存", "保存",
    )));
    alert.addButtonWithTitle(&NSString::from_str(crate::language::text(
        "取消",
        "Cancel",
        "キャンセル",
        "取消",
    )));
    let field = NSSecureTextField::new(mtm);
    field.setFrame(NSRect::new(NSPoint::new(0., 0.), NSSize::new(360., 28.)));
    field.setPlaceholderString(Some(&NSString::from_str(crate::language::text(
        "输入凭据",
        "Enter credential",
        "資格情報を入力",
        "輸入憑據",
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
    .map_err(|error| keychain_error(error.code()))?;
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
            "墨知 · 保存 Git Token",
        ),
        &crate::language::credential_instructions(&config.url, &config.username),
    )
    .map_err(failure)
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    #[test]
    fn keychain_errors_distinguish_signature_permissions_and_cancel() {
        for code in [-67050, -67045, -25293, -25308, -128, -36] {
            let error = super::keychain_error(code);
            assert!(error.message.contains(&format!("OSStatus {code}")));
        }
        assert_ne!(
            super::keychain_error(-67050).message,
            super::keychain_error(-25293).message
        );
        assert_ne!(
            super::keychain_error(-128).message,
            super::keychain_error(-36).message
        );
    }

    #[test]
    #[ignore = "writes only a disposable synthetic credential to the login keychain"]
    fn disposable_native_keychain_credential_can_be_created_updated_and_removed() {
        let service = "app.mozhi.notes.test-keychain";
        let account = format!(
            "{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let result = (|| {
            security_framework::passwords::set_generic_password(
                service,
                &account,
                b"synthetic-first",
            )?;
            security_framework::passwords::set_generic_password(
                service,
                &account,
                b"synthetic-second",
            )?;
            let value = security_framework::passwords::get_generic_password(service, &account)?;
            assert!(value == b"synthetic-second");
            Ok::<(), security_framework::base::Error>(())
        })();
        let cleanup = security_framework::passwords::delete_generic_password(service, &account);
        if let Err(error) = result {
            panic!("Synthetic keychain test failed: OSStatus {}", error.code());
        }
        assert!(cleanup.is_ok());
    }
}
