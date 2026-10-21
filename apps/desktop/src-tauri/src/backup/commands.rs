//! Tauri commands of the backup subsystem (spec 4.11). None of them accepts a path.

use super::create::{blocking, create_backup};
use super::error::BackupError;
use super::list::{list_backups, BackupInfo, BackupOverview};
use super::names::BackupKind;
use super::sqlite::supported_schema_version;
use super::status::read_status;
use super::BackupState;
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
