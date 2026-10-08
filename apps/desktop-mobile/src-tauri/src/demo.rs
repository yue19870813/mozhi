use mozhi_core::vault::{hash, Vault};
use std::path::Path;

pub fn is_demo(data: &Path, root: &Path) -> bool {
    data.join("墨知示例笔记")
        .canonicalize()
        .is_ok_and(|demo| demo == root)
}

// Only upgrade the untouched original sample. User edits and recovery drafts win.
pub fn update_welcome(vault: &Vault) -> mozhi_core::Result<()> {
    let Ok(note) = vault.read("欢迎使用.md") else {
        return Ok(());
    };
    if hash(note.content.replace("\r\n", "\n").as_bytes())
        != "4748a188f7e0454a5bcfbdbdc42dfa0a06b7e8028a866ec7f723e588c198368b"
    {
        return Ok(());
    }
    if vault
        .read_draft(&note.path)?
        .is_some_and(|draft| draft != note.content)
    {
        return Ok(());
    }
    vault.save(
        &note.path,
        &note.content_hash,
        include_str!("../../../../tests/fixtures/欢迎使用.md"),
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_the_bundled_location_is_a_demo() {
        let data = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let demo = data.path().join("墨知示例笔记");
        let personal = other.path().join("墨知示例笔记");
        std::fs::create_dir(&demo).unwrap();
        std::fs::create_dir(&personal).unwrap();
        assert!(is_demo(data.path(), &demo.canonicalize().unwrap()));
        assert!(!is_demo(data.path(), &personal.canonicalize().unwrap()));
    }
    #[test]
    fn upgrades_original_sample_but_preserves_user_edits_and_unsaved_drafts() {
        let root = tempfile::tempdir().unwrap();
        let recovery = tempfile::tempdir().unwrap();
        let original = r###"---
id: 8df3a928-1bf4-4c56-b553-5f43c9eea673
tags:
  - 入门
  - 墨知
---

# 留下想法，让知识相连

欢迎来到 **墨知**。这里是你的本地 Markdown 工作区。

文件保存在本机目录；每次编辑会先保留恢复草稿，再自动保存。

## 今天，从一个想法开始

- [ ] 用中文输入一段文字，试试选词、撤销和重做
- [ ] 搜索「知识图谱」「预算」或一个汉字
- [ ] 切换到技术验证，运行 Git 与搜索样本
- [ ] 打开图谱样本，观察布局和缩放性能

> 技术验证阶段：先证明数据可靠，再扩展完整功能。

## 连接你的笔记

阅读 [中文输入检查](中文输入检查.md)，或记录 [[项目计划]]。

```rust
fn main() {
    println!("你好，墨知！");
}
```

| 模块 | 本阶段重点 |
| --- | --- |
| 编辑 | 中文组合输入、100 KB 长文 |
| 搜索 | 一字、二字、多字与混排 |
| Git | 克隆、快进、合并与冲突 |
| 图谱 | 布局耗时与缩放帧率 |
"###;
        let path = root.path().join("欢迎使用.md");
        std::fs::write(&path, original).unwrap();
        let vault = Vault::open(root.path(), recovery.path()).unwrap();
        vault.draft("欢迎使用.md", "unsaved user content").unwrap();
        update_welcome(&vault).unwrap();
        assert_eq!(vault.read("欢迎使用.md").unwrap().content, original);
        assert_eq!(
            vault.read_draft("欢迎使用.md").unwrap().as_deref(),
            Some("unsaved user content")
        );
        vault.draft("欢迎使用.md", original).unwrap();
        update_welcome(&vault).unwrap();
        assert_eq!(
            vault.read("欢迎使用.md").unwrap().content,
            include_str!("../../../../tests/fixtures/欢迎使用.md")
        );
        std::fs::write(&path, "# My own welcome").unwrap();
        update_welcome(&vault).unwrap();
        assert_eq!(
            vault.read("欢迎使用.md").unwrap().content,
            "# My own welcome"
        );
    }
}
