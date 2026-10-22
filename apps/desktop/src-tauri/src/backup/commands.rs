//! Tauri commands of the backup subsystem (spec 4.11). None of them accepts a path.

use super::create::{blocking, create_backup};
use super::dialogs;
use super::error::BackupError;
use super::external::{export_archive_to, import_external, ArchiveSummary};
use super::list::{list_backups, BackupInfo, BackupOverview};
use super::names::{BackupKind, BackupName};
use super::restore::{stage_restore, stage_restore_external};
use super::sqlite::supported_schema_version;
use super::status::{acknowledge, read_status};
use super::BackupState;
use serde::Deserialize;
use std::fs;

#[tauri::command]
pub async fn backup_list(
    state: tauri::State<'_, BackupState>,
) -> Result<BackupOverview, BackupError> {
    let root = state.root.clone();
    let last_auto_error = state
        .last_auto_error
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or(None);
    blocking(move || BackupOverview {
        backups: list_backups(&root),
        status: read_status(&root, last_auto_error),
        supported_schema_version: supported_schema_version(),
    })
    .await
}

#[tauri::command]
pub async fn backup_create(
    state: tauri::State<'_, BackupState>,
) -> Result<BackupInfo, BackupError> {
    let _guard = state.try_acquire()?;
    create_backup(&state.root, state.clock.as_ref(), BackupKind::Manual, &[]).await
}

#[tauri::command]
pub async fn backup_open_folder(state: tauri::State<'_, BackupState>) -> Result<(), BackupError> {
    let dir = state.root.backups();
    blocking(move || -> Result<(), BackupError> {
        fs::create_dir_all(&dir)?;
        tauri_plugin_opener::open_path(&dir, None::<&str>).map_err(|e| {
            eprintln!("backup: cannot open the backups folder: {e}");
            BackupError::Io {
                code: "open_folder".into(),
            }
        })
    })
    .await?
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum RestoreSource {
    Internal {
        id: String,
    },
    /// The archive prepared by `backup_pick_external` (`.incoming\picked.zip`).
    External,
}

/// Stages the restoration, then restarts the application: the exchange itself happens at the
/// next startup (spec D6, 4.8, 4.11). The answer may never reach the front.
#[tauri::command]
pub async fn backup_restore<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, BackupState>,
    source: RestoreSource,
) -> Result<(), BackupError> {
    let guard = state.try_acquire()?;
    let (root, clock) = (state.root.clone(), state.clock.clone());
    // Detached task: the staging then runs to completion even if the caller goes away.
    let staging = match source {
        RestoreSource::Internal { id } => {
            if BackupName::parse(&id).is_none() {
                return Err(BackupError::InvalidId);
            }
            let archive = state.root.backups().join(&id);
            let exists = {
                let archive = archive.clone();
                blocking(move || archive.is_file()).await?
            };
            if !exists {
                return Err(BackupError::NotFound);
            }
            tauri::async_runtime::spawn(async move {
                stage_restore(root, clock, archive, vec![id]).await
            })
        }
        RestoreSource::External => {
            tauri::async_runtime::spawn(async move { stage_restore_external(root, clock).await })
        }
    };
    staging.await.map_err(|_| BackupError::Io {
        code: "join".into(),
    })??;
    // From here on every other backup operation is refused, then the lock is released.
    state.mark_restart_pending();
    drop(guard);
    app.request_restart();
    Ok(())
}

/// Save dialog (no lock), then a copy to the chosen place. `false` when the dialog is cancelled.
#[tauri::command]
pub async fn backup_export<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, BackupState>,
    id: String,
) -> Result<bool, BackupError> {
    if BackupName::parse(&id).is_none() {
        return Err(BackupError::InvalidId);
    }
    let source = state.root.backups().join(&id);
    let exists = {
        let source = source.clone();
        blocking(move || source.is_file()).await?
    };
    if !exists {
        return Err(BackupError::NotFound);
    }
    let suggested = id;
    let Some(dest) = blocking(move || dialogs::save_archive(&app, &suggested)).await? else {
        return Ok(false);
    };
    blocking(move || export_archive_to(&source, &dest)).await??;
    Ok(true)
}

/// Open dialog without the lock; only afterwards the lock is taken, the file is copied to a
/// private place and fully validated. `None` when the dialog is cancelled.
#[tauri::command]
pub async fn backup_pick_external<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, BackupState>,
) -> Result<Option<ArchiveSummary>, BackupError> {
    let Some(picked) = blocking(move || dialogs::pick_archive(&app)).await? else {
        return Ok(None);
    };
    let _guard = state.try_acquire()?;
    import_external(&state.root, &picked).await.map(Some)
}

/// Removes `last-restore`, `db-missing` and `pre-migration-failed`.
#[tauri::command]
pub async fn backup_acknowledge(state: tauri::State<'_, BackupState>) -> Result<(), BackupError> {
    let root = state.root.clone();
    blocking(move || acknowledge(&root)).await??;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::RestoreSource;

    #[test]
    fn restore_source_rejects_unknown_fields() {
        assert!(matches!(
            serde_json::from_str::<RestoreSource>(r#"{"kind":"internal","id":"x"}"#),
            Ok(RestoreSource::Internal { .. })
        ));
        assert!(matches!(
            serde_json::from_str::<RestoreSource>(r#"{"kind":"external"}"#),
            Ok(RestoreSource::External)
        ));
        for bad in [
            r#"{"kind":"internal","id":"x","path":"C:\x.zip"}"#,
            r#"{"kind":"external","path":"C:\x.zip"}"#,
        ] {
            assert!(serde_json::from_str::<RestoreSource>(bad).is_err(), "{bad}");
        }
    }
}
