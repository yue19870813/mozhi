use crate::{
    knowledge, markdown,
    vault::{atomic_write, hash, Vault},
    Error, Result,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

pub fn checked(root: &Path, relative: &str, exists: bool) -> Result<PathBuf> {
    if relative.is_empty()
        || relative.contains('\\')
        || relative.contains('\0')
        || relative
            .split('/')
            .any(|p| p.is_empty() || p == "." || p == "..")
    {
        return Err(Error::InvalidPath);
    }
    let mut path = root.to_path_buf();
    for component in Path::new(relative).components() {
        let Component::Normal(name) = component else {
            return Err(Error::InvalidPath);
        };
        let name = name.to_str().ok_or(Error::InvalidPath)?;
        if name.starts_with('.')
            || name.ends_with([' ', '.'])
            || name
                .chars()
                .any(|c| c.is_control() || "<>:\"|?*".contains(c))
            || name.nfc().collect::<String>() != name
        {
            return Err(Error::InvalidPath);
        }
        if crate::paths::reserved_name(name) {
            return Err(Error::InvalidPath);
        }
        if path.is_dir() {
            for entry in fs::read_dir(&path)? {
                let entry = entry?;
                let other = entry.file_name().to_string_lossy().to_string();
                if other != name
                    && other.nfc().collect::<String>().to_lowercase() == name.to_lowercase()
                {
                    return Err(Error::Probe("目标存在大小写或 Unicode 冲突".into()));
                }
            }
        }
        path.push(name);
        match fs::symlink_metadata(&path) {
            Ok(meta) if crate::paths::is_link(&meta) => return Err(Error::InvalidPath),
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.into()),
            _ => {}
        }
    }
    if exists && !path.exists() {
        return Err(Error::Probe("文件不存在，请刷新笔记库".into()));
    }
    Ok(path)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeEntry {
    pub path: String,
    pub is_directory: bool,
    pub is_attachment: bool,
}
pub fn tree(vault: &Vault) -> Result<Vec<TreeEntry>> {
    let mut entries = vec![];
    for entry in walkdir::WalkDir::new(vault.root())
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            e.depth() == 0
                || (!e.file_name().to_string_lossy().starts_with('.')
                    && fs::symlink_metadata(e.path()).is_ok_and(|m| !crate::paths::is_link(&m)))
        })
    {
        let entry = entry.map_err(|e| Error::Probe(e.to_string()))?;
        if entry.depth() == 0 || crate::paths::is_link(&fs::symlink_metadata(entry.path())?) {
            continue;
        }
        let path = crate::paths::logical(
            entry
                .path()
                .strip_prefix(vault.root())
                .map_err(|_| Error::InvalidPath)?,
        )?;
        if entry.file_type().is_dir()
            || path.to_lowercase().ends_with(".md")
            || path.starts_with("attachments/")
        {
            entries.push(TreeEntry {
                is_attachment: !entry.file_type().is_dir() && !path.to_lowercase().ends_with(".md"),
                path,
                is_directory: entry.file_type().is_dir(),
            });
        }
    }
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(entries)
}
pub fn create(vault: &Vault, relative: &str, directory: bool) -> Result<()> {
    let path = checked(vault.root(), relative, false)?;
    if path.exists() || !path.parent().is_some_and(Path::is_dir) {
        return Err(Error::Probe("目标已存在或父目录不存在".into()));
    }
    if directory {
        fs::create_dir(path)?;
    } else {
        if !relative.ends_with(".md") {
            return Err(Error::InvalidPath);
        }
        let title = path.file_stem().unwrap_or_default().to_string_lossy();
        let content = format!(
            "---\nid: {}\ntags: []\n---\n\n# {title}\n\n",
            Uuid::new_v4()
        );
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(path)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
    }
    Ok(())
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recovery {
    pub id: String,
    pub kind: String,
    pub source: String,
    pub destination: Option<String>,
    pub completed: bool,
    #[serde(default)]
    pub created_at: u64,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
#[derive(Serialize, Deserialize)]
pub(crate) struct Backup {
    pub(crate) path: String,
    pub(crate) content: Vec<u8>,
    pub(crate) hash: String,
}
fn snapshot(root: &Path, relative: &str) -> Result<Vec<Backup>> {
    let source = checked(root, relative, true)?;
    let mut result = vec![];
    for e in walkdir::WalkDir::new(source).follow_links(false) {
        let e = e.map_err(|e| Error::Probe(e.to_string()))?;
        if crate::paths::is_link(&fs::symlink_metadata(e.path())?) || e.file_name() == ".git" {
            return Err(Error::InvalidPath);
        }
        if e.file_type().is_file() {
            let path = crate::paths::logical(
                e.path()
                    .strip_prefix(root)
                    .map_err(|_| Error::InvalidPath)?,
            )?;
            checked(root, &path, true)?;
            let content = fs::read(e.path())?;
            result.push(Backup {
                path,
                hash: hash(&content),
                content,
            });
        }
    }
    Ok(result)
}
fn journal(vault: &Vault, record: &Recovery, backups: &[Backup]) -> Result<PathBuf> {
    let dir = vault.recovery_dir().join("operations").join(&record.id);
    fs::create_dir_all(&dir)?;
    atomic_write(
        &dir.join("backup.json"),
        &serde_json::to_vec(backups).map_err(|e| Error::Probe(e.to_string()))?,
    )?;
    atomic_write(
        &dir.join("record.json"),
        &serde_json::to_vec(record).map_err(|e| Error::Probe(e.to_string()))?,
    )?;
    Ok(dir)
}
pub fn remove(vault: &Vault, relative: &str) -> Result<String> {
    let source = checked(vault.root(), relative, true)?;
    if source.is_file() && !relative.ends_with(".md") && !relative.starts_with("attachments/") {
        return Err(Error::InvalidPath);
    }
    let backups = snapshot(vault.root(), relative)?;
    let mut record = Recovery {
        id: Uuid::new_v4().to_string(),
        kind: if source.is_dir() {
            "delete-directory"
        } else {
            "delete"
        }
        .into(),
        source: relative.into(),
        destination: None,
        completed: false,
        created_at: now(),
    };
    let dir = journal(vault, &record, &backups)?;
    verify(vault.root(), &backups)?;
    let current = snapshot(vault.root(), relative)?;
    if current.len() != backups.len()
        || current.iter().any(|entry| {
            !backups
                .iter()
                .any(|old| old.path == entry.path && old.hash == entry.hash)
        })
    {
        return Err(Error::Conflict);
    }
    if source.is_dir() {
        fs::remove_dir_all(&source)?;
    } else {
        fs::remove_file(&source)?;
    }
    record.completed = true;
    atomic_write(
        &dir.join("record.json"),
        &serde_json::to_vec(&record).unwrap(),
    )?;
    Ok(record.id)
}
fn verify(root: &Path, backups: &[Backup]) -> Result<()> {
    for backup in backups {
        if hash(&fs::read(checked(root, &backup.path, true)?)?) != backup.hash {
            return Err(Error::Conflict);
        }
    }
    Ok(())
}
pub fn move_entry(vault: &Vault, from: &str, to: &str) -> Result<String> {
    let source = checked(vault.root(), from, true)?;
    let destination = checked(vault.root(), to, false)?;
    if destination.exists()
        || destination.starts_with(&source)
        || !destination.parent().is_some_and(Path::is_dir)
    {
        return Err(Error::Probe(
            "目标已存在、父目录不存在或移动形成循环".into(),
        ));
    }
    if source.is_file() && source.extension() != destination.extension() {
        return Err(Error::Probe("移动时不能更改扩展名".into()));
    }
    let notes = knowledge::scan(vault)?;
    let mut backups = snapshot(vault.root(), from)?;
    let moves: BTreeMap<_, _> = backups
        .iter()
        .map(|b| (b.path.clone(), format!("{to}{}", &b.path[from.len()..])))
        .collect();
    let mut edits = vec![];
    for note in notes {
        let content = vault.read(&note.path)?.content;
        let rewritten = markdown::rewrite(&content, &note, &moves);
        if rewritten != content {
            if !backups.iter().any(|b| b.path == note.path) {
                backups.push(Backup {
                    path: note.path.clone(),
                    hash: hash(content.as_bytes()),
                    content: content.into_bytes(),
                });
            }
            edits.push((
                moves.get(&note.path).cloned().unwrap_or(note.path),
                rewritten,
            ));
        }
    }
    let mut record = Recovery {
        id: Uuid::new_v4().to_string(),
        kind: "move".into(),
        source: from.into(),
        destination: Some(to.into()),
        completed: false,
        created_at: now(),
    };
    let dir = journal(vault, &record, &backups)?;
    verify(vault.root(), &backups)?;
    fs::rename(&source, &destination)?;
    for (path, content) in edits {
        atomic_write(&checked(vault.root(), &path, true)?, content.as_bytes())?;
    }
    record.completed = true;
    atomic_write(
        &dir.join("record.json"),
        &serde_json::to_vec(&record).unwrap(),
    )?;
    Ok(record.id)
}
pub fn recoveries(vault: &Vault) -> Result<Vec<Recovery>> {
    let root = vault.recovery_dir().join("operations");
    if !root.exists() {
        return Ok(vec![]);
    }
    let mut result = vec![];
    for e in fs::read_dir(root)? {
        let path = e?.path().join("record.json");
        if path.is_file() {
            result.push(
                serde_json::from_slice(&fs::read(path)?)
                    .map_err(|e| Error::Probe(e.to_string()))?,
            );
        }
    }
    Ok(result)
}
// Recovery is an export into a fresh directory: it never overwrites newer user edits.
pub fn restore(vault: &Vault, id: &str) -> Result<String> {
    Uuid::parse_str(id).map_err(|_| Error::InvalidPath)?;
    let dir = vault.recovery_dir().join("operations").join(id);
    let backups: Vec<Backup> = serde_json::from_slice(&fs::read(dir.join("backup.json"))?)
        .map_err(|e| Error::Probe(e.to_string()))?;
    let destination = format!("恢复-{}", Uuid::new_v4());
    let root = checked(vault.root(), &destination, false)?;
    fs::create_dir(&root)?;
    for backup in backups {
        let target = checked(&root, &backup.path, false)?;
        fs::create_dir_all(target.parent().ok_or(Error::InvalidPath)?)?;
        atomic_write(&target, &backup.content)?;
    }
    Ok(destination)
}
pub fn import_image(vault: &Vault, source: &Path) -> Result<String> {
    let size = fs::metadata(source)?.len();
    if size > 10 * 1024 * 1024 {
        return Err(Error::Probe("图片上限 10 MiB".into()));
    }
    let bytes = fs::read(source)?;
    let ext = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "png"
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        "jpg"
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        "gif"
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        "webp"
    } else {
        return Err(Error::Probe("仅支持 PNG/JPEG/GIF/WebP 图片".into()));
    };
    let folder = checked(vault.root(), "attachments", false)?;
    fs::create_dir_all(folder)?;
    let relative = format!("attachments/{}.{}", Uuid::new_v4(), ext);
    atomic_write(&checked(vault.root(), &relative, false)?, &bytes)?;
    Ok(relative)
}
pub fn attachment(vault: &Vault, relative: &str) -> Result<(String, Vec<u8>)> {
    let path = checked(vault.root(), relative, true)?;
    if !relative.starts_with("attachments/") || fs::metadata(&path)?.len() > 10 * 1024 * 1024 {
        return Err(Error::InvalidPath);
    }
    let mime = match path.extension().and_then(|s| s.to_str()) {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        _ => return Err(Error::InvalidPath),
    };
    Ok((mime.into(), fs::read(path)?))
}
pub fn export(vault: &Vault, destination: &Path) -> Result<()> {
    let parent = destination
        .parent()
        .ok_or(Error::InvalidPath)?
        .canonicalize()?;
    let destination = parent.join(destination.file_name().ok_or(Error::InvalidPath)?);
    if destination.starts_with(vault.root()) {
        return Err(Error::Probe("导出文件请保存在笔记库以外".into()));
    }
    let parent = destination.parent().ok_or(Error::InvalidPath)?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    {
        let mut archive = zip::ZipWriter::new(temporary.as_file_mut());
        for e in walkdir::WalkDir::new(vault.root())
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| {
                e.depth() == 0
                    || (!e.file_name().to_string_lossy().starts_with('.')
                        && fs::symlink_metadata(e.path()).is_ok_and(|m| !crate::paths::is_link(&m)))
            })
        {
            let e = e.map_err(|e| Error::Probe(e.to_string()))?;
            if !e.file_type().is_file() {
                continue;
            }
            let relative = crate::paths::logical(
                e.path()
                    .strip_prefix(vault.root())
                    .map_err(|_| Error::InvalidPath)?,
            )?;
            checked(vault.root(), &relative, true)?;
            archive
                .start_file(relative, zip::write::SimpleFileOptions::default())
                .map_err(|e| Error::Probe(e.to_string()))?;
            let mut file = fs::File::open(e.path())?;
            let mut buffer = [0; 65536];
            loop {
                let n = file.read(&mut buffer)?;
                if n == 0 {
                    break;
                }
                archive.write_all(&buffer[..n])?;
            }
        }
        archive.finish().map_err(|e| Error::Probe(e.to_string()))?;
    }
    temporary.as_file().sync_all()?;
    temporary
        .persist_noclobber(destination)
        .map_err(|e| Error::Io(e.error))?;
    Ok(())
}
