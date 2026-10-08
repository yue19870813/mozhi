use crate::*;
use base64::Engine;
use mozhi_core::{knowledge, operations, recovery, sync};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::Emitter;

struct SyncGuard(AppState);
impl Drop for SyncGuard {
    fn drop(&mut self) {
        self.0 .1.store(false, std::sync::atomic::Ordering::SeqCst);
    }
}

#[cfg(test)]
mod sync_tests {
    use super::*;
    #[test]
    fn reads_remain_available_while_sync_blocks_writes_and_guard_resets() {
        let root = tempfile::tempdir().unwrap();
        let private = tempfile::tempdir().unwrap();
        fs::write(root.path().join("note.md"), "original").unwrap();
        let state = AppState::default();
        *state.0.lock().unwrap() = Some(Active {
            demo: false,
            vault: Vault::open(root.path(), private.path()).unwrap(),
            index: SearchIndex::open(&private.path().join("index.db")).unwrap(),
            id: "test".into(),
            private: private.path().to_path_buf(),
            _watcher: None,
            recovery_warnings: vec![],
        });
        state.1.store(true, std::sync::atomic::Ordering::SeqCst);
        let guard = SyncGuard(state.clone());
        assert!(with_access(&state, true, |a| Ok(a.vault.read("note.md")?)).is_ok());
        assert!(with_active(&state, |_| Ok(())).is_err());
        drop(guard);
        assert!(with_active(&state, |_| Ok(())).is_ok());
        let lock = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(private.path().join("sync.lock"))
            .unwrap();
        fs2::FileExt::lock_exclusive(&lock).unwrap();
        assert!(with_active(&state, |_| Ok(())).is_err());
        assert!(with_access(&state, true, |_| Ok(())).is_ok());
        fs2::FileExt::unlock(&lock).unwrap();
        assert!(with_active(&state, |_| Ok(())).is_ok());
        let vault_lock = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(private.path().join("vault.lock"))
            .unwrap();
        fs2::FileExt::lock_exclusive(&vault_lock).unwrap();
        let reader_state = state.clone();
        let (send, receive) = std::sync::mpsc::channel();
        let reader = std::thread::spawn(move || {
            send.send(with_access(&reader_state, true, |a| Ok(a.vault.read("note.md")?)).is_ok())
                .unwrap();
        });
        assert!(matches!(
            receive.recv_timeout(std::time::Duration::from_millis(30)),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout)
        ));
        fs2::FileExt::unlock(&vault_lock).unwrap();
        assert!(receive
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap());
        reader.join().unwrap();
    }
}
fn background_sync(app: &tauri::AppHandle, state: &AppState, vault_id: &str) -> ApiResult<Value> {
    let (root, private, config, token) = with_active(state, |active| {
        identity(active, vault_id)?;
        let config = config(active)?;
        config.validate()?;
        let token = if config.protocol == "ssh" {
            String::new()
        } else {
            credentials::get(&config)?
        };
        state.1.store(true, std::sync::atomic::Ordering::SeqCst);
        Ok((
            active.vault.root().to_path_buf(),
            active.private.clone(),
            config,
            token,
        ))
    })?;
    let _guard = SyncGuard(state.clone());
    let sync_lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(private.join("sync.lock"))
        .map_err(failure)?;
    fs2::FileExt::try_lock_exclusive(&sync_lock)
        .map_err(|_| failure("笔记库正在另一个窗口同步"))?;
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(private.join("vault.lock"))
        .map_err(failure)?;
    fs2::FileExt::lock_exclusive(&lock).map_err(failure)?;
    let mut locked = true;
    let mut sequence = 0u64;
    let task_id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
        .to_string();
    let result = sync::synchronize_guarded(&root, &private, &config, &token, |phase| {
        if matches!(phase, "fetching" | "pushing") {
            if locked {
                fs2::FileExt::unlock(&lock)?;
                locked = false;
            }
        } else if !locked {
            fs2::FileExt::lock_exclusive(&lock)?;
            locked = true;
        }
        sequence += 1;
        let _ = app.emit(
            "sync_state_changed",
            json!({"vaultId":vault_id,"taskId":task_id,"sequence":sequence,"phase":phase}),
        );
        Ok(())
    });
    if locked {
        fs2::FileExt::unlock(&lock).map_err(failure)?;
    }
    let refreshed = with_access(state, true, |active| {
        identity(active, vault_id)?;
        refresh(active)
    });
    Ok(json!({"state":result?,"vault":refreshed?}))
}

pub(super) fn automatic_recovery_cleanup(vault: &Vault) -> Vec<String> {
    match recovery::automatic(vault) {
        Ok(result) => result.warnings,
        Err(error) => vec![format!("恢复记录自动清理未完成：{error}")],
    }
}
fn recovery_overview(active: &Active) -> ApiResult<Value> {
    let mut overview = recovery::overview(&active.vault)?;
    overview.warnings.extend(active.recovery_warnings.clone());
    Ok(json!(overview))
}
pub(super) fn identity(active: &Active, id: &str) -> ApiResult<()> {
    if active.id != id {
        Err(failure("笔记库已切换，请丢弃过期请求"))
    } else {
        Ok(())
    }
}
fn config(active: &Active) -> ApiResult<sync::Config> {
    let bytes = fs::read(active.private.join("git-config.json"))
        .map_err(|_| failure("请先配置 HTTPS 仓库与固定分支"))?;
    serde_json::from_slice(&bytes).map_err(failure)
}
fn refresh(active: &mut Active) -> ApiResult<Value> {
    let entries = active.vault.list()?;
    if entries.len() > 10000 {
        return Err(failure("当前最多支持 10000 篇笔记"));
    }
    let mut notes = vec![];
    let mut skipped = vec![];
    for e in &entries {
        match active.vault.read(&e.path) {
            Ok(n) => notes.push((n.path, n.content)),
            Err(_) => skipped.push(e.path.clone()),
        }
    }
    active.index.reconcile(&notes)?;
    Ok(
        json!({"id":active.id,"name":active.vault.root().file_name().unwrap_or_default().to_string_lossy(),"demo":active.demo,"entries":entries,"skipped":skipped}),
    )
}
#[derive(Deserialize)]
#[serde(
    tag = "action",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum Request {
    Refresh,
    Fingerprint,
    Tree,
    OpenDirectory {
        path: String,
    },
    Knowledge,
    Create {
        path: String,
        directory: bool,
    },
    Move {
        from: String,
        to: String,
    },
    Delete {
        path: String,
    },
    Recoveries,
    RecoveryOverview,
    RecoveryConfigure {
        policy: recovery::Policy,
    },
    RecoveryPreview,
    RecoveryClean {
        candidates: Vec<recovery::Candidate>,
    },
    Restore {
        id: String,
    },
    Search {
        query: String,
        directory: String,
        tag: String,
        filename_only: bool,
    },
    Graph {
        query: knowledge::GraphQuery,
    },
    ImportImage,
    Attachment {
        path: String,
    },
    Export,
    Config,
    Configure {
        config: sync::Config,
    },
    Sync,
    SyncState,
    Resolve {
        decisions: Vec<sync::Decision>,
    },
    History {
        path: String,
    },
    Version {
        path: String,
        id: String,
    },
    ExportPng {
        data: String,
    },
}
#[tauri::command]
pub async fn workspace(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    vault_id: String,
    request: Request,
) -> ApiResult<Value> {
    let state = state.inner().clone();
    if matches!(&request, Request::Sync) {
        return blocking(move || background_sync(&app, &state, &vault_id)).await;
    }
    let read = matches!(
        &request,
        Request::Tree
            | Request::Knowledge
            | Request::Search { .. }
            | Request::Graph { .. }
            | Request::Attachment { .. }
            | Request::Config
            | Request::SyncState
            | Request::History { .. }
            | Request::Version { .. }
    );
    blocking(move || {
        with_access(&state, read, |active| {
            identity(active, &vault_id)?;
            if active.private.join("sync-pending.json").exists()
                && matches!(
                    &request,
                    Request::Create { .. }
                        | Request::Move { .. }
                        | Request::Delete { .. }
                        | Request::ImportImage
                        | Request::Restore { .. }
                )
            {
                return Err(failure("先处理未完成的同步或冲突后再修改文件"));
            }
            match request {
                Request::Refresh => refresh(active),
                Request::Fingerprint => {
                    let mut fingerprint = String::new();
                    for e in operations::tree(&active.vault)? {
                        let meta =
                            fs::metadata(active.vault.root().join(&e.path)).map_err(failure)?;
                        fingerprint.push_str(&format!(
                            "{}:{}:{:?};",
                            e.path,
                            meta.len(),
                            meta.modified().ok()
                        ));
                    }
                    Ok(json!(vault::hash(fingerprint.as_bytes())))
                }
                Request::Tree => Ok(json!(operations::tree(&active.vault)?)),
                Request::OpenDirectory { path } => {
                    let directory =
                        crate::file_manager::directory_for_entry(active.vault.root(), &path)?;
                    crate::file_manager::open_directory(&directory).map_err(failure)?;
                    Ok(Value::Null)
                }
                Request::Knowledge => Ok(json!(active.index.knowledge()?)),
                Request::Create { path, directory } => {
                    operations::create(&active.vault, &path, directory)?;
                    refresh(active)
                }
                Request::Move { from, to } => {
                    let recovery_id = operations::move_entry(&active.vault, &from, &to)?;
                    active.recovery_warnings = automatic_recovery_cleanup(&active.vault);
                    let vault = refresh(active)?;
                    Ok(json!({"vault":vault,"recoveryId":recovery_id}))
                }
                Request::Delete { path } => {
                    let recovery_id = operations::remove(&active.vault, &path)?;
                    active.recovery_warnings = automatic_recovery_cleanup(&active.vault);
                    let vault = refresh(active)?;
                    Ok(json!({"vault":vault,"recoveryId":recovery_id}))
                }
                Request::Recoveries => Ok(json!(operations::recoveries(&active.vault)?)),
                Request::RecoveryOverview => recovery_overview(active),
                Request::RecoveryConfigure { policy } => {
                    recovery::save_policy(&active.vault, &policy)?;
                    active.recovery_warnings = automatic_recovery_cleanup(&active.vault);
                    recovery_overview(active)
                }
                Request::RecoveryPreview => Ok(json!(recovery::expired_plan(&active.vault)?)),
                Request::RecoveryClean { candidates } => {
                    let result = recovery::clean_expired(&active.vault, candidates)?;
                    active.recovery_warnings = result.warnings.clone();
                    Ok(json!({"cleanup":result,"overview":recovery_overview(active)?}))
                }
                Request::Restore { id } => {
                    let path = operations::restore(&active.vault, &id)?;
                    let vault = refresh(active)?;
                    Ok(json!({"path":path,"vault":vault}))
                }
                Request::Search {
                    query,
                    directory,
                    tag,
                    filename_only,
                } => Ok(json!(active.index.query_filtered(
                    &query,
                    &directory,
                    &tag,
                    filename_only
                )?)),
                Request::Graph { query } => {
                    Ok(json!(knowledge::graph(&active.index.knowledge()?, &query)))
                }
                Request::ImportImage => {
                    let Some(path) = app
                        .dialog()
                        .file()
                        .add_filter(
                            crate::language::text("图片", "Images", "画像"),
                            &["png", "jpg", "jpeg", "gif", "webp"],
                        )
                        .blocking_pick_file()
                    else {
                        return Ok(Value::Null);
                    };
                    let path = path.into_path().map_err(failure)?;
                    Ok(json!(operations::import_image(&active.vault, &path)?))
                }
                Request::Attachment { path } => {
                    let (mime, bytes) = operations::attachment(&active.vault, &path)?;
                    Ok(json!(format!(
                        "data:{mime};base64,{}",
                        base64::engine::general_purpose::STANDARD.encode(bytes)
                    )))
                }
                Request::Export => {
                    let Some(path) = app
                        .dialog()
                        .file()
                        .set_file_name("墨知笔记.zip")
                        .blocking_save_file()
                    else {
                        return Ok(Value::Null);
                    };
                    operations::export(&active.vault, &path.into_path().map_err(failure)?)?;
                    Ok(json!(true))
                }
                Request::Config => Ok(json!(config(active).ok())),
                Request::Configure { config } => {
                    config.validate()?;
                    vault::atomic_write(
                        &active.private.join("git-config.json"),
                        &serde_json::to_vec(&config).unwrap(),
                    )?;
                    Ok(json!(true))
                }
                Request::SyncState => Ok(json!(sync::state(&active.private)?)),
                Request::Sync => Err(failure("同步请求应通过后台任务执行")),
                Request::Resolve { decisions } => {
                    let state =
                        sync::resolve_conflicts(active.vault.root(), &active.private, &decisions)?;
                    let vault = refresh(active)?;
                    Ok(json!({"state":state,"vault":vault}))
                }
                Request::History { path } => Ok(json!(sync::history(active.vault.root(), &path)?)),
                Request::Version { path, id } => {
                    Ok(json!(sync::version(active.vault.root(), &path, &id)?))
                }
                Request::ExportPng { data } => {
                    if data.len() > 32 * 1024 * 1024 {
                        return Err(failure("导出图片过大"));
                    }
                    let bytes = base64::engine::general_purpose::STANDARD
                        .decode(
                            data.strip_prefix("data:image/png;base64,")
                                .ok_or_else(|| failure("图片格式无效"))?,
                        )
                        .map_err(failure)?;
                    let Some(path) = app
                        .dialog()
                        .file()
                        .set_file_name("墨知图谱.png")
                        .blocking_save_file()
                    else {
                        return Ok(Value::Null);
                    };
                    let path = path.into_path().map_err(failure)?;
                    let parent = path
                        .parent()
                        .ok_or_else(|| failure("导出路径无效"))?
                        .canonicalize()
                        .map_err(failure)?;
                    let path =
                        parent.join(path.file_name().ok_or_else(|| failure("导出路径无效"))?);
                    if path.starts_with(active.vault.root()) {
                        return Err(failure("图谱图片请保存到库外"));
                    }
                    let mut file = fs::OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(path)
                        .map_err(failure)?;
                    use std::io::Write;
                    file.write_all(&bytes).map_err(failure)?;
                    file.sync_all().map_err(failure)?;
                    Ok(json!(true))
                }
            }
        })
    })
    .await
}
#[tauri::command]
pub async fn set_credentials(app: tauri::AppHandle, config: sync::Config) -> ApiResult<bool> {
    config.validate()?;
    let (send, receive) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = send.send(credentials::prompt(&config));
    })
    .map_err(failure)?;
    blocking(move || receive.recv().map_err(failure)?).await
}
#[tauri::command]
pub async fn clone_vault(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    config: sync::Config,
    name: String,
) -> ApiResult<Option<OpenedVault>> {
    config.validate()?;
    let state = state.inner().clone();
    blocking(move || {
        let Some(parent) = app
            .dialog()
            .file()
            .set_title(crate::language::text(
                "选择新笔记库的父目录",
                "Choose parent folder for new vault",
                "新しい保管庫の親フォルダーを選択",
            ))
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        let parent = parent
            .into_path()
            .map_err(failure)?
            .canonicalize()
            .map_err(failure)?;
        if name.contains('/') {
            return Err(failure("请输入单个目录名称"));
        }
        let destination = operations::checked(&parent, &name, false)?;
        let token = if config.protocol == "ssh" {
            String::new()
        } else {
            credentials::get(&config)?
        };
        sync::clone(&config, &token, &destination)?;
        let opened = activate(&app, &state, destination)?;
        with_active(&state, |active| {
            vault::atomic_write(
                &active.private.join("git-config.json"),
                &serde_json::to_vec(&config).unwrap(),
            )?;
            Ok(())
        })?;
        Ok(Some(opened))
    })
    .await
}
