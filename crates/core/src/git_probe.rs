//! Disposable repositories only. This validates libgit2, not the P1 sync state machine.
use crate::{Error, Result};
use git2::{build::CheckoutBuilder, IndexAddOption, Repository, Signature};
use serde::Serialize;
use std::{fs, time::Instant};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitProbe {
    pub elapsed_ms: f64,
    pub libgit2: String,
    pub https_enabled: bool,
    pub checks: Vec<String>,
}
fn commit(repo: &Repository, message: &str) -> Result<git2::Oid> {
    let mut index = repo.index()?;
    index.add_all(["*"], IndexAddOption::DEFAULT, None)?;
    index.write()?;
    let tree_id = index.write_tree()?;
    let tree = repo.find_tree(tree_id)?;
    let signature = Signature::now("墨知 P0", "p0@mozhi.invalid")?;
    let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let parents: Vec<_> = parent.iter().collect();
    Ok(repo.commit(
        Some("HEAD"),
        &signature,
        &signature,
        message,
        &tree,
        &parents,
    )?)
}
fn push(repo: &Repository) -> Result<()> {
    repo.find_remote("origin")?
        .push(&["refs/heads/main:refs/heads/main"], None)?;
    Ok(())
}
fn fetch(repo: &Repository) -> Result<git2::Oid> {
    repo.find_remote("origin")?
        .fetch(&["refs/heads/main:refs/remotes/origin/main"], None, None)?;
    Ok(repo.refname_to_id("refs/remotes/origin/main")?)
}
fn ensure(condition: bool, message: &str) -> Result<()> {
    if condition {
        Ok(())
    } else {
        Err(Error::Probe(message.into()))
    }
}
pub fn run() -> Result<GitProbe> {
    let started = Instant::now();
    let dir = tempfile::tempdir()?;
    let bare_path = dir.path().join("remote.git");
    let bare = Repository::init_bare(&bare_path)?;
    bare.set_head("refs/heads/main")?;
    let a_path = dir.path().join("设备甲");
    let a = Repository::init(&a_path)?;
    a.set_head("refs/heads/main")?;
    fs::write(a_path.join("中文笔记.md"), "# 原始版本\n共同祖先\n")?;
    fs::write(a_path.join("图片.png"), [0, 1, 2, 255])?;
    commit(&a, "初始笔记与附件")?;
    a.remote("origin", bare_path.to_str().ok_or(Error::InvalidPath)?)?;
    push(&a)?;
    let b_path = dir.path().join("设备乙");
    let b = Repository::clone(bare_path.to_str().ok_or(Error::InvalidPath)?, &b_path)?;
    ensure(
        fs::read(b_path.join("图片.png"))? == [0, 1, 2, 255],
        "附件克隆不一致",
    )?;
    let mut checks = vec!["初始化 / 提交 / 推送 / 克隆 / 中文路径与二进制附件".into()];

    fs::write(a_path.join("快进.md"), "快进更新")?;
    let fast_forward = commit(&a, "甲更新")?;
    push(&a)?;
    let remote_id = fetch(&b)?;
    let annotated = b.find_annotated_commit(remote_id)?;
    ensure(
        b.merge_analysis(&[&annotated])?.0.is_fast_forward(),
        "应可快进",
    )?;
    b.checkout_tree(
        &b.find_object(remote_id, None)?,
        Some(CheckoutBuilder::new().safe()),
    )?;
    b.find_reference("refs/heads/main")?
        .set_target(remote_id, "P0 fast forward")?;
    ensure(b.head()?.target() == Some(fast_forward), "快进 HEAD 错误")?;
    ensure(
        fs::read_to_string(b_path.join("快进.md"))? == "快进更新",
        "快进文件未更新",
    )?;
    checks.push("fetch / 祖先检查 / 快进".into());

    fs::write(a_path.join("甲新增.md"), "甲的离线笔记")?;
    commit(&a, "甲离线更新")?;
    push(&a)?;
    fs::write(b_path.join("乙新增.md"), "乙的离线笔记")?;
    commit(&b, "乙离线更新")?;
    let remote_id = fetch(&b)?;
    let ours = b.head()?.peel_to_commit()?;
    let theirs = b.find_commit(remote_id)?;
    let mut merged = b.merge_commits(&ours, &theirs, None)?;
    ensure(!merged.has_conflicts(), "不同文件不应冲突")?;
    let tree_id = merged.write_tree_to(&b)?;
    let tree = b.find_tree(tree_id)?;
    let signature = Signature::now("墨知 P0", "p0@mozhi.invalid")?;
    b.checkout_tree(tree.as_object(), Some(CheckoutBuilder::new().safe()))?;
    b.commit(
        Some("HEAD"),
        &signature,
        &signature,
        "P0 三方合并",
        &tree,
        &[&ours, &theirs],
    )?;
    push(&b)?;
    ensure(
        b.head()?.peel_to_commit()?.parent_count() == 2,
        "合并须保留双方历史",
    )?;
    ensure(
        b_path.join("甲新增.md").exists() && b_path.join("乙新增.md").exists(),
        "合并丢失内容",
    )?;
    checks.push("离线分叉 / 无冲突三方合并 / 双亲提交 / 推送".into());

    let remote_id = fetch(&a)?;
    a.checkout_tree(
        &a.find_object(remote_id, None)?,
        Some(CheckoutBuilder::new().safe()),
    )?;
    a.find_reference("refs/heads/main")?
        .set_target(remote_id, "P0 fast forward")?;
    fs::write(a_path.join("中文笔记.md"), "# 甲修改\n甲的内容\n")?;
    commit(&a, "甲冲突版本")?;
    push(&a)?;
    fs::write(b_path.join("中文笔记.md"), "# 乙修改\n乙的内容\n")?;
    let local_id = commit(&b, "乙冲突版本")?;
    ensure(push(&b).is_err(), "分叉推送必须拒绝，禁止 force push")?;
    let remote_id = fetch(&b)?;
    let ours = b.find_commit(local_id)?;
    let theirs = b.find_commit(remote_id)?;
    let conflicts = b.merge_commits(&ours, &theirs, None)?;
    ensure(conflicts.has_conflicts(), "未检测到正文冲突")?;
    let conflict = conflicts
        .conflicts()?
        .next()
        .ok_or_else(|| Error::Probe("缺少冲突条目".into()))??;
    ensure(
        conflict.ancestor.is_some() && conflict.our.is_some() && conflict.their.is_some(),
        "缺少三方原始版本",
    )?;
    ensure(
        fs::read_to_string(b_path.join("中文笔记.md"))? == "# 乙修改\n乙的内容\n",
        "冲突检测覆盖了工作区",
    )?;
    ensure(
        b.head()?.target() == Some(local_id),
        "失败推送后本地提交丢失",
    )?;
    checks.push("拒绝非快进推送 / 正文冲突 / 保留祖先与双方内容 / 工作区不变".into());
    let version = git2::Version::get();
    Ok(GitProbe {
        elapsed_ms: started.elapsed().as_secs_f64() * 1000.,
        libgit2: format!("{:?}", version.libgit2_version()),
        https_enabled: version.https(),
        checks,
    })
}
