use mozhi_core::{git_probe, search::SearchIndex, vault::Vault, Error};
use std::fs;

#[test]
fn saves_preserve_drafts_and_reject_stale_versions() {
    let root = tempfile::tempdir().unwrap();
    let recovery = tempfile::tempdir().unwrap();
    fs::write(root.path().join("笔记.md"), "# 原文\r\n").unwrap();
    let vault = Vault::open(root.path(), recovery.path()).unwrap();
    let note = vault.read("笔记.md").unwrap();
    assert_eq!(note.content, "# 原文\r\n");
    let updated = vault
        .save("笔记.md", &note.content_hash, "# 中文输入\n")
        .unwrap();
    assert_ne!(note.content_hash, updated.content_hash);
    fs::write(root.path().join("笔记.md"), "外部修改").unwrap();
    assert!(matches!(
        vault.save("笔记.md", &updated.content_hash, "未丢失的草稿"),
        Err(Error::Conflict)
    ));
    assert_eq!(vault.read("笔记.md").unwrap().content, "外部修改");
    assert_eq!(
        vault.read_draft("笔记.md").unwrap().as_deref(),
        Some("未丢失的草稿")
    );
    assert!(vault.read("../笔记.md").is_err());
    assert!(vault.read("/etc/passwd").is_err());
    assert!(vault.read(".git/config").is_err());
}
#[cfg(unix)]
#[test]
fn rejects_symlink_files_and_directories() {
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let recovery = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("秘密.md"), "private").unwrap();
    std::os::unix::fs::symlink(outside.path(), root.path().join("链接")).unwrap();
    std::os::unix::fs::symlink(outside.path().join("秘密.md"), root.path().join("链接.md"))
        .unwrap();
    let vault = Vault::open(root.path(), recovery.path()).unwrap();
    assert!(vault.read("链接/秘密.md").is_err());
    assert!(vault.read("链接.md").is_err());
    assert!(vault.list().unwrap().is_empty());
}
#[test]
fn chinese_recall_literal_queries_and_directory_filter() {
    let dir = tempfile::tempdir().unwrap();
    let mut index = SearchIndex::open(&dir.path().join("index.sqlite")).unwrap();
    index
        .replace_all(&[
            (
                "工作/预算.md".into(),
                "# 项目\n知识图谱，Rust混排，预算、计划；100% 完成".into(),
            ),
            ("生活/预算.md".into(), "# 购物\n今天买水果".into()),
        ])
        .unwrap();
    for q in ["知", "图谱", "知识图谱", "Rust", "预算、计划", "100%"] {
        assert_eq!(index.query(q, "工作").unwrap().hits.len(), 1, "{q}");
    }
    assert_eq!(index.query("预算", "生活").unwrap().hits.len(), 1);
    assert!(index.query("知识图谱", "生活").unwrap().hits.is_empty());
    for q in ["\" OR *", "' OR 1=1 --", "不存在", "_"] {
        assert!(index.query(q, "").unwrap().hits.is_empty());
    }
    assert_eq!(index.query("%", "").unwrap().hits.len(), 1);
    index.upsert("工作/预算.md", "# 已更新").unwrap();
    assert!(index.query("知识图谱", "").unwrap().hits.is_empty());
    assert_eq!(index.query("已更新", "").unwrap().hits.len(), 1);
    index.replace_all(&[]).unwrap();
    assert!(index.query("已更新", "").unwrap().hits.is_empty());
}
#[test]
fn git_roundtrip_divergence_and_conflict() {
    let report = git_probe::run().unwrap();
    assert!(report.https_enabled);
    assert_eq!(report.checks.len(), 4);
}
