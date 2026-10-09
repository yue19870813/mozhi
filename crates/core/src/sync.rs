use crate::{
    operations::checked,
    vault::{atomic_write, hash},
    Error, Result,
};
use git2::{
    build::{CheckoutBuilder, RepoBuilder},
    Cred, FetchOptions, Oid, ProxyOptions, PushOptions, RemoteCallbacks, Repository,
    RepositoryState, Signature, Status, StatusOptions,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    #[serde(default)]
    pub protocol: String,
    pub url: String,
    pub branch: String,
    pub username: String,
}
fn contains_any(value: &str, chars: &[char]) -> bool {
    value.contains(|c| chars.contains(&c))
}
/// 校验 scp 简写 `[用户@]主机:路径`，合法时返回 `(主机, 路径)`。
///
/// 路径中再出现 `:` 或反斜杠说明这不是 scp 形式（例如 `git:secret@主机:路径`，
/// 看着像把密码塞进了地址），返回 `None` 交给标准 URL 解析去拒绝。
fn scp_components(url: &str) -> Option<(&str, &str)> {
    if url.contains("://") {
        return None;
    }
    let (authority, path) = url.split_once(':')?;
    if (authority.len() == 1 && authority.as_bytes()[0].is_ascii_alphabetic())
        || path.is_empty()
        || contains_any(path, &[':', '\\', '?', '#'])
    {
        return None;
    }
    let (user, host) = match authority.rsplit_once('@') {
        Some((user, host)) => (Some(user), host),
        None => (None, authority),
    };
    if host.is_empty() || host.starts_with('.') || contains_any(host, &['/', '\\', '@', ':']) {
        return None;
    }
    if let Some(user) = user {
        if user.is_empty() || contains_any(user, &[':', '/', '\\', '@']) {
            return None;
        }
    }
    Some((host, path))
}
impl Config {
    // Preserve SCP home-relative paths instead of rewriting them into absolute SSH URLs.
    pub fn remote_url(&self) -> &str {
        &self.url
    }
    pub fn validate(&self) -> Result<()> {
        let protocol = if self.protocol.is_empty() {
            "https"
        } else {
            self.protocol.as_str()
        };
        if !matches!(protocol, "https" | "ssh") {
            return Err(Error::Probe("同步协议无效".into()));
        }
        let mut remote_username = None;
        if protocol == "ssh" && scp_components(&self.url).is_some() {
            remote_username = self.url.split_once(':').and_then(|(authority, _)| {
                authority.split_once('@').map(|(user, _)| user.to_owned())
            });
        } else {
            let url = url::Url::parse(&self.url)
                .map_err(|_| Error::Probe("请输入有效的仓库 URL".into()))?;
            if url.scheme() != protocol
                || url.host_str().is_none()
                || (protocol == "https" && !url.username().is_empty())
                || url.password().is_some()
                || url.query().is_some()
                || url.fragment().is_some()
            {
                return Err(Error::Probe("仓库 URL 不应包含凭据、查询参数或片段".into()));
            }
            if protocol == "ssh" && !url.username().is_empty() {
                remote_username = Some(
                    percent_encoding::percent_decode_str(url.username())
                        .decode_utf8()
                        .map_err(|_| Error::Probe("请输入有效的仓库 URL".into()))?
                        .into_owned(),
                );
            }
        }
        if !self.username.is_empty() && remote_username.is_some_and(|user| user != self.username) {
            return Err(Error::Probe("SSH 地址中的用户名与 SSH 用户名不一致，请填写相同用户名或清空用户名字段以使用地址中的用户名".into()));
        }
        if !git2::Reference::is_valid_name(&format!("refs/heads/{}", self.branch))
            || self.branch.starts_with('-')
        {
            return Err(Error::Probe("分支名无效".into()));
        }
        Ok(())
    }
}
fn ssh_credential(
    config: &Config,
    user: Option<&str>,
    allowed: git2::CredentialType,
) -> std::result::Result<Cred, git2::Error> {
    let username = if config.username.is_empty() {
        user.unwrap_or("git")
    } else {
        &config.username
    };
    if allowed.contains(git2::CredentialType::USERNAME) {
        return Cred::username(username);
    }
    if allowed.contains(git2::CredentialType::SSH_KEY) {
        return Cred::ssh_key_from_agent(username);
    }
    Err(git2::Error::from_str("SSH 同步需要已加载密钥的 ssh-agent"))
}
fn callbacks<'a>(config: &'a Config, token: &'a str) -> RemoteCallbacks<'a> {
    let mut callbacks = RemoteCallbacks::new();
    callbacks.credentials(move |_url, user, allowed| {
        if config.protocol == "ssh" {
            return ssh_credential(config, user, allowed);
        }
        if allowed.contains(git2::CredentialType::USER_PASS_PLAINTEXT) {
            Cred::userpass_plaintext(
                if config.username.is_empty() {
                    user.unwrap_or("git")
                } else {
                    &config.username
                },
                token,
            )
        } else {
            Err(git2::Error::from_str(
                "仅支持 HTTPS Token 或 SSH Agent 认证",
            ))
        }
    });
    // No certificate callback: libgit2 must perform TLS verification.
    callbacks
}
fn remote_error(error: git2::Error) -> Error {
    Error::Probe(
        match error.code() {
            git2::ErrorCode::Auth => "Git 认证失败，请检查 HTTPS Token 或 SSH Agent",
            git2::ErrorCode::Certificate => "Git TLS 证书验证失败",
            _ if error.class() == git2::ErrorClass::Ssh
                && error
                    .message()
                    .contains("Unable to exchange encryption keys") =>
            {
                "SSH 握手失败：加密密钥交换未完成，尚未进行密钥认证"
            }
            _ => "Git 网络操作失败；本地提交和恢复记录已保留，请检查网络、仓库权限与分支",
        }
        .into(),
    )
}
pub fn clone(config: &Config, token: &str, destination: &Path) -> Result<()> {
    config.validate()?;
    if destination.exists() {
        return Err(Error::Probe("克隆目标必须是尚不存在的新目录".into()));
    }
    let parent = destination.parent().ok_or(Error::InvalidPath)?;
    let temporary = tempfile::tempdir_in(parent)?;
    let mut fetch = FetchOptions::new();
    fetch.remote_callbacks(callbacks(config, token));
    fetch.follow_redirects(git2::RemoteRedirect::None);
    let mut proxy = ProxyOptions::new();
    proxy.auto();
    fetch.proxy_options(proxy);
    RepoBuilder::new()
        .branch(&config.branch)
        .fetch_options(fetch)
        .clone(config.remote_url(), temporary.path())
        .map_err(remote_error)?;
    validate_worktree(temporary.path())?;
    fs::rename(temporary.path(), destination)?;
    Ok(())
}
fn repository(root: &Path) -> Result<Repository> {
    let meta = fs::symlink_metadata(root.join(".git"))?;
    if !meta.is_dir() || crate::paths::is_link(&meta) {
        return Err(Error::Probe("仅支持普通独立 Git 仓库".into()));
    }
    let repo = Repository::open(root)?;
    if repo.state() != RepositoryState::Clean || repo.path().join("index.lock").exists() {
        return Err(Error::Probe(
            "仓库有未完成的 merge/rebase 或 Git 锁，请先处理外部 Git 操作".into(),
        ));
    }
    Ok(repo)
}
fn allowed(path: &str) -> bool {
    path.to_lowercase().ends_with(".md") || path.starts_with("attachments/") || path == ".gitignore"
}
fn validate_worktree(root: &Path) -> Result<()> {
    for e in walkdir::WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| e.depth() == 0 || e.file_name() != ".git")
    {
        let e = e.map_err(|e| Error::Probe(e.to_string()))?;
        if crate::paths::is_link(&fs::symlink_metadata(e.path())?) {
            return Err(Error::Probe("仓库包含符号链接，暂停同步".into()));
        }
    }
    Ok(())
}
fn validate_tree(repo: &Repository, tree: &git2::Tree<'_>) -> Result<()> {
    let mut invalid = false;
    tree.walk(git2::TreeWalkMode::PreOrder, |base, e| {
        let Some(name) = e.name() else {
            invalid = true;
            return git2::TreeWalkResult::Abort;
        };
        if e.filemode() == 0o120000
            || e.filemode() == 0o160000
            || (name.starts_with('.') && name != ".gitignore")
        {
            invalid = true;
            return git2::TreeWalkResult::Abort;
        }
        if name != ".gitignore"
            && checked(
                repo.workdir().unwrap_or(Path::new("/")),
                &format!("{base}{name}"),
                false,
            )
            .is_err()
        {
            invalid = true;
            return git2::TreeWalkResult::Abort;
        }
        git2::TreeWalkResult::Ok
    })?;
    if invalid {
        Err(Error::Probe(
            "远程包含不兼容路径、符号链接、子模块或私有隐藏文件，暂停同步".into(),
        ))
    } else {
        Ok(())
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conflict {
    pub path: String,
    pub ancestor: Option<String>,
    pub local: Option<String>,
    pub remote: Option<String>,
    pub binary: bool,
    pub local_deleted: bool,
    pub remote_deleted: bool,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncState {
    pub phase: String,
    pub message: String,
    pub conflicts: Vec<Conflict>,
    pub commit: Option<String>,
    pub last_success: Option<u64>,
}
#[derive(Serialize, Deserialize)]
struct Pending {
    local: String,
    remote: String,
    target: Option<String>,
    fingerprint: String,
}
fn pending_path(private: &Path) -> PathBuf {
    private.join("sync-pending.json")
}
fn state_path(private: &Path) -> PathBuf {
    private.join("sync-state.json")
}
pub fn state(private: &Path) -> Result<SyncState> {
    if !state_path(private).exists() {
        return Ok(SyncState {
            phase: "idle".into(),
            message: "尚未同步".into(),
            ..Default::default()
        });
    }
    serde_json::from_slice(&fs::read(state_path(private))?).map_err(|e| Error::Probe(e.to_string()))
}
fn save_state(private: &Path, state: &SyncState) -> Result<()> {
    atomic_write(&state_path(private), &serde_json::to_vec(state).unwrap())
}
fn write_pending(private: &Path, pending: &Pending) -> Result<()> {
    atomic_write(
        &pending_path(private),
        &serde_json::to_vec(pending).unwrap(),
    )
}
fn fingerprint(root: &Path) -> Result<String> {
    let mut values = BTreeMap::new();
    for e in walkdir::WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| e.depth() == 0 || e.file_name() != ".git")
    {
        let e = e.map_err(|e| Error::Probe(e.to_string()))?;
        if e.file_type().is_file() {
            values.insert(
                e.path()
                    .strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .to_string(),
                hash(&fs::read(e.path())?),
            );
        }
    }
    Ok(hash(&serde_json::to_vec(&values).unwrap()))
}
fn commit_local(repo: &Repository) -> Result<()> {
    let statuses = repo.statuses(Some(
        StatusOptions::new()
            .include_untracked(true)
            .recurse_untracked_dirs(true),
    ))?;
    if statuses.is_empty() {
        return Ok(());
    }
    let mut index = repo.index()?;
    for status in statuses.iter() {
        let path = status.path().ok_or(Error::InvalidPath)?;
        if !allowed(path)
            || status
                .status()
                .intersects(Status::CONFLICTED | Status::WT_RENAMED | Status::INDEX_RENAMED)
        {
            return Err(Error::Probe(format!(
                "存在不在同步范围内或不支持的变更：{path}；请先用外部 Git 处理"
            )));
        }
        if repo.workdir().unwrap().join(path).exists() {
            index.add_path(Path::new(path))?;
        } else {
            index.remove_path(Path::new(path))?;
        }
    }
    index.write()?;
    let tree = repo.find_tree(index.write_tree()?)?;
    let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    if parent.as_ref().is_some_and(|p| p.tree_id() == tree.id()) {
        return Ok(());
    }
    let signature = Signature::now("墨知", "notes@mozhi.local")?;
    let parents: Vec<_> = parent.iter().collect();
    repo.commit(
        Some("HEAD"),
        &signature,
        &signature,
        "保存笔记",
        &tree,
        &parents,
    )?;
    Ok(())
}
fn conflicts(repo: &Repository, index: &git2::Index) -> Result<Vec<Conflict>> {
    let mut result = vec![];
    for conflict in index.conflicts()? {
        let c = conflict?;
        let entry = c
            .our
            .as_ref()
            .or(c.their.as_ref())
            .or(c.ancestor.as_ref())
            .ok_or(Error::InvalidPath)?;
        let path = String::from_utf8(entry.path.clone()).map_err(|_| Error::InvalidPath)?;
        let mut binary = false;
        let mut content = |entry: Option<&git2::IndexEntry>| -> Result<Option<String>> {
            match entry {
                None => Ok(None),
                Some(entry) => {
                    let blob = repo.find_blob(entry.id)?;
                    if blob.is_binary() {
                        binary = true;
                        return Ok(None);
                    }
                    match std::str::from_utf8(blob.content()) {
                        Ok(text) => Ok(Some(text.into())),
                        Err(_) => {
                            binary = true;
                            Ok(None)
                        }
                    }
                }
            }
        };
        let ancestor = content(c.ancestor.as_ref())?;
        let local = content(c.our.as_ref())?;
        let remote = content(c.their.as_ref())?;
        result.push(Conflict {
            path,
            ancestor,
            local,
            remote,
            binary,
            local_deleted: c.our.is_none(),
            remote_deleted: c.their.is_none(),
        });
    }
    Ok(result)
}
fn install(repo: &Repository, private: &Path, pending: &Pending) -> Result<()> {
    let target = repo.find_commit(Oid::from_str(
        pending.target.as_deref().ok_or(Error::InvalidPath)?,
    )?)?;
    let head = repo.head()?.target().ok_or(Error::InvalidPath)?;
    if head == target.id() {
        fs::remove_file(pending_path(private))?;
        return Ok(());
    }
    if head.to_string() != pending.local {
        return Err(Error::Probe(
            "同步恢复期间 HEAD 已被外部更改；保留恢复记录，请先检查仓库".into(),
        ));
    }
    let tree = target.tree()?;
    validate_tree(repo, &tree)?;
    if fingerprint(repo.workdir().unwrap())? == pending.fingerprint {
        repo.checkout_tree(tree.as_object(), Some(CheckoutBuilder::new().safe()))?;
    } else {
        // A previous checkout may have completed before the branch ref was updated.
        let mut index = repo.index()?;
        let worktree_dirty = repo.statuses(None)?.iter().any(|s| {
            s.status().intersects(
                Status::WT_MODIFIED | Status::WT_NEW | Status::WT_DELETED | Status::WT_TYPECHANGE,
            )
        });
        if worktree_dirty || index.write_tree()? != tree.id() {
            return Err(Error::Probe(
                "同步中断后工作区已改变，暂停恢复以避免覆盖；原始提交仍保留".into(),
            ));
        }
    }
    let head_ref = repo.head()?;
    let name = head_ref.name().ok_or(Error::InvalidPath)?;
    repo.reference_matching(
        name,
        target.id(),
        true,
        Oid::from_str(&pending.local)?,
        "mozhi integrate",
    )?;
    fs::remove_file(pending_path(private))?;
    Ok(())
}
#[derive(Deserialize)]
pub struct Decision {
    pub path: String,
    pub choice: String,
    pub content: Option<String>,
}
pub fn resolve_conflicts(root: &Path, private: &Path, decisions: &[Decision]) -> Result<SyncState> {
    let repo = repository(root)?;
    let mut pending: Pending = serde_json::from_slice(&fs::read(pending_path(private))?)
        .map_err(|e| Error::Probe(e.to_string()))?;
    if pending.target.is_some() {
        return Err(Error::Probe("请先恢复未完成的同步".into()));
    }
    if repo.head()?.target().map(|h| h.to_string()) != Some(pending.local.clone())
        || fingerprint(root)? != pending.fingerprint
    {
        return Err(Error::Conflict);
    }
    let ours = repo.find_commit(Oid::from_str(&pending.local)?)?;
    let theirs = repo.find_commit(Oid::from_str(&pending.remote)?)?;
    let mut index = repo.merge_commits(&ours, &theirs, None)?;
    let items: Vec<_> = index.conflicts()?.collect::<std::result::Result<_, _>>()?;
    for item in items {
        let entry = item
            .our
            .as_ref()
            .or(item.their.as_ref())
            .or(item.ancestor.as_ref())
            .ok_or(Error::InvalidPath)?;
        let path = std::str::from_utf8(&entry.path).map_err(|_| Error::InvalidPath)?;
        let decision = decisions
            .iter()
            .find(|d| d.path == path)
            .ok_or_else(|| Error::Probe(format!("尚未解决：{path}")))?;
        let original_path = path.to_owned();
        let selected = match decision.choice.as_str() {
            "both" => {
                if !original_path.starts_with("attachments/") {
                    return Err(Error::Probe("仅附件支持保留双方".into()));
                }
                let mut remote = item
                    .their
                    .ok_or_else(|| Error::Probe("远程版本已删除".into()))?;
                let local = item
                    .our
                    .ok_or_else(|| Error::Probe("本地版本已删除".into()))?;
                let source = Path::new(&original_path);
                let stem = source.file_stem().unwrap_or_default().to_string_lossy();
                let extension = source.extension().unwrap_or_default().to_string_lossy();
                let destination = source.with_file_name(format!(
                    "{stem}-remote-{}.{}",
                    &remote.id.to_string()[..8],
                    extension
                ));
                if index.get_path(&destination, 0).is_some() || root.join(&destination).exists() {
                    return Err(Error::Probe(
                        "双方保留的目标文件已存在，请选择单方或先处理该文件".into(),
                    ));
                }
                remote.path = crate::paths::logical(&destination)?.into_bytes();
                remote.flags = remote.path.len().min(4095) as u16;
                index.add(&remote)?;
                Some(local)
            }
            "local" => item.our,
            "remote" => item.their,
            "manual" => {
                let content = decision.content.as_ref().ok_or(Error::InvalidPath)?;
                if !path.ends_with(".md") || content.len() > 2 * 1024 * 1024 {
                    return Err(Error::InvalidPath);
                }
                let mut selected = item.our.or(item.their).ok_or(Error::InvalidPath)?;
                selected.id = repo.blob(content.as_bytes())?;
                Some(selected)
            }
            _ => return Err(Error::Probe("请选择本地、远程或手动合并".into())),
        };
        let path = decision.path.as_str();
        for stage in 1..=3 {
            let _ = index.remove(Path::new(path), stage);
        }
        if let Some(mut selected) = selected {
            selected.flags &= !0x3000;
            index.add(&selected)?;
        }
    }
    if index.has_conflicts() {
        return Err(Error::Probe("仍有未解决冲突".into()));
    }
    let tree = repo.find_tree(index.write_tree_to(&repo)?)?;
    validate_tree(&repo, &tree)?;
    let sig = Signature::now("墨知", "notes@mozhi.local")?;
    let id = repo.commit(
        None,
        &sig,
        &sig,
        "解决笔记同步冲突",
        &tree,
        &[&ours, &theirs],
    )?;
    pending.target = Some(id.to_string());
    write_pending(private, &pending)?;
    install(&repo, private, &pending)?;
    let state = SyncState {
        phase: "idle".into(),
        message: "冲突已解决并提交；再次同步以推送".into(),
        commit: Some(id.to_string()),
        ..Default::default()
    };
    save_state(private, &state)?;
    Ok(state)
}
pub fn synchronize(
    root: &Path,
    private: &Path,
    config: &Config,
    token: &str,
    progress: impl FnMut(&str),
) -> Result<SyncState> {
    config.validate()?;
    let mut progress = progress;
    synchronize_guarded(root, private, config, token, |phase| {
        progress(phase);
        Ok(())
    })
}
/// The caller holds the worktree lock initially and reacquires it on `integrating`.
/// Only `fetching` and `pushing` permit releasing that lock for concurrent readers.
pub fn synchronize_guarded(
    root: &Path,
    private: &Path,
    config: &Config,
    token: &str,
    progress: impl FnMut(&str) -> Result<()>,
) -> Result<SyncState> {
    config.validate()?;
    synchronize_inner_guarded(root, private, config, token, progress)
}
#[cfg(test)]
fn synchronize_inner(
    root: &Path,
    private: &Path,
    config: &Config,
    token: &str,
    mut progress: impl FnMut(&str),
) -> Result<SyncState> {
    synchronize_inner_guarded(root, private, config, token, |phase| {
        progress(phase);
        Ok(())
    })
}
fn synchronize_inner_guarded(
    root: &Path,
    private: &Path,
    config: &Config,
    token: &str,
    mut progress: impl FnMut(&str) -> Result<()>,
) -> Result<SyncState> {
    let result = (|| {
        let repo = repository(root)?;
        validate_worktree(root)?;
        if repo.head()?.shorthand() != Some(config.branch.as_str()) {
            return Err(Error::Probe(
                "当前分支与配置分支不同，请先切换到固定同步分支".into(),
            ));
        }
        if pending_path(private).exists() {
            let pending: Pending = serde_json::from_slice(&fs::read(pending_path(private))?)
                .map_err(|e| Error::Probe(e.to_string()))?;
            if pending.target.is_some() {
                install(&repo, private, &pending)?;
            } else {
                let ours = repo.find_commit(Oid::from_str(&pending.local)?)?;
                let theirs = repo.find_commit(Oid::from_str(&pending.remote)?)?;
                let index = repo.merge_commits(&ours, &theirs, None)?;
                let recovered = SyncState {
                    phase: "conflict".into(),
                    message: "已恢复未完成冲突，请选择合并结果".into(),
                    conflicts: conflicts(&repo, &index)?,
                    ..Default::default()
                };
                save_state(private, &recovered)?;
                return Ok(recovered);
            }
        }
        progress("committing")?;
        commit_local(&repo)?;
        // Anonymous remote prevents a changed origin or embedded credentials from being used.
        for attempt in 0..3 {
            progress("fetching")?;
            let mut remote = repo.remote_anonymous(config.remote_url())?;
            let mut fetch = FetchOptions::new();
            fetch.remote_callbacks(callbacks(config, token));
            fetch.follow_redirects(git2::RemoteRedirect::None);
            let mut proxy = ProxyOptions::new();
            proxy.auto();
            fetch.proxy_options(proxy);
            remote
                .fetch(
                    &[&format!(
                        "refs/heads/{}:refs/remotes/mozhi-sync/{}",
                        config.branch, config.branch
                    )],
                    Some(&mut fetch),
                    None,
                )
                .map_err(remote_error)?;
            progress("integrating")?;
            let remote_id =
                repo.refname_to_id(&format!("refs/remotes/mozhi-sync/{}", config.branch))?;
            let local = repo.head()?.peel_to_commit()?;
            let theirs = repo.find_commit(remote_id)?;
            validate_tree(&repo, &theirs.tree()?)?;
            if local.id() != remote_id && !repo.graph_descendant_of(local.id(), remote_id)? {
                let mut pending = Pending {
                    local: local.id().to_string(),
                    remote: remote_id.to_string(),
                    target: None,
                    fingerprint: fingerprint(root)?,
                };
                if repo.graph_descendant_of(remote_id, local.id())? {
                    pending.target = Some(remote_id.to_string());
                } else {
                    let mut index = repo.merge_commits(&local, &theirs, None)?;
                    if index.has_conflicts() {
                        let state = SyncState {
                            phase: "conflict".into(),
                            message: "发现冲突；工作区保持本地版本，请选择合并结果".into(),
                            conflicts: conflicts(&repo, &index)?,
                            ..Default::default()
                        };
                        write_pending(private, &pending)?;
                        save_state(private, &state)?;
                        return Ok(state);
                    }
                    let tree = repo.find_tree(index.write_tree_to(&repo)?)?;
                    let sig = Signature::now("墨知", "notes@mozhi.local")?;
                    pending.target = Some(
                        repo.commit(None, &sig, &sig, "合并远程笔记", &tree, &[&local, &theirs])?
                            .to_string(),
                    );
                }
                write_pending(private, &pending)?;
                install(&repo, private, &pending)?;
            }
            progress("pushing")?;
            let mut options = PushOptions::new();
            options.follow_redirects(git2::RemoteRedirect::None);
            let mut proxy = ProxyOptions::new();
            proxy.auto();
            options.proxy_options(proxy);
            let rejected = std::sync::Arc::new(std::sync::Mutex::new(false));
            let signal = rejected.clone();
            let mut cb = callbacks(config, token);
            cb.push_update_reference(move |_, status| {
                if status.is_some() {
                    *signal.lock().unwrap() = true;
                }
                Ok(())
            });
            options.remote_callbacks(cb);
            match remote.push(
                &[&format!("refs/heads/{0}:refs/heads/{0}", config.branch)],
                Some(&mut options),
            ) {
                Ok(()) => {
                    if *rejected.lock().unwrap() {
                        return Err(Error::Probe(
                            "远程拒绝推送，请检查分支保护和权限；本地提交已保留".into(),
                        ));
                    }
                    let state = SyncState {
                        phase: "idle".into(),
                        message: "同步完成".into(),
                        commit: repo.head()?.target().map(|id| id.to_string()),
                        last_success: Some(
                            std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_secs(),
                        ),
                        conflicts: vec![],
                    };
                    save_state(private, &state)?;
                    return Ok(state);
                }
                Err(e) if e.code() == git2::ErrorCode::NotFastForward && attempt < 2 => continue,
                Err(e) => return Err(remote_error(e)),
            }
        }
        Err(Error::Probe("远程持续变化，请稍后重试".into()))
    })();
    if let Err(error) = &result {
        let mut state = state(private).unwrap_or_default();
        if state.phase != "conflict" {
            state.phase = "error".into();
            state.message = error.to_string();
            save_state(private, &state)?;
        }
    }
    result
}
#[derive(Serialize)]
pub struct Revision {
    pub id: String,
    pub message: String,
    pub timestamp: i64,
}
pub fn history(root: &Path, path: &str) -> Result<Vec<Revision>> {
    checked(root, path, true)?;
    let repo = repository(root)?;
    let mut walk = repo.revwalk()?;
    walk.push_head()?;
    walk.set_sorting(git2::Sort::TIME)?;
    let mut result = vec![];
    for id in walk.take(500) {
        let commit = repo.find_commit(id?)?;
        let tree = commit.tree()?;
        let Ok(entry) = tree.get_path(Path::new(path)) else {
            continue;
        };
        let changed = commit
            .parent(0)
            .ok()
            .and_then(|p| p.tree().ok())
            .and_then(|t| t.get_path(Path::new(path)).ok())
            .is_none_or(|old| old.id() != entry.id());
        if changed {
            result.push(Revision {
                id: commit.id().to_string(),
                message: commit.summary().unwrap_or("笔记更新").into(),
                timestamp: commit.time().seconds(),
            });
        }
        if result.len() >= 50 {
            break;
        }
    }
    Ok(result)
}
pub fn version(root: &Path, path: &str, id: &str) -> Result<String> {
    checked(root, path, true)?;
    let repo = repository(root)?;
    let commit = repo.find_commit(Oid::from_str(id)?)?;
    let head = repo.head()?.target().ok_or(Error::InvalidPath)?;
    if commit.id() != head && !repo.graph_descendant_of(head, commit.id())? {
        return Err(Error::InvalidPath);
    }
    let tree = commit.tree()?;
    let entry = tree.get_path(Path::new(path))?;
    let blob = repo.find_blob(entry.id())?;
    if blob.size() > 2 * 1024 * 1024 {
        return Err(Error::TooLarge);
    }
    String::from_utf8(blob.content().to_vec())
        .map_err(|_| Error::Probe("历史版本不是 UTF-8 文本".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn commit(repo: &Repository, path: &str, content: &str) -> Oid {
        fs::write(repo.workdir().unwrap().join(path), content).unwrap();
        commit_local(repo).unwrap();
        repo.head().unwrap().target().unwrap()
    }
    #[test]
    fn reports_ssh_key_exchange_failure_without_exposing_remote_details() {
        let error = git2::Error::new(
            git2::ErrorCode::GenericError,
            git2::ErrorClass::Ssh,
            "failed to start SSH session: Unable to exchange encryption keys; private-detail",
        );
        let message = remote_error(error).to_string();
        assert!(message.contains("加密密钥交换未完成"));
        assert!(!message.contains("private-detail"));
    }
    #[test]
    fn clone_uses_environment_proxy() {
        use std::{
            io::{Read, Write},
            net::TcpListener,
            process::Command,
            time::{Duration, Instant},
        };

        const CHILD: &str = "MOZHI_PROXY_TEST_CHILD";
        if let Some(root) = std::env::var_os(CHILD) {
            let root = PathBuf::from(root);
            // This exact-test subprocess is the only libgit2 user here.
            for level in [
                git2::ConfigLevel::System,
                git2::ConfigLevel::Global,
                git2::ConfigLevel::XDG,
                git2::ConfigLevel::ProgramData,
            ] {
                unsafe { git2::opts::set_search_path(level, root.to_str().unwrap()).unwrap() };
            }
            let config = Config {
                protocol: "https".into(),
                url: "https://proxy-test.invalid/repo.git".into(),
                branch: "main".into(),
                username: String::new(),
            };
            assert!(super::clone(&config, "", &root.join("clone")).is_err());
            assert!(!root.join("clone").exists());
            return;
        }

        let dir = tempfile::tempdir().unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let proxy = format!("http://{}", listener.local_addr().unwrap());
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "sync::tests::clone_uses_environment_proxy",
                "--nocapture",
                "--test-threads=1",
            ])
            .env_clear()
            .env(CHILD, dir.path())
            .env("HOME", dir.path())
            .env("USERPROFILE", dir.path())
            .env("XDG_CONFIG_HOME", dir.path())
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", dir.path().join("absent.gitconfig"))
            .env("HTTPS_PROXY", &proxy)
            .env("https_proxy", &proxy)
            .env("HTTP_PROXY", &proxy)
            .env("http_proxy", &proxy)
            .env("NO_PROXY", "")
            .env("no_proxy", "");
        if let Some(system_root) = std::env::var_os("SystemRoot") {
            command.env("SystemRoot", system_root);
        }
        let mut child = command.spawn().unwrap();
        let deadline = Instant::now() + Duration::from_secs(15);
        let mut requests = Vec::new();
        let result = (|| -> std::io::Result<_> {
            loop {
                if Instant::now() >= deadline {
                    return Err(std::io::ErrorKind::TimedOut.into());
                }
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        stream.set_read_timeout(Some(Duration::from_millis(200)))?;
                        stream.set_write_timeout(Some(Duration::from_secs(1)))?;
                        let mut request = Vec::new();
                        while !request.ends_with(b"\r\n\r\n") {
                            if Instant::now() >= deadline || request.len() >= 16 * 1024 {
                                return Err(std::io::ErrorKind::TimedOut.into());
                            }
                            let mut buffer = [0; 1024];
                            match stream.read(&mut buffer) {
                                Ok(0) => break,
                                Ok(n) => request.extend_from_slice(&buffer[..n]),
                                Err(e)
                                    if matches!(
                                        e.kind(),
                                        std::io::ErrorKind::WouldBlock
                                            | std::io::ErrorKind::TimedOut
                                    ) => {}
                                Err(e) => return Err(e),
                            }
                        }
                        requests.push(String::from_utf8_lossy(&request).into_owned());
                        stream.write_all(
                            b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                        )?;
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                    Err(e) => return Err(e),
                }
                if let Some(status) = child.try_wait()? {
                    return Ok(status);
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        })();
        if result.is_err() {
            let _ = child.kill();
            let _ = child.wait();
        }
        assert!(result
            .expect("proxy clone subprocess timed out or failed")
            .success());
        assert!(
            requests
                .iter()
                .any(|request| request.starts_with("CONNECT proxy-test.invalid:443 HTTP/1.")),
            "production clone did not CONNECT through the proxy: {requests:?}"
        );
    }

    #[test]
    fn full_sync_conflict_resolution_restart_and_history() {
        let dir = tempfile::tempdir().unwrap();
        let remote_path = dir.path().join("remote.git");
        let remote = Repository::init_bare(&remote_path).unwrap();
        remote.set_head("refs/heads/main").unwrap();
        let a_path = dir.path().join("a");
        let a = Repository::init(&a_path).unwrap();
        a.set_head("refs/heads/main").unwrap();
        commit(&a, "笔记.md", "# 祖先\n共同内容\n");
        a.remote("origin", remote_path.to_str().unwrap())
            .unwrap()
            .push(&["refs/heads/main:refs/heads/main"], None)
            .unwrap();
        let b_path = dir.path().join("b");
        let b = Repository::clone(remote_path.to_str().unwrap(), &b_path).unwrap();
        let private_a = dir.path().join("private-a");
        let private_b = dir.path().join("private-b");
        fs::create_dir(&private_a).unwrap();
        fs::create_dir(&private_b).unwrap();
        let config = Config {
            protocol: "https".into(),
            url: remote_path.to_string_lossy().into_owned(),
            branch: "main".into(),
            username: "git".into(),
        };
        // Only this private test helper bypasses the production HTTPS URL guard.
        commit(&a, "新增.md", "新增正文");
        let mut phases = Vec::new();
        synchronize_inner_guarded(&a_path, &private_a, &config, "", |phase| {
            phases.push(phase.to_owned());
            Ok(())
        })
        .unwrap();
        assert_eq!(phases, ["committing", "fetching", "integrating", "pushing"]);
        synchronize_inner(&b_path, &private_b, &config, "", |_| {}).unwrap();
        assert_eq!(
            fs::read_to_string(b_path.join("新增.md")).unwrap(),
            "新增正文"
        );
        fs::write(a_path.join("笔记.md"), "# 甲\n甲编辑\n").unwrap();
        synchronize_inner(&a_path, &private_a, &config, "", |_| {}).unwrap();
        fs::write(b_path.join("笔记.md"), "# 乙\n乙编辑\n").unwrap();
        let state = synchronize_inner(&b_path, &private_b, &config, "", |_| {}).unwrap();
        assert_eq!(state.phase, "conflict");
        assert_eq!(state.conflicts.len(), 1);
        assert_eq!(
            fs::read_to_string(b_path.join("笔记.md")).unwrap(),
            "# 乙\n乙编辑\n"
        );
        assert_eq!(
            state.conflicts[0].ancestor.as_deref(),
            Some("# 祖先\n共同内容\n")
        );
        resolve_conflicts(
            &b_path,
            &private_b,
            &[Decision {
                path: "笔记.md".into(),
                choice: "manual".into(),
                content: Some("# 合并\n甲编辑\n乙编辑\n".into()),
            }],
        )
        .unwrap();
        assert_eq!(
            b.head().unwrap().peel_to_commit().unwrap().parent_count(),
            2
        );
        synchronize_inner(&b_path, &private_b, &config, "", |_| {}).unwrap();
        synchronize_inner(&a_path, &private_a, &config, "", |_| {}).unwrap();
        assert_eq!(
            fs::read(a_path.join("笔记.md")).unwrap(),
            fs::read(b_path.join("笔记.md")).unwrap()
        );
        let versions = history(&b_path, "笔记.md").unwrap();
        assert!(versions.len() >= 3);
        assert!(version(&b_path, "笔记.md", &versions[0].id)
            .unwrap()
            .contains("合并"));
        // Crash after tree checkout but before ref update: resume without force reset.
        let local = b.head().unwrap().target().unwrap();
        commit(&a, "重启.md", "恢复");
        synchronize_inner(&a_path, &private_a, &config, "", |_| {}).unwrap();
        b.find_remote("origin")
            .unwrap()
            .fetch(&["main"], None, None)
            .unwrap();
        let target = b.refname_to_id("refs/remotes/origin/main").unwrap();
        let pending = Pending {
            local: local.to_string(),
            remote: target.to_string(),
            target: Some(target.to_string()),
            fingerprint: fingerprint(&b_path).unwrap(),
        };
        write_pending(&private_b, &pending).unwrap();
        b.checkout_tree(
            b.find_commit(target).unwrap().tree().unwrap().as_object(),
            Some(CheckoutBuilder::new().safe()),
        )
        .unwrap();
        synchronize_inner(&b_path, &private_b, &config, "", |_| {}).unwrap();
        assert_eq!(b.head().unwrap().target(), Some(target));
        assert!(!pending_path(&private_b).exists());
        fs::write(b_path.join("secret.txt"), "do not stage").unwrap();
        assert!(synchronize_inner(&b_path, &private_b, &config, "", |_| {}).is_err());
    }
    #[test]
    fn binary_keep_both_delete_edit_and_external_edit_guard() {
        let dir = tempfile::tempdir().unwrap();
        let remote_path = dir.path().join("remote.git");
        let remote = Repository::init_bare(&remote_path).unwrap();
        remote.set_head("refs/heads/main").unwrap();
        let a_path = dir.path().join("a");
        let a = Repository::init(&a_path).unwrap();
        a.set_head("refs/heads/main").unwrap();
        fs::create_dir(a_path.join("attachments")).unwrap();
        fs::write(a_path.join("attachments/image.png"), [0, 1, 2]).unwrap();
        commit(&a, "note.md", "# initial");
        a.remote("origin", remote_path.to_str().unwrap())
            .unwrap()
            .push(&["refs/heads/main:refs/heads/main"], None)
            .unwrap();
        let b_path = dir.path().join("b");
        let b = Repository::clone(remote_path.to_str().unwrap(), &b_path).unwrap();
        let private_a = dir.path().join("pa");
        let private_b = dir.path().join("pb");
        fs::create_dir(&private_a).unwrap();
        fs::create_dir(&private_b).unwrap();
        let config = Config {
            protocol: "https".into(),
            url: remote_path.to_string_lossy().into_owned(),
            branch: "main".into(),
            username: "git".into(),
        };
        fs::write(a_path.join("attachments/image.png"), [0, 5, 6]).unwrap();
        synchronize_inner(&a_path, &private_a, &config, "", |_| {}).unwrap();
        fs::write(b_path.join("attachments/image.png"), [0, 7, 8]).unwrap();
        let state = synchronize_inner(&b_path, &private_b, &config, "", |_| {}).unwrap();
        assert!(state.conflicts[0].binary);
        resolve_conflicts(
            &b_path,
            &private_b,
            &[Decision {
                path: "attachments/image.png".into(),
                choice: "both".into(),
                content: None,
            }],
        )
        .unwrap();
        assert_eq!(
            fs::read(b_path.join("attachments/image.png")).unwrap(),
            [0, 7, 8]
        );
        let copies: Vec<_> = fs::read_dir(b_path.join("attachments"))
            .unwrap()
            .map(|e| e.unwrap().path())
            .collect();
        assert_eq!(copies.len(), 2);
        assert!(copies.iter().any(|p| fs::read(p).unwrap() == [0, 5, 6]));
        synchronize_inner(&b_path, &private_b, &config, "", |_| {}).unwrap();
        synchronize_inner(&a_path, &private_a, &config, "", |_| {}).unwrap();
        fs::remove_file(a_path.join("note.md")).unwrap();
        synchronize_inner(&a_path, &private_a, &config, "", |_| {}).unwrap();
        fs::write(b_path.join("note.md"), "# modified").unwrap();
        let state = synchronize_inner(&b_path, &private_b, &config, "", |_| {}).unwrap();
        assert!(state.conflicts[0].remote_deleted);
        fs::write(b_path.join("note.md"), "# external").unwrap();
        assert!(resolve_conflicts(
            &b_path,
            &private_b,
            &[Decision {
                path: "note.md".into(),
                choice: "local".into(),
                content: None
            }]
        )
        .is_err());
        fs::write(b_path.join("note.md"), "# modified").unwrap();
        resolve_conflicts(
            &b_path,
            &private_b,
            &[Decision {
                path: "note.md".into(),
                choice: "remote".into(),
                content: None,
            }],
        )
        .unwrap();
        assert!(!b_path.join("note.md").exists());
        assert_eq!(
            b.head().unwrap().peel_to_commit().unwrap().parent_count(),
            2
        );
    }
    #[test]
    fn rejects_credentials_in_urls_and_unsafe_branches() {
        for url in [
            "http://host/repo",
            "https://user:secret@host/repo",
            "https://host/repo?token=x",
            "file:///repo",
        ] {
            assert!(Config {
                protocol: "https".into(),
                url: url.into(),
                branch: "main".into(),
                username: "git".into()
            }
            .validate()
            .is_err());
        }
        assert!(Config {
            protocol: "https".into(),
            url: "https://github.com/user/repo.git".into(),
            branch: "../main".into(),
            username: "git".into()
        }
        .validate()
        .is_err());
        assert!(Config {
            protocol: "ssh".into(),
            url: "ssh://git@github.com/user/repo.git".into(),
            branch: "main".into(),
            username: "git".into(),
        }
        .validate()
        .is_ok());
    }
    fn ssh(url: &str) -> Config {
        Config {
            protocol: "ssh".into(),
            url: url.into(),
            branch: "main".into(),
            username: "git".into(),
        }
    }
    #[test]
    fn validates_ssh_username_consistency() {
        for url in [
            "alice@example.com:notes.git",
            "ssh://alice@example.com/notes.git",
            "ssh://%61lice@example.com/notes.git",
        ] {
            let mut config = ssh(url);
            assert!(config
                .validate()
                .unwrap_err()
                .to_string()
                .contains("用户名不一致"));
            config.username = "alice".into();
            assert!(config.validate().is_ok(), "{url}");
            config.username.clear();
            assert!(config.validate().is_ok(), "{url}");
        }
        for url in [
            "example.com:notes.git",
            "ssh://example.com/notes.git",
            "git@example.com:notes.git",
        ] {
            assert!(ssh(url).validate().is_ok(), "{url}");
        }
        let config = Config {
            protocol: "https".into(),
            url: "https://example.com/notes.git".into(),
            username: "alice".into(),
            branch: "main".into(),
        };
        assert!(config.validate().is_ok());
    }
    #[test]
    fn supplies_username_before_ssh_key_authentication() {
        for (username, url_user) in [("git", None), ("", None), ("", Some("git"))] {
            let mut config = ssh("github.com:user/repo.git");
            config.username = username.into();
            let credential =
                ssh_credential(&config, url_user, git2::CredentialType::USERNAME).unwrap();
            assert!(credential.has_username());
            assert_eq!(
                credential.credtype() as u32,
                git2::CredentialType::USERNAME.bits()
            );
        }
        assert!(ssh_credential(
            &ssh("github.com:user/repo.git"),
            None,
            git2::CredentialType::USER_PASS_PLAINTEXT
        )
        .is_err());
    }
    #[test]
    fn accepts_ssh_scp_shorthand_and_passes_it_through() {
        for (url, expected) in [
            (
                "git@github.com:user/repo.git",
                "git@github.com:user/repo.git",
            ),
            // 省略用户：Git 与 libgit2 都按 scp 形式接受。
            ("github.com:user/repo.git", "github.com:user/repo.git"),
        ] {
            let config = ssh(url);
            assert!(config.validate().is_ok(), "{url} 应被接受");
            // 原样透传：改写成 ssh:// 会把相对家目录的路径变成绝对路径。
            assert_eq!(config.remote_url(), expected, "{url}");
        }
        // 斜杠形式仍走标准 URL 路径，不被误判成 scp 简写。
        let standard = ssh("ssh://git@github.com/user/repo.git");
        assert!(standard.validate().is_ok());
        assert_eq!(standard.remote_url(), "ssh://git@github.com/user/repo.git");
        // 显式端口不能因为 scp 判定而丢失。
        let port = ssh("ssh://git@github.com:2222/user/repo.git");
        assert!(port.validate().is_ok());
        assert_eq!(port.remote_url(), "ssh://git@github.com:2222/user/repo.git");
    }
    #[test]
    fn rejects_scp_shorthand_that_smuggles_credentials_or_escapes_host() {
        for url in [
            "ssh://git@github.com:user/repo.git",
            "ssh://git:secret@github.com/team/repo.git",
            "C:/repos/source.git",
            "c:repos/source.git",
            "C:\\repos\\source.git",
            "//server/share/repo.git",
            "\\\\server\\share\\repo.git",
            "git:secret@github.com:user/repo.git",
            "git@github.com:user:repo.git",
            "git@github.com:user/repo.git?token=x",
            "git@github.com:user/repo.git#frag",
            "user@@github.com:user/repo.git",
            "git@/repo.git",
            "git@.github.com:user/repo.git",
            "git@github.com\\user\\repo.git",
        ] {
            assert!(ssh(url).validate().is_err(), "{url} 应被拒绝");
        }
    }
}
