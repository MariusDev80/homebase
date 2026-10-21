//! Tauri commands of the backup subsystem (spec 4.11). None of them accepts a path.

use super::create::{blocking, create_backup};
use super::error::BackupError;
use super::list::{list_backups, BackupInfo, BackupOverview};
use super::names::{BackupKind, BackupName};
use super::restore::stage_restore;
use super::sqlite::supported_schema_version;
use super::status::read_status;
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
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum RestoreSource {
    Internal {
        id: String,
    },
    /// Lot B3.
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
    let id = match source {
        RestoreSource::Internal { id } => id,
        RestoreSource::External => {
            return Err(BackupError::Io {
                code: "unsupported".into(),
            })
        }
    };
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
    // Detached task: the staging then runs to completion even if the caller goes away.
    let (root, clock) = (state.root.clone(), state.clock.clone());
    tauri::async_runtime::spawn(async move { stage_restore(root, clock, archive, vec![id]).await })
        .await
        .map_err(|_| BackupError::Io {
            code: "join".into(),
        })??;
    // From here on every other backup operation is refused, then the lock is released.
    state.mark_restart_pending();
    drop(guard);
    app.request_restart();
    Ok(())
}
