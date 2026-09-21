//! Windows generic credentials; the native CredUI password field never crosses IPC.
use super::*;
use std::{
    ptr,
    sync::atomic::{compiler_fence, Ordering},
};
use windows_sys::Win32::{
    Foundation::{ERROR_CANCELLED, ERROR_SUCCESS},
    Security::Credentials::*,
};
fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}
fn target(config: &Config) -> String {
    format!("{SERVICE}/{}", account(config))
}
fn wipe<T: Default + Copy>(buffer: &mut [T]) {
    for item in buffer {
        // Volatile stores prevent the compiler eliding secret cleanup.
        unsafe {
            ptr::write_volatile(item, T::default());
        }
    }
    compiler_fence(Ordering::SeqCst);
}
struct Password(Vec<u16>);
impl Drop for Password {
    fn drop(&mut self) {
        wipe(&mut self.0);
    }
}
struct Credential(*mut CREDENTIALW);
impl Drop for Credential {
    fn drop(&mut self) {
        // SAFETY: this buffer was allocated by successful CredReadW; its blob has the
        // reported size, and both remain live until the matching CredFree.
        unsafe {
            let credential = &*self.0;
            if !credential.CredentialBlob.is_null() && credential.CredentialBlobSize > 0 {
                wipe(std::slice::from_raw_parts_mut(
                    credential.CredentialBlob,
                    credential.CredentialBlobSize as usize,
                ));
            }
            CredFree(self.0.cast());
        }
    }
}
pub fn get(config: &Config) -> ApiResult<String> {
    let target = wide(&target(config));
    let mut pointer = ptr::null_mut();
    // SAFETY: target is NUL-terminated; pointer is an out-parameter. No pointers escape.
    if unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut pointer) } == 0 {
        return Err(failure("Windows 凭据管理器中没有可用 Token，请先设置凭据"));
    }
    let owned = Credential(pointer);
    let credential = unsafe { &*owned.0 };
    if credential.CredentialBlobSize == 0
        || credential.CredentialBlobSize > 2560
        || credential.CredentialBlob.is_null()
    {
        return Err(failure("Windows 凭据格式无效，请重新设置 Token"));
    }
    let bytes = unsafe {
        std::slice::from_raw_parts(
            credential.CredentialBlob,
            credential.CredentialBlobSize as usize,
        )
    };
    std::str::from_utf8(bytes)
        .map(str::to_owned)
        .map_err(|_| failure("Windows 凭据格式无效"))
}
fn store(config: &Config, bytes: &[u8]) -> ApiResult<()> {
    if bytes.is_empty() || bytes.len() > 2560 {
        return Err(failure("Token 长度必须为 1–2560 字节"));
    }
    let mut target = wide(&target(config));
    let mut username = wide(&config.username);
    let credential = CREDENTIALW {
        Type: CRED_TYPE_GENERIC,
        TargetName: target.as_mut_ptr(),
        UserName: username.as_mut_ptr(),
        CredentialBlobSize: bytes.len() as u32,
        CredentialBlob: bytes.as_ptr().cast_mut(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        ..Default::default()
    };
    // SAFETY: CredWriteW copies the supplied data before returning; inputs remain live.
    if unsafe { CredWriteW(&credential, 0) } == 0 {
        return Err(failure("无法写入 Windows 凭据管理器"));
    }
    Ok(())
}
pub fn prompt(config: &Config) -> ApiResult<bool> {
    let title = wide("墨知 · 保存 Git Token");
    let message = wide(&format!(
        "仓库：{}\n账户：{}\n请在密码框输入 Git Token，将保存到当前 Windows 用户的凭据管理器。",
        config.url, config.username
    ));
    let target = wide(&target(config));
    let initial = wide(&config.username);
    if initial.len() > 514 {
        return Err(failure("用户名过长"));
    }
    let mut username = vec![0u16; 514];
    username[..initial.len()].copy_from_slice(&initial);
    let mut password = Password(vec![0u16; 514]);
    let mut save = 0;
    let info = CREDUI_INFOW {
        cbSize: std::mem::size_of::<CREDUI_INFOW>() as u32,
        pszCaptionText: title.as_ptr(),
        pszMessageText: message.as_ptr(),
        ..Default::default()
    };
    // SAFETY: sized writable UTF-16 buffers; UI only, never authenticates against an OS account.
    let result = unsafe {
        CredUIPromptForCredentialsW(
            &info,
            target.as_ptr(),
            ptr::null(),
            0,
            username.as_mut_ptr(),
            username.len() as u32,
            password.0.as_mut_ptr(),
            password.0.len() as u32,
            &mut save,
            CREDUI_FLAGS_GENERIC_CREDENTIALS
                | CREDUI_FLAGS_ALWAYS_SHOW_UI
                | CREDUI_FLAGS_DO_NOT_PERSIST
                | CREDUI_FLAGS_KEEP_USERNAME,
        )
    };
    if result == ERROR_CANCELLED {
        return Ok(false);
    }
    if result != ERROR_SUCCESS {
        return Err(failure("Windows 原生凭据对话框未完成"));
    }
    let length = password
        .0
        .iter()
        .position(|c| *c == 0)
        .ok_or_else(|| failure("Token 超出输入上限"))?;
    let mut token = String::from_utf16(&password.0[..length])
        .map_err(|_| failure("Token 格式无效"))?
        .into_bytes();
    let result = store(config, &token);
    wipe(&mut token);
    result?;
    Ok(true)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_credential_roundtrip_and_account_isolation() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let config = Config {
            url: format!("https://credentials-test.invalid/{stamp}"),
            username: "墨知测试".into(),
        };
        let name = wide(&target(&config));
        struct Cleanup(Vec<u16>);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                unsafe {
                    CredDeleteW(self.0.as_ptr(), CRED_TYPE_GENERIC, 0);
                }
            }
        }
        let _cleanup = Cleanup(name);
        store(&config, b"synthetic-test-token").unwrap();
        assert_eq!(get(&config).unwrap(), "synthetic-test-token");
        let other = Config {
            username: "other".into(),
            ..config.clone()
        };
        assert!(get(&other).is_err());
        assert!(!target(&config).contains("墨知测试"));
    }
    #[test]
    fn password_buffer_is_cleared() {
        let mut buffer = [1u16, 2, 3];
        wipe(&mut buffer);
        assert_eq!(buffer, [0, 0, 0]);
    }
}
