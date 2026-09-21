use mozhi_core::{operations, vault::Vault};
use std::fs;

#[test]
fn portable_paths_crlf_recovery_and_zip() {
    let root = tempfile::tempdir().unwrap();
    let private = tempfile::tempdir().unwrap();
    let vault = Vault::open(root.path(), private.path()).unwrap();
    operations::create(&vault, "中文目录", true).unwrap();
    fs::write(root.path().join("中文目录/笔记.md"), "# 原文\r\n").unwrap();
    let note = vault.read("中文目录/笔记.md").unwrap();
    vault
        .save(&note.path, &note.content_hash, "# 更新\r\n正文\r\n")
        .unwrap();
    assert_eq!(
        vault.read(&note.path).unwrap().content,
        "# 更新\r\n正文\r\n"
    );
    assert!(operations::tree(&vault)
        .unwrap()
        .iter()
        .any(|e| e.path == "中文目录/笔记.md"));
    let zip = private.path().join("export.zip");
    operations::export(&vault, &zip).unwrap();
    let mut archive = zip::ZipArchive::new(fs::File::open(zip).unwrap()).unwrap();
    assert!(archive.by_name("中文目录/笔记.md").is_ok());
    let backup = operations::remove(&vault, "中文目录").unwrap();
    let restored = operations::restore(&vault, &backup).unwrap();
    assert!(root.path().join(restored).join("中文目录/笔记.md").exists());
    for path in [
        "CON.md",
        "CON .md",
        "LPT¹.md",
        "COM².md",
        "NUL.md",
        "CONOUT$.md",
        "x.md:stream",
        "C:x.md",
        "//server/share/a.md",
        "a\\b.md",
        "trailing .",
        "e\u{301}.md",
    ] {
        assert!(operations::create(&vault, path, false).is_err(), "{path}");
    }
}

#[cfg(windows)]
#[test]
fn locked_and_readonly_files_preserve_disk_and_draft() {
    use std::os::windows::fs::OpenOptionsExt;
    let root = tempfile::tempdir().unwrap();
    let private = tempfile::tempdir().unwrap();
    let vault = Vault::open(root.path(), private.path()).unwrap();
    let path = root.path().join("locked.md");
    fs::write(&path, "original").unwrap();
    let note = vault.read("locked.md").unwrap();
    let lock = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&path)
        .unwrap();
    assert!(vault
        .save("locked.md", &note.content_hash, "draft")
        .is_err());
    drop(lock);
    assert_eq!(fs::read_to_string(&path).unwrap(), "original");
    assert_eq!(
        vault.read_draft("locked.md").unwrap().as_deref(),
        Some("draft")
    );
    let original = fs::metadata(&path).unwrap().permissions();
    let mut readonly = original.clone();
    readonly.set_readonly(true);
    fs::set_permissions(&path, readonly).unwrap();
    let result = vault.save("locked.md", &note.content_hash, "readonly draft");
    fs::set_permissions(&path, original).unwrap();
    assert!(result.is_err());
    assert_eq!(fs::read_to_string(path).unwrap(), "original");
    assert_eq!(
        vault.read_draft("locked.md").unwrap().as_deref(),
        Some("readonly draft")
    );
}

#[cfg(windows)]
#[test]
fn junctions_cannot_escape_vault() {
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let private = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("secret.md"), "private").unwrap();
    let link = root.path().join("junction");
    assert!(std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(&link)
        .arg(outside.path())
        .output()
        .unwrap()
        .status
        .success());
    let vault = Vault::open(root.path(), private.path()).unwrap();
    assert!(vault.read("junction/secret.md").is_err());
    assert!(vault.list().unwrap().is_empty());
    assert!(operations::tree(&vault).unwrap().is_empty());
    fs::remove_dir(link).unwrap();
}
