use std::sync::RwLock;

static LANGUAGE: RwLock<&'static str> = RwLock::new("en");

#[tauri::command]
pub fn system_locale() -> String {
    sys_locale::get_locale().unwrap_or_else(|| "en".into())
}

#[tauri::command]
pub fn ui_language(app: tauri::AppHandle, language: String) -> Result<(), String> {
    set_language(language)?;
    crate::about::refresh_language(&app);
    Ok(())
}
fn set_language(language: String) -> Result<(), String> {
    let selected = match language.as_str() {
        "zh-CN" => "zh-CN",
        "en" => "en",
        "ja" => "ja",
        _ => return Err("Unsupported language".into()),
    };
    *LANGUAGE.write().map_err(|_| "Language state unavailable")? = selected;
    Ok(())
}

pub fn text<'a>(zh: &'a str, en: &'a str, ja: &'a str) -> &'a str {
    match *LANGUAGE.read().unwrap_or_else(|error| error.into_inner()) {
        "zh-CN" => zh,
        "ja" => ja,
        _ => en,
    }
}

#[cfg(windows)]
pub fn credential_instructions(url: &str, username: &str) -> String {
    format!(
        "{}: {}\n{}: {}\n{}",
        text("服务", "Service", "サービス"), url,
        text("账户", "Account", "アカウント"), username,
        text("请在密码框输入凭据，将保存到当前 Windows 用户的凭据管理器。", "Enter the credential in the password field. It will be saved in the current Windows user's Credential Manager.", "パスワード欄に資格情報を入力してください。現在の Windows ユーザーの資格情報マネージャーに保存します。")
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_only_supported_languages_and_keeps_valid_state_on_invalid_input() {
        for (code, expected) in [("zh-CN", "中文"), ("en", "English"), ("ja", "日本語")] {
            set_language(code.into()).unwrap();
            assert_eq!(text("中文", "English", "日本語"), expected);
        }
        assert!(set_language("invalid".into()).is_err());
        assert_eq!(text("中文", "English", "日本語"), "日本語");
        set_language("en".into()).unwrap();
        assert!(!system_locale().is_empty());
    }
}
