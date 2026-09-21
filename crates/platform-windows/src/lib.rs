//! Windows APIs isolated from the WebView, filesystem core, and libgit2.
#![cfg(windows)]
use sha2::{Digest, Sha256};
#[derive(Clone)]
pub struct Config {
    pub url: String,
    pub username: String,
}
type ApiResult<T> = Result<T, String>;
fn failure(message: &str) -> String {
    message.into()
}
const SERVICE: &str = "app.mozhi.notes.git";
fn account(config: &Config) -> String {
    format!(
        "{:x}",
        Sha256::digest(format!("{}:{}", config.url, config.username).as_bytes())
    )
}
pub mod credentials;
pub mod watcher;
