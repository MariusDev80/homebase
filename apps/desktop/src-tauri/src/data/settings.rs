//! Settings commands (spec typed-data-commands 4.5.1). The values are JSON texts stored as they
//! arrive (byte for byte); Rust never parses them: the `CHECK` of V1 is the filter.

use super::error::DataError;
use super::{validate, DataCtx, MAX_SETTINGS};
use crate::backup::BackupState;
use serde::Serialize;
use sqlx::Connection;
use tauri::State;

const SELECT_VALUE_SQL: &str = "SELECT value FROM settings WHERE key = ?1";
const SELECT_ALL_SQL: &str = "SELECT key, value FROM settings ORDER BY key";
const EXISTS_SQL: &str = "SELECT EXISTS (SELECT 1 FROM settings WHERE key = ?1)";
const COUNT_SQL: &str = "SELECT COUNT(*) FROM settings";
const UPSERT_SQL: &str = "INSERT INTO settings (key, value, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?3)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at";
const DELETE_SQL: &str = "DELETE FROM settings WHERE key = ?1";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingDto {
    pub key: String,
    pub value_json: String,
}

/// A key outside the shape matches nothing: `None`.
pub(crate) async fn get_setting(ctx: &DataCtx, key: &str) -> Result<Option<String>, DataError> {
    with_conn!(ctx, conn => {
        Ok(sqlx::query_scalar::<_, String>(SELECT_VALUE_SQL)
            .bind(key)
            .fetch_optional(&mut conn)
            .await?)
    })
}

pub(crate) async fn list_settings(ctx: &DataCtx) -> Result<Vec<SettingDto>, DataError> {
    with_conn!(ctx, conn => {
        let rows = sqlx::query_as::<_, (String, String)>(SELECT_ALL_SQL)
            .fetch_all(&mut conn)
            .await?;
        Ok(rows
            .into_iter()
            .map(|(key, value_json)| SettingDto { key, value_json })
            .collect())
    })
}

/// Upsert; `created_at` is kept on an existing key. A new key past [`MAX_SETTINGS`] is refused.
pub(crate) async fn set_setting(
    ctx: &DataCtx,
    key: &str,
    value_json: &str,
) -> Result<(), DataError> {
    ctx.ensure_writable()?;
    validate::setting_key_for_write(key)?;
    validate::json_text(value_json, "valueJson")?;
    let now = ctx.now();
    with_conn!(ctx, conn => {
        let mut tx = conn.begin_with("BEGIN IMMEDIATE").await?;
        let existed = sqlx::query_scalar::<_, bool>(EXISTS_SQL)
            .bind(key)
            .fetch_one(&mut *tx)
            .await?;
        sqlx::query(UPSERT_SQL)
            .bind(key)
            .bind(value_json)
            .bind(&now)
            .execute(&mut *tx)
            .await?;
        if !existed {
            let count = sqlx::query_scalar::<_, i64>(COUNT_SQL)
                .fetch_one(&mut *tx)
                .await?;
            if count > MAX_SETTINGS {
                tx.rollback().await?;
                return Err(DataError::LimitReached);
            }
        }
        tx.commit().await?;
        Ok(())
    })
}

/// `true` if a row was removed; a key outside the shape matches nothing.
pub(crate) async fn delete_setting(ctx: &DataCtx, key: &str) -> Result<bool, DataError> {
    ctx.ensure_writable()?;
    with_conn!(ctx, conn => {
        let result = sqlx::query(DELETE_SQL).bind(key).execute(&mut conn).await?;
        Ok(result.rows_affected() > 0)
    })
}

#[tauri::command]
pub async fn setting_get(
    backup: State<'_, BackupState>,
    key: String,
) -> Result<Option<String>, DataError> {
    get_setting(&DataCtx::from_backup(&backup), &key).await
}

#[tauri::command]
pub async fn setting_list(backup: State<'_, BackupState>) -> Result<Vec<SettingDto>, DataError> {
    list_settings(&DataCtx::from_backup(&backup)).await
}

#[tauri::command]
pub async fn setting_set(
    backup: State<'_, BackupState>,
    key: String,
    value_json: String,
) -> Result<(), DataError> {
    set_setting(&DataCtx::from_backup(&backup), &key, &value_json).await
}

#[tauri::command]
pub async fn setting_delete(
    backup: State<'_, BackupState>,
    key: String,
) -> Result<bool, DataError> {
    delete_setting(&DataCtx::from_backup(&backup), &key).await
}
