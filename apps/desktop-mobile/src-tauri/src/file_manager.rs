use std::{
    path::{Path, PathBuf},
    process::Command,
};

pub fn directory_for_entry(root: &Path, relative: &str) -> mozhi_core::Result<PathBuf> {
    let path = if relative.is_empty() {
        root.to_path_buf()
    } else {
        mozhi_core::operations::checked(root, relative, true)?
    };
    let path = path.canonicalize()?;
    if !path.starts_with(root) {
        return Err(mozhi_core::Error::InvalidPath);
    }
    if path.is_dir() {
        Ok(path)
    } else if path.is_file() {
        Ok(path
            .parent()
            .ok_or(mozhi_core::Error::InvalidPath)?
            .to_path_buf())
    } else {
        Err(mozhi_core::Error::InvalidPath)
    }
}

pub fn open_directory(path: &Path) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    let mut command = Command::new("/usr/bin/open");
    #[cfg(target_os = "windows")]
    let mut command = Command::new("explorer.exe");
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut command = Command::new("xdg-open");
    // Pass the validated absolute directory as one argument, never shell code.
    let status = command.arg(path).status()?;
    #[cfg(not(target_os = "windows"))]
    if !status.success() {
        return Err(std::io::Error::other("无法打开系统文件管理器"));
    }
    #[cfg(target_os = "windows")]
    let _ = status; // Explorer may return a nonzero code when reusing a window.
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resolves_directories_and_file_parents_but_rejects_escape_and_missing_entries() {
        let root =
            std::env::temp_dir().join(format!("mozhi-open-directory-{}", std::process::id()));
        std::fs::create_dir_all(root.join("中文 空格")).unwrap();
        std::fs::write(root.join("中文 空格/笔记.md"), "note").unwrap();
        let root = root.canonicalize().unwrap();
        assert_eq!(directory_for_entry(&root, "").unwrap(), root);
        for entry in ["中文 空格", "中文 空格/笔记.md"] {
            assert_eq!(
                directory_for_entry(&root, entry).unwrap(),
                root.join("中文 空格")
            );
        }
        for entry in ["../outside", "/tmp", "missing", "中文 空格/../笔记.md"] {
            assert!(directory_for_entry(&root, entry).is_err());
        }
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&root, root.join("link")).unwrap();
            assert!(directory_for_entry(&root, "link").is_err());
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
