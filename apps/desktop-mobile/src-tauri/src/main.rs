#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    #[cfg(windows)]
    if let Some(code) = mozhi_windows::ssh_agent::dispatch_askpass() {
        std::process::exit(code);
    }
    mozhi_lib::run()
}
