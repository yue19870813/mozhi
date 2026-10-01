//! Operation backup retention. Drafts and Git history are deliberately outside this module.
//! Callers serialize mutations with the per-vault lock (including cleanup and restore).
use crate::{
    operations::{Backup, Recovery},
    vault::{atomic_write, hash, Vault},
    Error, Result,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

const DAY: u64 = 86_400;
const MIB: u64 = 1024 * 1024;
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Policy {
    pub retention_days: u64,
    pub max_bytes: u64,
    pub max_count: usize,
}
impl Default for Policy {
    fn default() -> Self {
        Self {
            retention_days: 30,
            max_bytes: 1024 * MIB,
            max_count: 1000,
        }
    }
}
impl Policy {
    pub fn validate(&self) -> Result<()> {
        if !(1..=3650).contains(&self.retention_days)
            || !(MIB..=1024 * 1024 * MIB).contains(&self.max_bytes)
            || !(1..=100_000).contains(&self.max_count)
        {
            return Err(Error::Probe(
                "保留时间需为 1–3650 天，容量为 1–1048576 MiB，条数为 1–100000".into(),
            ));
        }
        Ok(())
    }
}
fn safe_file(path: &Path) -> Result<fs::Metadata> {
    let meta = fs::symlink_metadata(path)?;
    if crate::paths::is_link(&meta) || !meta.is_file() {
        return Err(Error::InvalidPath);
    }
    Ok(meta)
}
fn safe_root(vault: &Vault) -> Result<std::path::PathBuf> {
    let root = vault.recovery_dir().join("operations");
    match fs::symlink_metadata(&root) {
        Ok(meta) if crate::paths::is_link(&meta) || !meta.is_dir() => Err(Error::InvalidPath),
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
        _ => Ok(root),
    }
}
pub fn policy(vault: &Vault) -> Result<Policy> {
    let path = vault.recovery_dir().join("retention.json");
    match safe_file(&path) {
        Err(Error::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => Ok(Policy::default()),
        Err(e) => Err(e),
        Ok(_) => {
            let policy: Policy = serde_json::from_slice(&fs::read(path)?)
                .map_err(|e| Error::Probe(e.to_string()))?;
            policy.validate()?;
            Ok(policy)
        }
    }
}
pub fn save_policy(vault: &Vault, policy: &Policy) -> Result<()> {
    policy.validate()?;
    let path = vault.recovery_dir().join("retention.json");
    match safe_file(&path) {
        Err(Error::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e),
        _ => {}
    }
    atomic_write(
        &path,
        &serde_json::to_vec(policy).map_err(|e| Error::Probe(e.to_string()))?,
    )
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    #[serde(flatten)]
    pub record: Recovery,
    pub bytes: u64,
    pub protected: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub policy: Policy,
    pub records: Vec<Entry>,
    pub count: usize,
    pub bytes: u64,
    pub protected_count: usize,
    pub over_limit: bool,
    pub warnings: Vec<String>,
}
struct Scanned {
    entry: Entry,
    fingerprint: String,
}
// Only ordinary UUID directories containing the two expected regular files are eligible.
fn inspect(root: &Path, id: &str, at: u64, migrate: bool) -> Result<Scanned> {
    if uuid::Uuid::parse_str(id).is_err() {
        return Err(Error::InvalidPath);
    }
    let dir = root.join(id);
    let meta = fs::symlink_metadata(&dir)?;
    if crate::paths::is_link(&meta) || !meta.is_dir() {
        return Err(Error::InvalidPath);
    }
    let mut files = 0;
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        if entry.file_name() != "record.json" && entry.file_name() != "backup.json" {
            return Err(Error::InvalidPath);
        }
        safe_file(&entry.path())?;
        files += 1;
    }
    if files != 2 {
        return Err(Error::Probe("恢复副本不完整".into()));
    }
    let record_path = dir.join("record.json");
    let mut bytes = fs::read(&record_path)?;
    let mut record: Recovery =
        serde_json::from_slice(&bytes).map_err(|e| Error::Probe(e.to_string()))?;
    if record.id != id {
        return Err(Error::InvalidPath);
    }
    // Legacy records get a full new retention period, never an inferred old file mtime.
    if record.created_at == 0 && migrate {
        record.created_at = at;
        bytes = serde_json::to_vec(&record).map_err(|e| Error::Probe(e.to_string()))?;
        atomic_write(&record_path, &bytes)?;
    }
    let protected =
        !record.completed || record.created_at == 0 || at.saturating_sub(record.created_at) < DAY;
    let size = bytes.len() as u64 + safe_file(&dir.join("backup.json"))?.len();
    Ok(Scanned {
        entry: Entry {
            record,
            bytes: size,
            protected,
        },
        fingerprint: hash(&bytes),
    })
}
fn scan(vault: &Vault, at: u64) -> Result<(Vec<Scanned>, Vec<String>, usize, u64)> {
    let root = safe_root(vault)?;
    let mut records = vec![];
    let mut warnings = vec![];
    let mut count = 0;
    let mut bytes = 0;
    if !root.exists() {
        return Ok((records, warnings, count, bytes));
    }
    for item in fs::read_dir(&root)? {
        let item = item?;
        count += 1;
        let id = item.file_name().to_string_lossy().to_string();
        match inspect(&root, &id, at, true) {
            Ok(record) => {
                bytes += record.entry.bytes;
                records.push(record);
            }
            Err(_) => {
                // Account for abnormal backups without following links; leave them intact.
                for file in walkdir::WalkDir::new(item.path())
                    .follow_links(false)
                    .follow_root_links(false)
                    .into_iter()
                    .flatten()
                {
                    if let Ok(meta) = fs::symlink_metadata(file.path()) {
                        if !crate::paths::is_link(&meta) && meta.is_file() {
                            bytes += meta.len();
                        }
                    }
                }
                warnings.push(format!(
                    "记录 {id} 不完整、不可读或含异常路径，已保留，请检查本地恢复目录。"
                ));
            }
        }
    }
    records.sort_by(|a, b| {
        (a.entry.record.created_at, &a.entry.record.id)
            .cmp(&(b.entry.record.created_at, &b.entry.record.id))
    });
    Ok((records, warnings, count, bytes))
}
pub fn overview(vault: &Vault) -> Result<Overview> {
    overview_at(vault, now())
}
fn overview_at(vault: &Vault, at: u64) -> Result<Overview> {
    let policy = policy(vault)?;
    let (records, warnings, count, bytes) = scan(vault, at)?;
    let protected_count =
        count - records.len() + records.iter().filter(|r| r.entry.protected).count();
    Ok(Overview {
        over_limit: count > policy.max_count || bytes > policy.max_bytes,
        policy,
        count,
        bytes,
        protected_count,
        warnings,
        records: records.into_iter().rev().map(|r| r.entry).collect(),
    })
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Candidate {
    pub id: String,
    pub fingerprint: String,
    pub bytes: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub candidates: Vec<Candidate>,
    pub bytes: u64,
}
fn plan_at(vault: &Vault, at: u64, expired_only: bool) -> Result<Plan> {
    let policy = policy(vault)?;
    let (records, _, mut count, mut bytes) = scan(vault, at)?;
    let mut candidates = vec![];
    for record in records {
        if record.entry.protected {
            continue;
        }
        let expired =
            at.saturating_sub(record.entry.record.created_at) >= policy.retention_days * DAY;
        if expired || (!expired_only && (count > policy.max_count || bytes > policy.max_bytes)) {
            count -= 1;
            bytes = bytes.saturating_sub(record.entry.bytes);
            candidates.push(Candidate {
                id: record.entry.record.id,
                fingerprint: record.fingerprint,
                bytes: record.entry.bytes,
            });
        }
    }
    Ok(Plan {
        bytes: candidates.iter().map(|r| r.bytes).sum(),
        candidates,
    })
}
pub fn expired_plan(vault: &Vault) -> Result<Plan> {
    plan_at(vault, now(), true)
}
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cleanup {
    pub deleted: usize,
    pub bytes: u64,
    pub warnings: Vec<String>,
}
fn execute(vault: &Vault, candidates: Vec<Candidate>, at: u64) -> Result<Cleanup> {
    let root = safe_root(vault)?;
    let mut result = Cleanup::default();
    for candidate in candidates {
        let attempt = (|| -> Result<()> {
            let current = inspect(&root, &candidate.id, at, false)?;
            if current.entry.protected
                || current.fingerprint != candidate.fingerprint
                || current.entry.bytes != candidate.bytes
            {
                return Err(Error::Conflict);
            }
            let dir = root.join(&candidate.id);
            // Validate backup content before deleting a completed, eligible record.
            let backup_bytes = fs::read(dir.join("backup.json"))?;
            let backups: Vec<Backup> =
                serde_json::from_slice(&backup_bytes).map_err(|e| Error::Probe(e.to_string()))?;
            if backups.iter().any(|b| hash(&b.content) != b.hash) {
                return Err(Error::Conflict);
            }
            // No recursive removal: unexpected files and nested directories can never be purged.
            fs::remove_file(dir.join("backup.json"))?;
            fs::remove_file(dir.join("record.json"))?;
            fs::remove_dir(dir)?;
            Ok(())
        })();
        match attempt {
            Ok(()) => {
                result.deleted += 1;
                result.bytes += candidate.bytes;
            }
            Err(_) => result.warnings.push(format!(
                "记录 {} 清理未完成，已停止处理此记录，请检查恢复目录。",
                candidate.id
            )),
        }
    }
    Ok(result)
}
pub fn automatic(vault: &Vault) -> Result<Cleanup> {
    let at = now();
    execute(vault, plan_at(vault, at, false)?.candidates, at)
}
// Re-evaluate eligibility but never add records beyond the user's confirmed preview.
pub fn clean_expired(vault: &Vault, confirmed: Vec<Candidate>) -> Result<Cleanup> {
    let at = now();
    let eligible = plan_at(vault, at, true)?;
    let ids: HashSet<_> = eligible.candidates.iter().map(|r| r.id.as_str()).collect();
    let candidates = confirmed
        .into_iter()
        .filter(|r| ids.contains(r.id.as_str()))
        .collect();
    execute(vault, candidates, at)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::operations;
    const AT: u64 = 2_000_000_000;
    fn fixture() -> (tempfile::TempDir, Vault) {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("vault");
        fs::create_dir(&root).unwrap();
        let vault = Vault::open(&root, &temp.path().join("recovery")).unwrap();
        (temp, vault)
    }
    fn record(vault: &Vault, age_days: u64, completed: bool) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        let dir = vault.recovery_dir().join("operations").join(&id);
        fs::create_dir_all(&dir).unwrap();
        let entry = Recovery {
            id: id.clone(),
            kind: "delete".into(),
            source: "note.md".into(),
            destination: None,
            completed,
            created_at: AT - age_days * DAY,
        };
        atomic_write(
            &dir.join("record.json"),
            &serde_json::to_vec(&entry).unwrap(),
        )
        .unwrap();
        let content = b"# backed up note".to_vec();
        let backups = vec![Backup {
            path: "note.md".into(),
            hash: hash(&content),
            content,
        }];
        atomic_write(
            &dir.join("backup.json"),
            &serde_json::to_vec(&backups).unwrap(),
        )
        .unwrap();
        id
    }
    fn exists(vault: &Vault, id: &str) -> bool {
        vault.recovery_dir().join("operations").join(id).exists()
    }
    #[test]
    fn expires_completed_records_but_preserves_recent_incomplete_drafts_and_git() {
        let (_temp, vault) = fixture();
        let expired = record(&vault, 31, true);
        let incomplete = record(&vault, 90, false);
        let recent = record(&vault, 0, true);
        fs::write(vault.recovery_dir().join("draft.md"), "unsaved draft").unwrap();
        fs::create_dir(vault.root().join(".git")).unwrap();
        fs::write(vault.root().join(".git/HEAD"), "test").unwrap();
        let result = execute(&vault, plan_at(&vault, AT, false).unwrap().candidates, AT).unwrap();
        assert_eq!(result.deleted, 1);
        assert!(!exists(&vault, &expired));
        assert!(exists(&vault, &incomplete));
        assert!(exists(&vault, &recent));
        assert_eq!(
            fs::read_to_string(vault.recovery_dir().join("draft.md")).unwrap(),
            "unsaved draft"
        );
        assert!(vault.root().join(".git/HEAD").exists());
    }
    #[test]
    fn count_limit_removes_oldest_first_and_recent_records_may_exceed_limit() {
        let (_temp, vault) = fixture();
        let oldest = record(&vault, 10, true);
        let middle = record(&vault, 4, true);
        record(&vault, 0, true);
        record(&vault, 0, true);
        save_policy(
            &vault,
            &Policy {
                max_count: 1,
                ..Policy::default()
            },
        )
        .unwrap();
        let plan = plan_at(&vault, AT, false).unwrap();
        assert_eq!(
            plan.candidates
                .iter()
                .map(|c| c.id.as_str())
                .collect::<Vec<_>>(),
            vec![oldest.as_str(), middle.as_str()]
        );
        execute(&vault, plan.candidates, AT).unwrap();
        let view = overview_at(&vault, AT).unwrap();
        assert_eq!(view.count, 2);
        assert!(view.over_limit);
        assert_eq!(view.protected_count, 2);
    }
    #[test]
    fn capacity_limit_uses_stored_backup_bytes_and_stops_when_within_budget() {
        let (_temp, vault) = fixture();
        let old = record(&vault, 3, true);
        let content = vec![b'x'; 400_000];
        let backup = vec![Backup {
            path: "large.md".into(),
            hash: hash(&content),
            content,
        }];
        fs::write(
            vault
                .recovery_dir()
                .join("operations")
                .join(&old)
                .join("backup.json"),
            serde_json::to_vec(&backup).unwrap(),
        )
        .unwrap();
        let newer = record(&vault, 2, true);
        save_policy(
            &vault,
            &Policy {
                max_bytes: MIB,
                ..Policy::default()
            },
        )
        .unwrap();
        let plan = plan_at(&vault, AT, false).unwrap();
        assert_eq!(plan.candidates.len(), 1);
        assert_eq!(plan.candidates[0].id, old);
        assert!(plan.bytes > MIB);
        execute(&vault, plan.candidates, AT).unwrap();
        assert!(exists(&vault, &newer));
        assert!(!overview_at(&vault, AT).unwrap().over_limit);
    }
    #[test]
    fn legacy_records_get_a_fresh_persisted_retention_period() {
        let (_temp, vault) = fixture();
        let id = record(&vault, 100, true);
        let path = vault
            .recovery_dir()
            .join("operations")
            .join(&id)
            .join("record.json");
        let mut value: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        value.as_object_mut().unwrap().remove("createdAt");
        fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
        assert!(plan_at(&vault, AT, false).unwrap().candidates.is_empty());
        let view = overview_at(&vault, AT + 2 * DAY).unwrap();
        assert_eq!(view.records[0].record.created_at, AT);
        assert!(plan_at(&vault, AT + 30 * DAY, false)
            .unwrap()
            .candidates
            .iter()
            .any(|c| c.id == id));
    }
    #[test]
    fn exact_24_hour_boundary_and_future_timestamps_are_protected() {
        let (_temp, vault) = fixture();
        let id = record(&vault, 0, true);
        save_policy(
            &vault,
            &Policy {
                retention_days: 1,
                ..Policy::default()
            },
        )
        .unwrap();
        assert!(plan_at(&vault, AT - DAY, false)
            .unwrap()
            .candidates
            .is_empty());
        assert!(plan_at(&vault, AT + DAY - 1, false)
            .unwrap()
            .candidates
            .is_empty());
        assert_eq!(
            plan_at(&vault, AT + DAY, false).unwrap().candidates[0].id,
            id
        );
    }
    #[test]
    fn manual_cleanup_never_adds_newly_expired_records_or_deletes_changed_records() {
        let (_temp, vault) = fixture();
        let now = now();
        let id = record(&vault, 31, true);
        let path = vault
            .recovery_dir()
            .join("operations")
            .join(&id)
            .join("record.json");
        let mut entry: Recovery = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        entry.created_at = now - 31 * DAY;
        fs::write(&path, serde_json::to_vec(&entry).unwrap()).unwrap();
        let plan = expired_plan(&vault).unwrap();
        assert_eq!(plan.candidates.len(), 1);
        let second = record(&vault, 32, true);
        let second_path = vault
            .recovery_dir()
            .join("operations")
            .join(&second)
            .join("record.json");
        let mut second_entry: Recovery =
            serde_json::from_slice(&fs::read(&second_path).unwrap()).unwrap();
        second_entry.created_at = now - 32 * DAY;
        fs::write(&second_path, serde_json::to_vec(&second_entry).unwrap()).unwrap();
        entry.completed = false;
        fs::write(&path, serde_json::to_vec(&entry).unwrap()).unwrap();
        assert_eq!(clean_expired(&vault, plan.candidates).unwrap().deleted, 0);
        assert!(exists(&vault, &id));
        assert!(exists(&vault, &second));
        let confirmed = expired_plan(&vault).unwrap();
        assert_eq!(
            clean_expired(&vault, confirmed.candidates).unwrap().deleted,
            1
        );
        assert!(exists(&vault, &id));
        assert!(!exists(&vault, &second));
    }
    #[test]
    fn corrupt_or_missing_backups_and_unexpected_files_are_preserved() {
        let (_temp, vault) = fixture();
        let corrupt = record(&vault, 60, true);
        let missing = record(&vault, 60, true);
        let unexpected = record(&vault, 60, true);
        let root = vault.recovery_dir().join("operations");
        fs::write(root.join(&corrupt).join("backup.json"), "invalid json").unwrap();
        fs::remove_file(root.join(&missing).join("backup.json")).unwrap();
        fs::write(root.join(&unexpected).join("keep.txt"), "keep").unwrap();
        let result = execute(&vault, plan_at(&vault, AT, false).unwrap().candidates, AT).unwrap();
        assert_eq!(result.deleted, 0);
        assert!(!result.warnings.is_empty());
        assert!(exists(&vault, &corrupt));
        assert!(exists(&vault, &missing));
        assert!(exists(&vault, &unexpected));
        assert_eq!(overview_at(&vault, AT).unwrap().count, 3);
    }
    #[test]
    fn policy_is_persistent_per_vault_and_restore_does_not_consume_backup() {
        let (_one, vault) = fixture();
        let (_two, other) = fixture();
        let custom = Policy {
            retention_days: 90,
            max_count: 42,
            max_bytes: 256 * MIB,
        };
        save_policy(&vault, &custom).unwrap();
        assert_eq!(policy(&vault).unwrap(), custom);
        assert_eq!(policy(&other).unwrap(), Policy::default());
        let id = record(&vault, 3, true);
        let output = operations::restore(&vault, &id).unwrap();
        assert!(vault.root().join(output).join("note.md").exists());
        assert!(exists(&vault, &id));
        assert!(save_policy(
            &vault,
            &Policy {
                retention_days: 0,
                ..custom
            }
        )
        .is_err());
    }
    #[test]
    fn file_operations_timestamp_backups_and_cleanup_preserves_immediate_restore() {
        let (_temp, vault) = fixture();
        operations::create(&vault, "original.md", false).unwrap();
        let moved = operations::move_entry(&vault, "original.md", "renamed.md").unwrap();
        let deleted = operations::remove(&vault, "renamed.md").unwrap();
        let view = overview(&vault).unwrap();
        assert_eq!(view.records.len(), 2);
        assert!(view
            .records
            .iter()
            .all(|r| r.record.created_at > 0 && r.protected));
        assert_eq!(automatic(&vault).unwrap().deleted, 0);
        assert!(exists(&vault, &moved));
        assert!(exists(&vault, &deleted));
        let restored = operations::restore(&vault, &deleted).unwrap();
        assert!(vault.root().join(restored).join("renamed.md").exists());
    }
    #[cfg(unix)]
    #[test]
    fn linked_backup_and_policy_files_are_rejected_without_touching_targets() {
        use std::os::unix::fs::symlink;
        let (temp, vault) = fixture();
        let id = record(&vault, 60, true);
        let backup = vault
            .recovery_dir()
            .join("operations")
            .join(&id)
            .join("backup.json");
        let outside = temp.path().join("outside.json");
        fs::write(&outside, "keep").unwrap();
        fs::remove_file(&backup).unwrap();
        symlink(&outside, &backup).unwrap();
        assert!(plan_at(&vault, AT, false).unwrap().candidates.is_empty());
        assert_eq!(fs::read_to_string(&outside).unwrap(), "keep");
        symlink(&outside, vault.recovery_dir().join("retention.json")).unwrap();
        assert!(policy(&vault).is_err());
        assert!(save_policy(&vault, &Policy::default()).is_err());
        assert_eq!(fs::read_to_string(&outside).unwrap(), "keep");
    }
    #[cfg(unix)]
    #[test]
    fn linked_records_and_linked_operations_root_cannot_delete_external_data() {
        use std::os::unix::fs::symlink;
        let (_temp, vault) = fixture();
        let (_external, other) = fixture();
        let external_id = record(&other, 60, true);
        let outside = other.recovery_dir().join("operations").join(&external_id);
        let root = vault.recovery_dir().join("operations");
        fs::create_dir(&root).unwrap();
        symlink(&outside, root.join(&external_id)).unwrap();
        assert!(plan_at(&vault, AT, false).unwrap().candidates.is_empty());
        assert!(outside.join("backup.json").exists());
        fs::remove_file(root.join(&external_id)).unwrap();
        fs::remove_dir(&root).unwrap();
        symlink(other.recovery_dir().join("operations"), &root).unwrap();
        assert!(plan_at(&vault, AT, false).is_err());
        assert!(outside.join("backup.json").exists());
    }
}
