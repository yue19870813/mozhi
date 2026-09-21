use mozhi_core::{
    knowledge::{self, GraphQuery},
    markdown, operations,
    search::SearchIndex,
    vault::Vault,
};
use std::fs;
#[test]
fn parser_resolution_code_exclusion_ambiguity_and_duplicates() {
    let body="---\nid: same\ntags: [工作, 项目]\ncustom: untouched\n---\n# 标题\n[[目标|别名]] [正文](目标.md#标题) [[同名]] [[缺失]]\n`[[假链接]]`\n```md\n[[代码块]]\n```\n![图片](attachments/a.png)\n[远程](https://host/a.md)\n";
    let mut notes = vec![
        markdown::parse("项目/源.md", body),
        markdown::parse("项目/目标.md", "---\nid: same\n---\n# 目标"),
        markdown::parse("甲/同名.md", "# 同名"),
        markdown::parse("乙/同名.md", "# 同名"),
    ];
    markdown::resolve(&mut notes);
    let n = &notes[0];
    assert_eq!(n.tags, vec!["工作", "项目"]);
    assert_eq!(n.references.len(), 5);
    assert_eq!(n.references[0].target.as_deref(), Some("项目/目标.md"));
    assert_eq!(n.references[2].resolution, "ambiguous");
    assert_eq!(n.references[3].resolution, "missing");
    assert_eq!(n.issues.len(), 1);
    let graph = knowledge::graph(
        &notes,
        &GraphQuery {
            include_isolated: true,
            ..Default::default()
        },
    );
    assert_eq!(graph.edges.len(), 1);
    assert_eq!(graph.edges[0].count, 2);
    let local = knowledge::graph(
        &notes,
        &GraphQuery {
            center: Some("项目/目标.md".into()),
            depth: Some(2),
            include_isolated: true,
            ..Default::default()
        },
    );
    assert_eq!(local.nodes.len(), 2);
}
#[test]
fn file_lifecycle_rewrites_links_and_recovers_without_overwrite() {
    let root = tempfile::tempdir().unwrap();
    let private = tempfile::tempdir().unwrap();
    let vault = Vault::open(root.path(), private.path()).unwrap();
    operations::create(&vault, "项目", true).unwrap();
    operations::create(&vault, "项目/目标.md", false).unwrap();
    operations::create(&vault, "源.md", false).unwrap();
    fs::write(root.path().join("源.md"),"---\ncustom: 原样保留\n---\n# 源\n[[项目/目标|别名]] [链接](项目/目标.md#锚点)\n`[[项目/目标]]`\n").unwrap();
    let id = operations::move_entry(&vault, "项目/目标.md", "新目标.md").unwrap();
    let body = vault.read("源.md").unwrap().content;
    assert!(body.contains("[[新目标|别名]]"));
    assert!(body.contains("[链接](新目标.md#锚点)"));
    assert!(body.contains("`[[项目/目标]]`"));
    assert!(body.contains("custom: 原样保留"));
    assert!(!root.path().join("项目/目标.md").exists());
    let restore = operations::restore(&vault, &id).unwrap();
    assert!(root.path().join(restore).join("项目/目标.md").exists());
    let id = operations::remove(&vault, "新目标.md").unwrap();
    assert!(!root.path().join("新目标.md").exists());
    operations::restore(&vault, &id).unwrap();
    assert!(!root.path().join("新目标.md").exists());
    for path in [
        "../escape.md",
        "CON.md",
        "a?.md",
        ".git/config",
        "项目/../逃逸.md",
    ] {
        assert!(operations::create(&vault, path, false).is_err(), "{path}");
    }
    operations::create(&vault, "Case.md", false).unwrap();
    assert!(operations::create(&vault, "case.md", false).is_err());
    let export = root.path().join("export.zip");
    assert!(operations::export(&vault, &export).is_err());
    operations::export(&vault, &private.path().join("export.zip")).unwrap();
}
#[test]
fn search_combines_tags_directory_filename_and_short_terms() {
    let dir = tempfile::tempdir().unwrap();
    let mut index = SearchIndex::open(&dir.path().join("index.sqlite")).unwrap();
    index
        .replace_all(&[
            (
                "项目/预算.md".into(),
                "---\ntags: [工作, 财务]\n---\n# 计划\n知识图谱，100%".into(),
            ),
            (
                "生活/预算.md".into(),
                "---\ntags: [生活]\n---\n# 预算\n知识图谱".into(),
            ),
        ])
        .unwrap();
    assert_eq!(
        index
            .query_filtered("tag:工作 path:项目 图谱", "", "", false)
            .unwrap()
            .hits
            .len(),
        1
    );
    assert!(index
        .query_filtered("tag:生活 图谱", "项目", "", false)
        .unwrap()
        .hits
        .is_empty());
    assert!(index
        .query_filtered("图谱", "", "", true)
        .unwrap()
        .hits
        .is_empty());
    assert_eq!(
        index
            .query_filtered("预算", "", "财务", true)
            .unwrap()
            .hits
            .len(),
        1
    );
    assert_eq!(index.query("%", "").unwrap().hits.len(), 1);
    assert_eq!(index.query("谱", "").unwrap().strategy, "short-term-index");
    index
        .upsert("项目/预算.md", "---\ntags: [生活]\n---\n# 更新")
        .unwrap();
    assert!(index.query("tag:工作", "").unwrap().hits.is_empty());
    assert_eq!(index.knowledge().unwrap().len(), 2);
}

#[test]
fn moved_directory_rewrites_images_and_preserves_link_titles() {
    let root = tempfile::tempdir().unwrap();
    let private = tempfile::tempdir().unwrap();
    let vault = Vault::open(root.path(), private.path()).unwrap();
    operations::create(&vault, "项目", true).unwrap();
    operations::create(&vault, "attachments", true).unwrap();
    fs::write(root.path().join("attachments/a.png"), [0, 1, 2]).unwrap();
    fs::write(
        root.path().join("项目/源.md"),
        "# 源\n![图](../attachments/a.png \"图的标题\")\n[目标](../目标.md \"保留标题\")\n",
    )
    .unwrap();
    operations::create(&vault, "目标.md", false).unwrap();
    operations::create(&vault, "归档", true).unwrap();
    operations::move_entry(&vault, "项目", "归档/项目").unwrap();
    let note = vault.read("归档/项目/源.md").unwrap();
    assert!(note
        .content
        .contains("![图](../../attachments/a.png \"图的标题\")"));
    assert!(note.content.contains("[目标](../../目标.md \"保留标题\")"));
    operations::move_entry(&vault, "attachments/a.png", "attachments/b.png").unwrap();
    assert!(vault
        .read("归档/项目/源.md")
        .unwrap()
        .content
        .contains("../../attachments/b.png"));
}
#[test]
fn incremental_reconcile_removes_deleted_tags_terms_and_relations() {
    let dir = tempfile::tempdir().unwrap();
    let mut index = SearchIndex::open(&dir.path().join("index.sqlite")).unwrap();
    index
        .replace_all(&[
            ("a.md".into(), "---\ntags: [old]\n---\n[[b]]\n图谱".into()),
            ("b.md".into(), "# B".into()),
        ])
        .unwrap();
    index
        .reconcile(&[("a.md".into(), "---\ntags: [new]\n---\n[[b]]\n更新".into())])
        .unwrap();
    assert!(index.query("tag:old", "").unwrap().hits.is_empty());
    assert!(index.query("图谱", "").unwrap().hits.is_empty());
    assert_eq!(
        index.knowledge().unwrap()[0].references[0].resolution,
        "missing"
    );
    assert_eq!(index.query("tag:new", "").unwrap().hits.len(), 1);
}

#[test]
fn corrupt_rebuildable_index_is_quarantined_without_touching_content() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("index.sqlite");
    fs::write(&path, b"not a sqlite database").unwrap();
    fs::write(dir.path().join("draft.md"), "重要草稿").unwrap();
    let mut index = SearchIndex::open(&path).unwrap();
    index
        .replace_all(&[("a.md".into(), "# 重建成功".into())])
        .unwrap();
    assert_eq!(index.query("重建", "").unwrap().hits.len(), 1);
    assert_eq!(
        fs::read_to_string(dir.path().join("draft.md")).unwrap(),
        "重要草稿"
    );
    assert!(fs::read_dir(dir.path()).unwrap().any(|e| e
        .unwrap()
        .file_name()
        .to_string_lossy()
        .contains("corrupt-")));
}
