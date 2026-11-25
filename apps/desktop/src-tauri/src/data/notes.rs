//! Note commands (spec typed-data-commands 4.5.4). Title and body are plain text, bounded in
//! UTF-16 units by Rust before the disk (a NUL character hides the rest of a text from the
//! `CHECK` `length()`, so the `CHECK` is only the safety net).

use super::error::DataError;
use super::search::{like_contains, valid_search};
use super::{validate, DataCtx};
use crate::backup::BackupState;
use serde::{Deserialize, Serialize};
use sqlx::SqliteConnection;
use tauri::State;

const SELECT_ONE_SQL: &str =
    "SELECT id, widget_instance_id, title, body, created_at, updated_at FROM notes WHERE id = ?1";
const INSERT_SQL: &str =
    "INSERT INTO notes (id, widget_instance_id, title, body, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)";
const UPDATE_SQL: &str = "UPDATE notes SET title = ?2, body = ?3, updated_at = ?4 WHERE id = ?1";
const DELETE_SQL: &str = "DELETE FROM notes WHERE id = ?1";
const SEARCH_SQL: &str = "SELECT id, title, body, widget_instance_id FROM notes
       WHERE title LIKE ?1 ESCAPE '\\' OR body LIKE ?1 ESCAPE '\\'
       ORDER BY (title LIKE ?1 ESCAPE '\\') DESC, updated_at DESC, id
       LIMIT ?2";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NoteNewDto {
    pub id: String,
    pub widget_instance_id: Option<String>,
    pub title: String,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteDto {
    pub id: String,
    pub widget_instance_id: Option<String>,
    pub title: String,
    pub body: String,
    pub created_at: String,
    pub updated_at: String,
}

/// A search hit: the front computes the excerpt from `body` (T9).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteHitDto {
    pub id: String,
    pub title: String,
    pub body: String,
    pub widget_instance_id: Option<String>,
}

type Row = (String, Option<String>, String, String, String, String);

fn to_dto(row: Row) -> NoteDto {
    NoteDto {
        id: row.0,
        widget_instance_id: row.1,
        title: row.2,
        body: row.3,
        created_at: row.4,
        updated_at: row.5,
    }
}

async fn fetch(conn: &mut SqliteConnection, id: &str) -> Result<Option<NoteDto>, DataError> {
    let row = sqlx::query_as::<_, Row>(SELECT_ONE_SQL)
        .bind(id)
        .fetch_optional(conn)
        .await?;
    Ok(row.map(to_dto))
}

/// An id that is not well formed designates no row: `None`.
pub(crate) async fn get_note(ctx: &DataCtx, id: &str) -> Result<Option<NoteDto>, DataError> {
    with_conn!(ctx, conn => fetch(&mut conn, id).await)
}

/// A missing owning instance is a `Constraint`, a second note for the same instance or an id
/// already used a `Conflict`.
pub(crate) async fn create_note(ctx: &DataCtx, input: &NoteNewDto) -> Result<NoteDto, DataError> {
    ctx.ensure_writable()?;
    validate::new_id(&input.id)?;
    validate::note_title(&input.title)?;
    validate::note_body(&input.body)?;
    let now = ctx.now();
    with_conn!(ctx, conn => {
        sqlx::query(INSERT_SQL)
            .bind(&input.id)
            .bind(input.widget_instance_id.as_deref())
            .bind(&input.title)
            .bind(&input.body)
            .bind(&now)
            .execute(&mut conn)
            .await?;
        fetch(&mut conn, &input.id).await?.ok_or(DataError::NotFound)
    })
}

pub(crate) async fn update_note(
    ctx: &DataCtx,
    id: &str,
    title: &str,
    body: &str,
) -> Result<NoteDto, DataError> {
    ctx.ensure_writable()?;
    validate::note_title(title)?;
    validate::note_body(body)?;
    let now = ctx.now();
    with_conn!(ctx, conn => {
        let result = sqlx::query(UPDATE_SQL)
            .bind(id)
            .bind(title)
            .bind(body)
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
pub(crate) async fn delete_note(ctx: &DataCtx, id: &str) -> Result<bool, DataError> {
    ctx.ensure_writable()?;
    with_conn!(ctx, conn => {
        let result = sqlx::query(DELETE_SQL).bind(id).execute(&mut conn).await?;
        Ok(result.rows_affected() > 0)
    })
}

/// Title matches first, then the most recently updated. Validated before the disk.
pub(crate) async fn search_notes(
    ctx: &DataCtx,
    query: &str,
    limit: u32,
) -> Result<Vec<NoteHitDto>, DataError> {
    let term = valid_search(query, limit)?;
    let pattern = like_contains(term);
    with_conn!(ctx, conn => {
        let rows = sqlx::query_as::<_, (String, String, String, Option<String>)>(SEARCH_SQL)
            .bind(&pattern)
            .bind(i64::from(limit))
            .fetch_all(&mut conn)
            .await?;
        Ok(rows
            .into_iter()
            .map(|(id, title, body, widget_instance_id)| NoteHitDto {
                id,
                title,
                body,
                widget_instance_id,
            })
            .collect())
    })
}

#[tauri::command]
pub async fn note_get(
    backup: State<'_, BackupState>,
    id: String,
) -> Result<Option<NoteDto>, DataError> {
    get_note(&DataCtx::from_backup(&backup), &id).await
}

#[tauri::command]
pub async fn note_create(
    backup: State<'_, BackupState>,
    input: NoteNewDto,
) -> Result<NoteDto, DataError> {
    create_note(&DataCtx::from_backup(&backup), &input).await
}

#[tauri::command]
pub async fn note_update(
    backup: State<'_, BackupState>,
    id: String,
    title: String,
    body: String,
) -> Result<NoteDto, DataError> {
    update_note(&DataCtx::from_backup(&backup), &id, &title, &body).await
}

#[tauri::command]
pub async fn note_delete(backup: State<'_, BackupState>, id: String) -> Result<bool, DataError> {
    delete_note(&DataCtx::from_backup(&backup), &id).await
}

#[tauri::command]
pub async fn note_search(
    backup: State<'_, BackupState>,
    query: String,
    limit: u32,
) -> Result<Vec<NoteHitDto>, DataError> {
    search_notes(&DataCtx::from_backup(&backup), &query, limit).await
}
