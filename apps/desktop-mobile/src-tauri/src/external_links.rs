fn validated_url(value: &str) -> Result<String, String> {
    if value.len() > 8192 || value.chars().any(char::is_control) {
        return Err("Invalid web link".into());
    }
    let url = reqwest::Url::parse(value).map_err(|_| "Invalid web link")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Invalid web link".into());
    }
    Ok(url.into())
}

#[tauri::command]
pub fn open_external_link(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let url = validated_url(&url)?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| "Could not open web link".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_web_urls_without_embedded_credentials() {
        for url in [
            "https://example.com/中文?q=a%20b#section",
            "http://localhost:8080/page",
        ] {
            assert!(validated_url(url).is_ok());
        }
        for url in [
            "javascript:alert(1)",
            "file:///tmp/note.md",
            "data:text/html,test",
            "mailto:user@example.com",
            "//example.com",
            "../note.md",
            "https://user:secret@example.com",
            "https://example.com\n",
            "",
        ] {
            assert!(validated_url(url).is_err(), "{url}");
        }
        assert!(validated_url(&format!("https://example.com/{}", "a".repeat(8192))).is_err());
    }
}
