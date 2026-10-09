//! System OpenSSH only. Passphrases exist only inside the native askpass process.
use super::{failure, ApiResult};
use std::{
    ffi::{OsStr, OsString},
    fs,
    os::windows::{ffi::OsStringExt, fs::MetadataExt, process::CommandExt},
    path::{Component, Path, PathBuf},
    process::{Command, Output, Stdio},
    ptr,
};
use windows_sys::Win32::{
    Foundation::{GetLastError, ERROR_SERVICE_DOES_NOT_EXIST, INVALID_HANDLE_VALUE},
    Storage::FileSystem::{GetFileType, WriteFile, FILE_ATTRIBUTE_REPARSE_POINT, FILE_TYPE_PIPE},
    System::{
        Console::{GetStdHandle, STD_OUTPUT_HANDLE},
        Services::*,
        SystemInformation::GetSystemDirectoryW,
        Threading::CREATE_NO_WINDOW,
    },
    UI::WindowsAndMessaging::FindWindowW,
};

const MODE: &str = "MOZHI_OPENSSH_ASKPASS";
const MODE_VALUE: &str = "native-v1";
const SOCKET: &str = r"\\.\pipe\openssh-ssh-agent";
const UNAVAILABLE: &str = "无法连接 Windows OpenSSH Agent，请检查 ssh-agent 服务";

fn system_ssh_add() -> ApiResult<PathBuf> {
    // Do not trust PATH, SystemRoot, or WINDIR. This application targets native
    // Windows; GetSystemDirectoryW supplies the OS-owned installation directory.
    let mut buffer = vec![0u16; 32768];
    let length = unsafe { GetSystemDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) } as usize;
    if length == 0 || length >= buffer.len() {
        return Err(failure("无法定位 Windows 系统目录"));
    }
    let path = PathBuf::from(OsString::from_wide(&buffer[..length])).join("OpenSSH/ssh-add.exe");
    if !path.is_absolute() || !path.is_file() {
        return Err(failure(
            "未安装系统 OpenSSH 客户端，请在 Windows 可选功能中安装 OpenSSH Client",
        ));
    }
    Ok(path)
}

fn command(executable: &Path) -> Command {
    let mut command = Command::new(executable);
    command
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stderr(Stdio::null());
    // Status must never launch any inherited askpass helper.
    command
        .env_remove("SSH_ASKPASS")
        .env_remove("SSH_ASKPASS_REQUIRE")
        .env_remove(MODE);
    command
}

fn add_command(executable: &Path, key: &Path, helper: &Path, language: &str) -> Command {
    let mut command = command(executable);
    command
        .args(["-q", "--"])
        .arg(key)
        .env("SSH_ASKPASS", helper)
        .env("SSH_ASKPASS_REQUIRE", "force")
        .env("DISPLAY", "mozhi")
        .env("MOZHI_OPENSSH_LANGUAGE", validated_language(language))
        .env(MODE, MODE_VALUE);
    command
}

struct ServiceHandle(SC_HANDLE);
impl Drop for ServiceHandle {
    fn drop(&mut self) {
        unsafe {
            CloseServiceHandle(self.0);
        }
    }
}
fn service_state(start: u32, state: u32) -> ApiResult<()> {
    if start == SERVICE_DISABLED {
        Err(failure("Windows ssh-agent 服务已禁用。请在管理员 PowerShell 执行 Set-Service -Name ssh-agent -StartupType Automatic，再执行 Start-Service -Name ssh-agent"))
    } else if state == SERVICE_STOPPED {
        Err(failure("Windows ssh-agent 服务已停止。请在管理员 PowerShell 执行 Start-Service -Name ssh-agent"))
    } else if state != SERVICE_RUNNING {
        Err(failure(
            "Windows ssh-agent 服务正在转换状态或已暂停，请稍后重试并检查服务状态",
        ))
    } else {
        Ok(())
    }
}
fn service_error(code: u32) -> String {
    if code == ERROR_SERVICE_DOES_NOT_EXIST {
        failure("Windows ssh-agent 服务不存在，请在 Windows 可选功能中安装 OpenSSH Client")
    } else {
        failure("无法读取 Windows ssh-agent 服务状态，请检查服务查询权限")
    }
}
fn check_service() -> ApiResult<()> {
    // Only CONNECT / QUERY rights; never request start or configuration rights.
    let manager = unsafe { OpenSCManagerW(ptr::null(), ptr::null(), SC_MANAGER_CONNECT) };
    if manager.is_null() {
        return Err(service_error(unsafe { GetLastError() }));
    }
    let manager = ServiceHandle(manager);
    let name: Vec<u16> = "ssh-agent\0".encode_utf16().collect();
    let service = unsafe {
        OpenServiceW(
            manager.0,
            name.as_ptr(),
            SERVICE_QUERY_CONFIG | SERVICE_QUERY_STATUS,
        )
    };
    if service.is_null() {
        return Err(service_error(unsafe { GetLastError() }));
    }
    let service = ServiceHandle(service);
    // QueryServiceConfigW's documented maximum is 8 KiB. usize provides alignment.
    let mut buffer = vec![0usize; 8192 / std::mem::size_of::<usize>()];
    let config = buffer.as_mut_ptr().cast::<QUERY_SERVICE_CONFIGW>();
    let mut needed = 0;
    let mut status = SERVICE_STATUS::default();
    if unsafe { QueryServiceConfigW(service.0, config, 8192, &mut needed) } == 0
        || unsafe { QueryServiceStatus(service.0, &mut status) } == 0
    {
        return Err(service_error(unsafe { GetLastError() }));
    }
    service_state(unsafe { (*config).dwStartType }, status.dwCurrentState)
}

fn socket_matches(socket: Option<&OsStr>) -> bool {
    socket.is_none_or(|value| {
        value.is_empty()
            || value
                .to_str()
                .is_some_and(|v| v.eq_ignore_ascii_case(SOCKET))
    })
}
fn check_agent_selection() -> ApiResult<()> {
    if !socket_matches(std::env::var_os("SSH_AUTH_SOCK").as_deref()) {
        return Err(failure("SSH_AUTH_SOCK 指向非系统 Agent；请从启动墨知的环境中移除此变量后重启，避免加载和同步使用不同 Agent"));
    }
    let pageant: Vec<u16> = "Pageant\0".encode_utf16().collect();
    if !unsafe { FindWindowW(pageant.as_ptr(), pageant.as_ptr()) }.is_null() {
        return Err(failure("检测到 Pageant；同步使用的 libssh2 会优先尝试它。请退出 Pageant 后重试，避免与 Windows OpenSSH Agent 不一致"));
    }
    Ok(())
}

fn status_from_output(output: &Output) -> ApiResult<usize> {
    match output.status.code() {
        Some(0) => Ok(output
            .stdout
            .split(|b| *b == b'\n')
            .filter(|line| line.iter().any(|b| !b.is_ascii_whitespace()))
            .count()),
        Some(1) => Err(failure("SSH Agent 尚未加载密钥，请选择 SSH 私钥")),
        _ => Err(failure(UNAVAILABLE)),
    }
}
/// Identity count only: does not verify repository authorization or libssh2 compatibility.
pub fn status() -> ApiResult<usize> {
    check_agent_selection()?;
    let executable = system_ssh_add()?;
    check_service()?;
    let output = command(&executable)
        .arg("-l")
        .output()
        .map_err(|_| failure("无法启动系统 ssh-add"))?;
    status_from_output(&output)
}

pub fn validate_key(path: &Path) -> ApiResult<()> {
    if !path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir))
    {
        return Err(failure("请选择绝对路径的普通私钥文件"));
    }
    if path
        .extension()
        .is_some_and(|ext| ext.to_string_lossy().eq_ignore_ascii_case("pub"))
    {
        return Err(failure("请选择 SSH 私钥，而非 .pub 公钥文件"));
    }
    for ancestor in path.ancestors() {
        let metadata =
            fs::symlink_metadata(ancestor).map_err(|_| failure("所选密钥文件不存在或无法访问"))?;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(failure("私钥及其父目录不能是符号链接、联接或其他重解析点"));
        }
        if ancestor == path && !metadata.is_file() {
            return Err(failure("请选择普通 SSH 私钥文件"));
        }
    }
    // Windows OpenSSH validates Windows ACLs. Unix permission bits are meaningless here.
    Ok(())
}

pub fn preflight() -> ApiResult<()> {
    check_agent_selection()?;
    system_ssh_add()?;
    check_service()
}

pub fn add_key(path: &Path, language: &str) -> ApiResult<usize> {
    validate_key(path)?;
    check_agent_selection()?;
    let executable = system_ssh_add()?;
    check_service()?;
    let helper = std::env::current_exe().map_err(|_| failure("无法定位原生密码对话框"))?;
    let result = add_command(&executable, path, &helper, language)
        .stdout(Stdio::null())
        .status()
        .map_err(|_| failure("无法启动系统 ssh-add"))?;
    match result.code() {
        Some(0) => status(),
        Some(2) => Err(failure(UNAVAILABLE)),
        _ => Err(failure(
            "密钥未加载：已取消、密码错误、私钥格式不受支持或 Windows ACL 权限不安全",
        )),
    }
}

fn is_dispatch(mode: Option<&OsStr>) -> bool {
    mode == Some(OsStr::new(MODE_VALUE))
}

/// Must run before Tauri initialization. OpenSSH supplies the prompt as an argument;
/// we deliberately ignore it and use a fixed native prompt, never forwarding secrets.
pub fn dispatch_askpass() -> Option<i32> {
    let mode = std::env::var_os(MODE);
    mode.as_ref()?;
    if !is_dispatch(mode.as_deref()) {
        return Some(1);
    }
    Some(if askpass().is_ok() { 0 } else { 1 })
}

fn validated_language(language: &str) -> &str {
    match language {
        "en" => "en",
        "ja" => "ja",
        _ => "zh-CN",
    }
}

fn prompt_text(language: &str) -> (&'static str, &'static str) {
    match validated_language(language) {
        "en" => ("MoZhi · Load SSH key", "Enter the selected SSH private key's passphrase. It is used only for this load and will not be saved."),
        "ja" => ("墨知 · SSH 秘密鍵を読み込む", "選択した SSH 秘密鍵のパスフレーズを入力してください。今回の読み込みにのみ使用し、保存しません。"),
        _ => ("墨知 · 加载 SSH 密钥", "请输入所选 SSH 私钥的密码。密码仅用于本次加载，不会保存。"),
    }
}

fn askpass() -> ApiResult<()> {
    // std::io::stdout can be a no-op with windows_subsystem="windows". Use the
    // inherited Win32 pipe explicitly; never attach a console or open a file.
    let handle = unsafe { GetStdHandle(STD_OUTPUT_HANDLE) };
    if handle.is_null()
        || handle == INVALID_HANDLE_VALUE
        || unsafe { GetFileType(handle) } != FILE_TYPE_PIPE
    {
        return Err(failure("密码输出通道不可用"));
    }
    let language = std::env::var("MOZHI_OPENSSH_LANGUAGE").unwrap_or_default();
    let (caption, instructions) = prompt_text(&language);
    let secret = super::credentials::prompt_secret(
        "app.mozhi.notes.ssh.passphrase",
        "SSH",
        caption,
        instructions,
    )?
    .ok_or_else(|| failure("已取消"))?;
    if secret
        .as_bytes()
        .iter()
        .any(|b| matches!(b, b'\r' | b'\n' | 0))
    {
        return Err(failure("密码包含不支持的字符"));
    }
    for mut bytes in [secret.as_bytes(), b"\n".as_slice()] {
        while !bytes.is_empty() {
            let mut written = 0;
            if unsafe {
                WriteFile(
                    handle,
                    bytes.as_ptr(),
                    bytes.len() as u32,
                    &mut written,
                    ptr::null_mut(),
                )
            } == 0
                || written == 0
            {
                return Err(failure("密码输出通道不可用"));
            }
            bytes = &bytes[written as usize..];
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::windows::process::ExitStatusExt;

    #[test]
    fn maps_status_without_output_leaks() {
        let output = |code| Output {
            status: std::process::ExitStatus::from_raw(code),
            stdout: b"secret comment\nsecond key\n".to_vec(),
            stderr: b"private detail".to_vec(),
        };
        assert_eq!(status_from_output(&output(0)).unwrap(), 2);
        for code in [1, 2, 255] {
            let error = status_from_output(&output(code)).unwrap_err();
            assert!(!error.contains("secret") && !error.contains("private"));
        }
        assert!(service_state(SERVICE_DISABLED, SERVICE_STOPPED)
            .unwrap_err()
            .contains("Set-Service -Name ssh-agent -StartupType Automatic"));
        assert!(service_state(SERVICE_DEMAND_START, SERVICE_STOPPED)
            .unwrap_err()
            .contains("Start-Service"));
        assert!(service_state(SERVICE_DEMAND_START, SERVICE_RUNNING).is_ok());
        assert!(service_state(SERVICE_DEMAND_START, SERVICE_START_PENDING).is_err());
        assert!(service_error(ERROR_SERVICE_DOES_NOT_EXIST).contains("不存在"));
    }

    #[test]
    fn builds_literal_paths_and_child_only_environment() {
        let executable = Path::new(r"C:\Windows\System32\OpenSSH\ssh-add.exe");
        let key = Path::new(r"C:\a b\key & literal");
        let helper = Path::new(r"C:\Program Files\MoZhi\mozhi.exe");
        let command = add_command(executable, key, helper, "en");
        assert_eq!(command.get_program(), executable);
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            [OsStr::new("-q"), OsStr::new("--"), key.as_os_str()]
        );
        let env: std::collections::HashMap<_, _> = command.get_envs().collect();
        assert_eq!(env[OsStr::new("SSH_ASKPASS")], Some(helper.as_os_str()));
        assert_eq!(
            env[OsStr::new("SSH_ASKPASS_REQUIRE")],
            Some(OsStr::new("force"))
        );
        assert_eq!(env[OsStr::new(MODE)], Some(OsStr::new(MODE_VALUE)));
        assert_eq!(
            env[OsStr::new("MOZHI_OPENSSH_LANGUAGE")],
            Some(OsStr::new("en"))
        );
        assert_eq!(validated_language("untrusted prompt"), "zh-CN");
        assert!(prompt_text("en").1.contains("not be saved"));
        assert!(prompt_text("ja").1.contains("保存しません"));
        assert!(!is_dispatch(None));
        assert!(!is_dispatch(Some(OsStr::new("wrong"))));
        assert!(is_dispatch(Some(OsStr::new(MODE_VALUE))));
        assert!(socket_matches(None));
        assert!(socket_matches(Some(OsStr::new(SOCKET))));
        assert!(!socket_matches(Some(OsStr::new("/tmp/other-agent"))));
    }

    #[test]
    fn rejects_reparse_ancestors() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("real");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("synthetic"), b"fixture").unwrap();
        let junction = directory.path().join("junction");
        // Junction creation needs no symlink privilege; affects only the fixture.
        let status = Command::new("cmd.exe")
            .args(["/d", "/c", "mklink", "/J"])
            .arg(&junction)
            .arg(&target)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap();
        assert!(status.success());
        let result = validate_key(&junction.join("synthetic"));
        fs::remove_dir(&junction).unwrap();
        assert!(result.unwrap_err().contains("重解析点"));
    }

    #[test]
    fn validates_metadata_only_and_rejects_public_and_directories() {
        let directory = tempfile::tempdir().unwrap();
        let key = directory.path().join("synthetic key");
        fs::write(&key, b"not a real private key").unwrap();
        assert!(validate_key(&key).is_ok());
        let public = directory.path().join("key.PuB");
        fs::write(&public, b"synthetic").unwrap();
        assert!(validate_key(&public).is_err());
        assert!(validate_key(directory.path()).is_err());
        assert!(validate_key(Path::new("relative-key")).is_err());
        assert!(validate_key(&directory.path().join("missing")).is_err());
    }
}
