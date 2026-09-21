use crate::{Error, Result};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use tempfile::NamedTempFile;
use walkdir::WalkDir;

const MAX_NOTE_BYTES: u64 = 2 * 1024 * 1024;

pub fn hash(content: &[u8]) -> String {
    format!("{:x}", Sha256::digest(content))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub path: String,
    pub content: String,
    pub content_hash: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub path: String,
    pub bytes: u64,
}

pub struct Vault {
    root: PathBuf,
    recovery: PathBuf,
}
impl Vault {
    pub fn open(root: &Path, recovery: &Path) -> Result<Self> {
        let root = root.canonicalize()?;
        if !root.is_dir() {
            return Err(Error::InvalidPath);
        }
        fs::create_dir_all(recovery)?;
        let recovery = recovery.canonicalize()?;
        if recovery.starts_with(&root) {
            return Err(Error::InvalidPath);
        }
        Ok(Self { root, recovery })
    }
    pub fn root(&self) -> &Path {
        &self.root
    }
    pub fn recovery_dir(&self) -> &Path {
        &self.recovery
    }
    // Reject symlinks entirely, including links that currently point inside the vault.
    fn resolve(&self, relative: &str) -> Result<PathBuf> {
        let path = crate::operations::checked(&self.root, relative, true)?;
        if !path.canonicalize()?.starts_with(&self.root)
            || path
                .extension()
                .and_then(|s| s.to_str())
                .map(str::to_ascii_lowercase)
                .as_deref()
                != Some("md")
        {
            return Err(Error::InvalidPath);
        }
        Ok(path)
    }
    pub fn list(&self) -> Result<Vec<Entry>> {
        let mut entries = Vec::new();
        for entry in WalkDir::new(&self.root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| {
                e.depth() == 0
                    || (!e.file_name().to_string_lossy().starts_with('.')
                        && fs::symlink_metadata(e.path()).is_ok_and(|m| !crate::paths::is_link(&m)))
            })
        {
            let entry = entry.map_err(|e| Error::Probe(e.to_string()))?;
            if !entry.file_type().is_file() {
                continue;
            }
            let relative = entry
                .path()
                .strip_prefix(&self.root)
                .map_err(|_| Error::InvalidPath)?;
            let Ok(relative) = crate::paths::logical(relative) else {
                continue;
            };
            if entry
                .path()
                .extension()
                .and_then(|s| s.to_str())
                .is_some_and(|s| s.eq_ignore_ascii_case("md"))
            {
                entries.push(Entry {
                    path: relative,
                    bytes: fs::metadata(entry.path())?.len(),
                });
            }
        }
        entries.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(entries)
    }
    pub fn read(&self, relative: &str) -> Result<Note> {
        let path = self.resolve(relative)?;
        if fs::metadata(&path)?.len() > MAX_NOTE_BYTES {
            return Err(Error::TooLarge);
        }
        let bytes = fs::read(path)?;
        let content = String::from_utf8(bytes.clone())
            .map_err(|_| Error::Probe("仅支持 UTF-8 Markdown".into()))?;
        Ok(Note {
            path: relative.into(),
            content,
            content_hash: hash(&bytes),
        })
    }
    pub fn draft(&self, relative: &str, content: &str) -> Result<()> {
        self.resolve(relative)?;
        if content.len() as u64 > MAX_NOTE_BYTES {
            return Err(Error::TooLarge);
        }
        let key = hash(format!("{}:{relative}", self.root.display()).as_bytes());
        atomic_write(&self.recovery.join(format!("{key}.md")), content.as_bytes())
    }
    pub fn read_draft(&self, relative: &str) -> Result<Option<String>> {
        self.resolve(relative)?;
        let key = hash(format!("{}:{relative}", self.root.display()).as_bytes());
        match fs::read_to_string(self.recovery.join(format!("{key}.md"))) {
            Ok(content) => Ok(Some(content)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }
    pub fn save(&self, relative: &str, expected: &str, content: &str) -> Result<Note> {
        // The draft survives failures and conflicts; successful saves retain the latest recovery copy.
        self.draft(relative, content)?;
        let path = self.resolve(relative)?;
        if self.read(relative)?.content_hash != expected {
            return Err(Error::Conflict);
        }
        let permissions = fs::metadata(&path)?.permissions();
        let mut temporary = NamedTempFile::new_in(path.parent().ok_or(Error::InvalidPath)?)?;
        temporary.write_all(content.as_bytes())?;
        temporary.as_file().set_permissions(permissions)?;
        temporary.as_file().sync_all()?;
        // Recheck after writing the temporary file to narrow the external-writer race.
        if self.read(relative)?.content_hash != expected {
            return Err(Error::Conflict);
        }
        temporary.persist(&path).map_err(|e| Error::Io(e.error))?;
        sync_parent(&path)?;
        self.read(relative)
    }
}
fn sync_parent(_path: &Path) -> Result<()> {
    #[cfg(unix)]
    fs::File::open(_path.parent().ok_or(Error::InvalidPath)?)?.sync_all()?;
    Ok(())
}
pub fn atomic_write(path: &Path, content: &[u8]) -> Result<()> {
    let mut temporary = NamedTempFile::new_in(path.parent().ok_or(Error::InvalidPath)?)?;
    temporary.write_all(content)?;
    temporary.as_file().sync_all()?;
    temporary.persist(path).map_err(|e| Error::Io(e.error))?;
    sync_parent(path)
}
