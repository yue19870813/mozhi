use crate::*;
use serde::Deserialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    id: String,
    name: String,
    path: String,
    demo: bool,
    available: bool,
}
fn roots(data: &std::path::Path) -> Vec<String> {
    let mut roots: Vec<String> = fs::read(data.join("vault-history.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    if let Some(last) = fs::read(data.join("last-vault.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<String>(&bytes).ok())
    {
        if !roots.contains(&last) {
            roots.push(last);
        }
    }
    let mut seen = std::collections::HashSet::new();
    roots.retain(|root| std::path::Path::new(root).is_absolute() && seen.insert(root.clone()));
    roots.truncate(20);
    roots
}
pub(super) fn remember(data: &std::path::Path, root: &str) -> ApiResult<()> {
    let mut entries = roots(data);
    entries.retain(|entry| entry != root);
    entries.insert(0, root.to_owned());
    entries.truncate(20);
    vault::atomic_write(
        &data.join("vault-history.json"),
        &serde_json::to_vec(&entries).map_err(failure)?,
    )?;
    Ok(())
}
fn catalog(data: &std::path::Path) -> Vec<Entry> {
    let demo_root = data.join("墨知示例笔记");
    let demo = demo_root
        .canonicalize()
        .unwrap_or(demo_root)
        .to_string_lossy()
        .to_string();
    let mut paths = roots(data);
    paths.retain(|root| root != &demo);
    paths.insert(0, demo.clone());
    paths
        .into_iter()
        .map(|path| Entry {
            id: vault::hash(path.as_bytes()),
            name: std::path::Path::new(&path)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string(),
            demo: path == demo,
            available: path == demo || std::path::Path::new(&path).is_dir(),
            path,
        })
        .collect()
}
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum Request {
    List,
    Open { id: String },
    Forget { id: String },
}
fn forget(data: &std::path::Path, id: &str) -> ApiResult<()> {
    let entry = catalog(data)
        .into_iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| failure("笔记库记录已失效"))?;
    if entry.demo {
        return Err(failure("演示笔记库保留为固定入口"));
    }
    let paths: Vec<_> = roots(data)
        .into_iter()
        .filter(|path| path != &entry.path)
        .collect();
    let last: Option<String> = fs::read(data.join("last-vault.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok());
    if last.as_ref() == Some(&entry.path) {
        vault::atomic_write(&data.join("last-vault.json"), b"null")?;
    }
    vault::atomic_write(
        &data.join("vault-history.json"),
        &serde_json::to_vec(&paths).map_err(failure)?,
    )?;
    Ok(())
}

#[tauri::command]
pub async fn vault_catalog(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    request: Request,
) -> ApiResult<serde_json::Value> {
    let state = state.inner().clone();
    blocking(move || {
        let data = app.path().app_data_dir().map_err(failure)?;
        match request {
            Request::List => {
                let _guard = state.0.lock().map_err(failure)?;
                Ok(serde_json::json!(catalog(&data)))
            }
            Request::Open { id } => {
                let guard = state.0.lock().map_err(failure)?;
                if state.1.load(std::sync::atomic::Ordering::SeqCst) {
                    return Err(failure("请等待同步完成后切换笔记库"));
                }
                let entry = catalog(&data)
                    .into_iter()
                    .find(|entry| entry.id == id)
                    .ok_or_else(|| failure("笔记库记录已失效，请重新选择目录"))?;
                let root = if entry.demo {
                    demo_root(&app)?
                } else {
                    PathBuf::from(entry.path)
                };
                if !root.is_dir() {
                    return Err(failure("笔记库目录不存在或无法访问，请重新选择目录"));
                }
                drop(guard);
                Ok(serde_json::json!(activate(&app, &state, root)?))
            }
            Request::Forget { id } => {
                let _guard = state.0.lock().map_err(failure)?;
                forget(&data, &id)?;
                Ok(serde_json::Value::Null)
            }
        }
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn removing_history_preserves_notes_and_demo_and_migrates_last_vault() {
        let data = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("note.md"), "preserved").unwrap();
        let path = root.path().to_string_lossy().to_string();
        fs::write(
            data.path().join("last-vault.json"),
            serde_json::to_vec(&path).unwrap(),
        )
        .unwrap();
        assert_eq!(catalog(data.path()).len(), 2);
        let id = vault::hash(path.as_bytes());
        forget(data.path(), &id).ok().unwrap();
        assert_eq!(catalog(data.path()).len(), 1);
        assert_eq!(
            fs::read_to_string(root.path().join("note.md")).unwrap(),
            "preserved"
        );
        assert!(forget(data.path(), &catalog(data.path())[0].id).is_err());
        assert!(forget(data.path(), "unknown").is_err());
    }
    #[test]
    fn history_is_persistent_deduplicated_bounded_and_keeps_demo() {
        let data = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let path = root.path().to_string_lossy().to_string();
        remember(data.path(), &path).ok().unwrap();
        remember(data.path(), &path).ok().unwrap();
        assert_eq!(roots(data.path()), vec![path.clone()]);
        let list = catalog(data.path());
        assert!(list[0].demo && list[0].available);
        assert!(list[1].available);
        drop(root);
        assert!(!catalog(data.path())[1].available);
        for i in 0..25 {
            remember(
                data.path(),
                &data.path().join(format!("{i}")).to_string_lossy(),
            )
            .ok()
            .unwrap();
        }
        assert_eq!(roots(data.path()).len(), 20);
        assert_eq!(catalog(data.path()).len(), 21);
        fs::write(data.path().join("vault-history.json"), "broken").unwrap();
        assert_eq!(catalog(data.path()).len(), 1);
    }
}
