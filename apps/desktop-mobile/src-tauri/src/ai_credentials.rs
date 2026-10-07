use crate::{failure, ApiResult};
use mozhi_core::ai::Config;
#[cfg(target_os = "macos")]
const SERVICE: &str = "app.mozhi.notes.ai";
#[cfg(target_os = "macos")]
fn account(config: &Config) -> String {
    mozhi_core::vault::hash(format!("{}:ai", config.service().unwrap_or_default()).as_bytes())
}
#[cfg(target_os = "macos")]
pub fn get(config: &Config) -> ApiResult<String> {
    let bytes = security_framework::passwords::get_generic_password(SERVICE, &account(config))
        .map_err(|_| failure("请先设置模型 API Key"))?;
    String::from_utf8(bytes).map_err(|_| failure("模型凭据格式无效"))
}
#[cfg(target_os = "macos")]
pub fn prompt(config: &Config) -> ApiResult<bool> {
    crate::credentials::prompt_named(
        &mozhi_core::sync::Config {
            protocol: "https".into(),
            url: config.service()?,
            branch: "main".into(),
            username: "ai".into(),
        },
        SERVICE,
        crate::language::text(
            "墨知 · 保存模型 API Key",
            "MoZhi · Save model API key",
            "MoZhi · モデル API キーを保存",
        ),
    )
}
#[cfg(target_os = "macos")]
pub fn delete(config: &Config) -> ApiResult<()> {
    if get(config).is_ok() {
        security_framework::passwords::delete_generic_password(SERVICE, &account(config))
            .map_err(|_| failure("无法删除模型凭据"))?;
    }
    Ok(())
}
#[cfg(windows)]
fn windows_config(config: &Config) -> mozhi_windows::Config {
    mozhi_windows::Config {
        url: format!("ai:{}", config.service().unwrap_or_default()),
        username: "ai".into(),
    }
}
#[cfg(windows)]
pub fn get(config: &Config) -> ApiResult<String> {
    mozhi_windows::credentials::get(&windows_config(config)).map_err(failure)
}
#[cfg(windows)]
pub fn prompt(config: &Config) -> ApiResult<bool> {
    mozhi_windows::credentials::prompt_localized(
        &windows_config(config),
        crate::language::text(
            "墨知 · 保存模型 API Key",
            "MoZhi · Save model API key",
            "MoZhi · モデル API キーを保存",
        ),
        &crate::language::credential_instructions(&config.service()?, "ai"),
    )
    .map_err(failure)
}
#[cfg(windows)]
pub fn delete(config: &Config) -> ApiResult<()> {
    mozhi_windows::credentials::delete(&windows_config(config)).map_err(failure)
}
#[cfg(not(any(target_os = "macos", windows)))]
pub fn get(_: &Config) -> ApiResult<String> {
    Err(failure("当前平台不支持原生凭据"))
}
#[cfg(not(any(target_os = "macos", windows)))]
pub fn prompt(_: &Config) -> ApiResult<bool> {
    Err(failure("当前平台不支持原生凭据"))
}
#[cfg(not(any(target_os = "macos", windows)))]
pub fn delete(_: &Config) -> ApiResult<()> {
    Err(failure("当前平台不支持原生凭据"))
}
