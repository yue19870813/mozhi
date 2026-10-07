#[cfg(target_os = "macos")]
use crate::blocking;
use crate::{failure, ApiResult};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    key_count: usize,
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use std::{
        fs,
        os::unix::fs::PermissionsExt,
        path::Path,
        process::{Command, Output, Stdio},
    };
    use tauri_plugin_dialog::DialogExt;

    const ASKPASS: &str = "#!/bin/sh\nexec /usr/bin/osascript -e 'text returned of (display dialog \"请输入所选 SSH 私钥的密码\" with title \"墨知 · 加载 SSH 密钥\" default answer \"\" with hidden answer buttons {\"取消\", \"加载\"} default button \"加载\" cancel button \"取消\")'\n";

    fn command() -> Command {
        let mut command = Command::new("/usr/bin/ssh-add");
        command.stdin(Stdio::null());
        command
    }

    fn add_command(path: &Path, askpass: &Path) -> Command {
        let mut command = command();
        command
            .arg("-q")
            .arg("--")
            .arg(path)
            .env("SSH_ASKPASS", askpass)
            .env("SSH_ASKPASS_REQUIRE", "force")
            .env("DISPLAY", "mozhi");
        command
    }

    pub(super) fn status() -> ApiResult<AgentStatus> {
        let output = command()
            .arg("-l")
            .output()
            .map_err(|_| failure("无法启动系统 ssh-add"))?;
        status_from_output(&output)
    }

    fn status_from_output(output: &Output) -> ApiResult<AgentStatus> {
        match output.status.code() {
            Some(0) => Ok(AgentStatus {
                key_count: String::from_utf8_lossy(&output.stdout).lines().count(),
            }),
            Some(1) => Err(failure("SSH Agent 尚未加载密钥，请选择 SSH 私钥")),
            _ => Err(failure(
                "无法连接系统 SSH Agent，请重启墨知或检查系统 Agent",
            )),
        }
    }

    fn validate_key(path: &Path) -> ApiResult<()> {
        let meta =
            fs::symlink_metadata(path).map_err(|_| failure("所选密钥文件不存在或无法访问"))?;
        if !meta.is_file() || meta.permissions().mode() & 0o077 != 0 {
            return Err(failure(
                "请选择仅当前用户可访问的普通私钥文件（权限 600），不支持符号链接",
            ));
        }
        if path.extension().is_some_and(|ext| ext == "pub") {
            return Err(failure("请选择 SSH 私钥，而非 .pub 公钥文件"));
        }
        Ok(())
    }

    pub(super) fn select(app: tauri::AppHandle) -> ApiResult<Option<AgentStatus>> {
        let mut dialog = app.dialog().file().set_title(crate::language::text(
            "选择 SSH 私钥（非 .pub 公钥）",
            "Choose SSH private key (not a .pub public key)",
            "SSH 秘密鍵を選択（.pub 公開鍵以外）",
        ));
        if let Some(home) = std::env::var_os("HOME") {
            let directory = std::path::PathBuf::from(home).join(".ssh");
            if directory.is_dir() {
                dialog = dialog.set_directory(directory);
            }
        }
        let Some(file) = dialog.blocking_pick_file() else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|_| failure("私钥文件路径无效"))?;
        validate_key(&path)?;
        let helper = tempfile::tempdir().map_err(|_| failure("无法创建系统密码对话框"))?;
        let askpass = helper.path().join("askpass");
        fs::write(&askpass, ASKPASS).map_err(|_| failure("无法创建系统密码对话框"))?;
        fs::set_permissions(&askpass, fs::Permissions::from_mode(0o700))
            .map_err(|_| failure("无法创建系统密码对话框"))?;
        let output = add_command(&path, &askpass)
            .output()
            .map_err(|_| failure("无法启动系统 ssh-add"))?;
        // Never return subprocess output: it can contain private paths or prompt details.
        match output.status.code() {
            Some(0) => status().map(Some),
            Some(2) => Err(failure(
                "无法连接系统 SSH Agent，请重启墨知或检查系统 Agent",
            )),
            _ => Err(failure(
                "密钥未加载：密码输入已取消、密码错误或私钥格式不受支持",
            )),
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::{os::unix::process::ExitStatusExt, process::Child};

        struct TestAgent(Child);
        impl Drop for TestAgent {
            fn drop(&mut self) {
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }

        #[test]
        fn reports_agent_state_without_exposing_subprocess_output() {
            let output = |code, stdout: &str| Output {
                status: std::process::ExitStatus::from_raw(code << 8),
                stdout: stdout.as_bytes().to_vec(),
                stderr: b"private prompt details".to_vec(),
            };
            assert_eq!(
                status_from_output(&output(0, "key one\nkey two\n"))
                    .ok()
                    .unwrap()
                    .key_count,
                2
            );
            assert!(status_from_output(&output(1, ""))
                .err()
                .unwrap()
                .message
                .contains("尚未加载"));
            assert!(status_from_output(&output(2, ""))
                .err()
                .unwrap()
                .message
                .contains("无法连接"));
        }

        #[test]
        fn loads_encrypted_key_with_spaces_using_askpass_into_isolated_agent() {
            let directory = tempfile::tempdir().unwrap();
            let socket = directory.path().join("agent.sock");
            let mut agent = TestAgent(
                Command::new("/usr/bin/ssh-agent")
                    .args(["-D", "-a"])
                    .arg(&socket)
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                    .unwrap(),
            );
            for _ in 0..100 {
                if socket.exists() {
                    break;
                }
                assert!(agent.0.try_wait().unwrap().is_none());
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            assert!(socket.exists());
            let key = directory.path().join("test key ; literal");
            assert!(Command::new("/usr/bin/ssh-keygen")
                .args(["-q", "-t", "ed25519", "-N", "test-only-passphrase", "-f"])
                .arg(&key)
                .status()
                .unwrap()
                .success());
            assert!(validate_key(&key).is_ok());
            let helper = directory.path().join("askpass");
            fs::write(
                &helper,
                "#!/bin/sh\nprintf '%s\\n' 'test-only-passphrase'\n",
            )
            .unwrap();
            fs::set_permissions(&helper, fs::Permissions::from_mode(0o700)).unwrap();
            let output = add_command(&key, &helper)
                .env("SSH_AUTH_SOCK", &socket)
                .output()
                .unwrap();
            assert!(output.status.success());
            let output = command()
                .arg("-l")
                .env("SSH_AUTH_SOCK", &socket)
                .output()
                .unwrap();
            assert_eq!(status_from_output(&output).ok().unwrap().key_count, 1);
        }

        #[test]
        fn rejects_public_keys_shared_permissions_and_symlinks() {
            let directory = tempfile::tempdir().unwrap();
            let key = directory.path().join("id_test");
            fs::write(&key, "test fixture").unwrap();
            fs::set_permissions(&key, fs::Permissions::from_mode(0o600)).unwrap();
            assert!(validate_key(&key).is_ok());
            let link = directory.path().join("link");
            std::os::unix::fs::symlink(&key, &link).unwrap();
            assert!(validate_key(&link).is_err());
            let public = directory.path().join("id_test.pub");
            fs::copy(&key, &public).unwrap();
            assert!(validate_key(&public).is_err());
            fs::set_permissions(&key, fs::Permissions::from_mode(0o644)).unwrap();
            assert!(validate_key(&key).is_err());
            assert!(validate_key(directory.path()).is_err());
        }
    }
}

#[tauri::command]
pub async fn select_ssh_key(app: tauri::AppHandle) -> ApiResult<Option<AgentStatus>> {
    #[cfg(target_os = "macos")]
    return blocking(move || macos::select(app)).await;
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err(failure(
            "当前平台暂不支持图形加载 SSH 密钥，请使用系统 ssh-add",
        ))
    }
}

#[tauri::command]
pub async fn check_ssh_agent() -> ApiResult<AgentStatus> {
    #[cfg(target_os = "macos")]
    return blocking(macos::status).await;
    #[cfg(not(target_os = "macos"))]
    Err(failure(
        "当前平台暂不支持图形检查 SSH Agent，请使用系统 ssh-add -l",
    ))
}
