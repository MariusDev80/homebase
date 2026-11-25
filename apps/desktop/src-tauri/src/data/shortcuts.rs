//! Shortcut commands (spec typed-data-commands 4.5.5). Label and URL are bounded and checked
//! (`http(s)://` only) by Rust before the disk; the `CHECK` of V2 is the safety net.

use super::error::DataError;
use super::search::{like_contains, valid_search};
use super::{validate, DataCtx};
use crate::backup::BackupState;
use serde::{Deserialize, Serialize};
use sqlx::SqliteConnection;
use tauri::State;

const SELECT_ONE_SQL: &str =
    "SELECT id, label, url, sort_order, created_at, updated_at FROM shortcuts WHERE id = ?1";
const SELECT_ALL_SQL: &str = "SELECT id, label, url, sort_order, created_at, updated_at
       FROM shortcuts ORDER BY sort_order, created_at, id";
const INSERT_SQL: &str =
    "INSERT INTO shortcuts (id, label, url, sort_order, created_at, updated_at)
       SELECT ?1, ?2, ?3, COALESCE(MAX(sort_order) + 1, 0), ?4, ?4 FROM shortcuts";
const UPDATE_SQL: &str = "UPDATE shortcuts SET label = ?2, url = ?3, updated_at = ?4 WHERE id = ?1";
const DELETE_SQL: &str = "DELETE FROM shortcuts WHERE id = ?1";
/// One statement; only the rows whose position changes are written. The JSON payload is the
/// serialization (by Rust) of the received ids, bound as a parameter.
const REORDER_SQL: &str = "UPDATE shortcuts
SET sort_order = j.pos, updated_at = ?2
FROM (SELECT CAST(key AS INTEGER) AS pos, value AS id FROM json_each(?1)) AS j
WHERE shortcuts.id = j.id AND shortcuts.sort_order <> j.pos";
const SEARCH_SQL: &str = "SELECT id, label, url, sort_order, created_at, updated_at FROM shortcuts
       WHERE label LIKE ?1 ESCAPE '\\' OR url LIKE ?1 ESCAPE '\\'
       ORDER BY (label LIKE ?1 ESCAPE '\\') DESC, sort_order, created_at, id
       LIMIT ?2";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShortcutNewDto {
    pub id: String,
    pub label: String,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutDto {
    pub id: String,
    pub label: String,
    pub url: String,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

type Row = (String, String, String, i64, String, String);

fn to_dto(row: Row) -> ShortcutDto {
    ShortcutDto {
        id: row.0,
        label: row.1,
        url: row.2,
        sort_order: row.3,
        created_at: row.4,
        updated_at: row.5,
    }
}

async fn fetch(conn: &mut SqliteConnection, id: &str) -> Result<Option<ShortcutDto>, DataError> {
    let row = sqlx::query_as::<_, Row>(SELECT_ONE_SQL)
        .bind(id)
        .fetch_optional(conn)
        .await?;
    Ok(row.map(to_dto))
}

pub(crate) async fn list_shortcuts(ctx: &DataCtx) -> Result<Vec<ShortcutDto>, DataError> {
    with_conn!(ctx, conn => {
        let rows = sqlx::query_as::<_, Row>(SELECT_ALL_SQL)
            .fetch_all(&mut conn)
            .await?;
        Ok(rows.into_iter().map(to_dto).collect())
    })
}

/// Appended at `MAX(sort_order) + 1`; the label is stored trimmed.
pub(crate) async fn create_shortcut(
    ctx: &DataCtx,
    input: &ShortcutNewDto,
) -> Result<ShortcutDto, DataError> {
    ctx.ensure_writable()?;
    validate::new_id(&input.id)?;
    let label = validate::shortcut_label(&input.label)?;
    validate::shortcut_url(&input.url)?;
    let now = ctx.now();
    with_conn!(ctx, conn => {
        sqlx::query(INSERT_SQL)
            .bind(&input.id)
            .bind(label)
            .bind(&input.url)
            .bind(&now)
            .execute(&mut conn)
            .await?;
        fetch(&mut conn, &input.id).await?.ok_or(DataError::NotFound)
    })
}

pub(crate) async fn update_shortcut(
    ctx: &DataCtx,
    id: &str,
    label: &str,
    url: &str,
) -> Result<ShortcutDto, DataError> {
    ctx.ensure_writable()?;
    let label = validate::shortcut_label(label)?;
    validate::shortcut_url(url)?;
    let now = ctx.now();
    with_conn!(ctx, conn => {
        let result = sqlx::query(UPDATE_SQL)
            .bind(id)
            .bind(label)
            .bind(url)
            .bind(&now)
            .execute(&mut conn)
            .await?;
        if result.rows_affected() == 0 {
            return Err(DataError::NotFound);
        }
        fetch(&mut conn, id).await?.ok_or(DataError::NotFound)
    })
}

/// `true` if a row was removed.
pub(crate) async fn delete_shortcut(ctx: &DataCtx, id: &str) -> Result<bool, DataError> {
    ctx.ensure_writable()?;
    with_conn!(ctx, conn => {
        let result = sqlx::query(DELETE_SQL).bind(id).execute(&mut conn).await?;
        Ok(result.rows_affected() > 0)
    })
}

/// Position `i` for the id at index `i`. An empty batch does nothing (no disk access); unknown
/// ids are ignored.
pub(crate) async fn reorder_shortcuts(ctx: &DataCtx, ids: &[String]) -> Result<(), DataError> {
    ctx.ensure_writable()?;
    if ids.is_empty() {
        return Ok(());
    }
    validate::batch_len(ids.len(), "ids")?;
    validate::id_sizes(ids.iter().map(String::as_str), "ids")?;
    validate::distinct(ids.iter().map(String::as_str), "ids")?;
    let payload = serde_json::to_string(ids).map_err(|_| DataError::Database)?;
    let now = ctx.now();
    with_conn!(ctx, conn => {
        sqlx::query(REORDER_SQL)
            .bind(&payload)
            .bind(&now)
            .execute(&mut conn)
            .await?;
        Ok(())
    })
}

/// Label matches first, then the list order. Validated before the disk.
pub(crate) async fn search_shortcuts(
    ctx: &DataCtx,
    query: &str,
    limit: u32,
) -> Result<Vec<ShortcutDto>, DataError> {
    let term = valid_search(query, limit)?;
    let pattern = like_contains(term);
    with_conn!(ctx, conn => {
        let rows = sqlx::query_as::<_, Row>(SEARCH_SQL)
            .bind(&pattern)
            .bind(i64::from(limit))
            .fetch_all(&mut conn)
            .await?;
        Ok(rows.into_iter().map(to_dto).collect())
    })
}

#[tauri::command]
pub async fn shortcut_list(backup: State<'_, BackupState>) -> Result<Vec<ShortcutDto>, DataError> {
    list_shortcuts(&DataCtx::from_backup(&backup)).await
}

#[tauri::command]
pub async fn shortcut_create(
    backup: State<'_, BackupState>,
    input: ShortcutNewDto,
) -> Result<ShortcutDto, DataError> {
    create_shortcut(&DataCtx::from_backup(&backup), &input).await
}

#[tauri::command]
pub async fn shortcut_update(
    backup: State<'_, BackupState>,
    id: String,
    label: String,
    url: String,
) -> Result<ShortcutDto, DataError> {
    update_shortcut(&DataCtx::from_backup(&backup), &id, &label, &url).await
}

#[tauri::command]
pub async fn shortcut_delete(
    backup: State<'_, BackupState>,
    id: String,
) -> Result<bool, DataError> {
    delete_shortcut(&DataCtx::from_backup(&backup), &id).await
}

#[tauri::command]
pub async fn shortcut_reorder(
    backup: State<'_, BackupState>,
    ids: Vec<String>,
) -> Result<(), DataError> {
    reorder_shortcuts(&DataCtx::from_backup(&backup), &ids).await
}

#[tauri::command]
pub async fn shortcut_search(
    backup: State<'_, BackupState>,
    query: String,
    limit: u32,
) -> Result<Vec<ShortcutDto>, DataError> {
    search_shortcuts(&DataCtx::from_backup(&backup), &query, limit).await
}
