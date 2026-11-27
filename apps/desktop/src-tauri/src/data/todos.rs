//! Todo list and todo commands (spec typed-data-commands 4.5.6). Every text, date and rule is
//! bounded and checked by Rust before the disk (the `CHECK`s of V3 and V6 are the safety net);
//! a well formed but impossible date (`2026-02-30`) is the `CHECK`'s business (`Constraint`).

use super::error::DataError;
use super::search::{like_contains, valid_search};
use super::{validate, DataCtx};
use crate::backup::BackupState;
use serde::{Deserialize, Deserializer, Serialize};
use sqlx::{Connection, SqliteConnection};
use tauri::State;

const LIST_COLUMNS_FOR_WIDGET_SQL: &str =
    "SELECT id, widget_instance_id, name, created_at, updated_at
       FROM todo_lists WHERE widget_instance_id = ?1";
const LIST_SELECT_ONE_SQL: &str = "SELECT id, widget_instance_id, name, created_at, updated_at
       FROM todo_lists WHERE id = ?1";
const LIST_INSERT_SQL: &str =
    "INSERT INTO todo_lists (id, widget_instance_id, name, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?4)";
const ITEMS_SQL: &str = "SELECT id, list_id, title, description, due_on, rrule, important,
       completed_at, sort_order, created_at, updated_at
       FROM todos WHERE list_id = ?1
       ORDER BY (completed_at IS NOT NULL),
                CASE WHEN completed_at IS NULL THEN sort_order END,
                completed_at DESC, created_at, id";
const SELECT_ONE_SQL: &str = "SELECT id, list_id, title, description, due_on, rrule, important,
       completed_at, sort_order, created_at, updated_at
       FROM todos WHERE id = ?1";
const INSERT_SQL: &str =
    "INSERT INTO todos (id, list_id, title, due_on, completed_at, sort_order, created_at, updated_at)
       SELECT ?1, ?2, ?3, ?4, NULL, COALESCE(MAX(sort_order) + 1, 0), ?5, ?5
       FROM todos WHERE list_id = ?2";
/// One statement. `?3` and `?6` say whether `due_on` / `rrule` are written (an explicit `null`
/// clears them); clearing the date without a new rule clears the rule too.
const UPDATE_SQL: &str = "UPDATE todos
       SET title = COALESCE(?2, title),
           due_on = CASE WHEN ?3 = 1 THEN ?4 ELSE due_on END,
           description = COALESCE(?5, description),
           rrule = CASE WHEN ?6 = 1 THEN ?7
                        WHEN ?3 = 1 AND ?4 IS NULL THEN NULL
                        ELSE rrule END,
           important = COALESCE(?8, important),
           updated_at = ?9
       WHERE id = ?1";
/// Compare-and-write: the date, the rule and the open state must still be those the caller read.
const SHIFT_SQL: &str = "UPDATE todos SET due_on = ?3, updated_at = ?4
       WHERE id = ?1 AND due_on = ?2 AND rrule IS NOT NULL AND completed_at IS NULL";
const EXISTS_SQL: &str = "SELECT EXISTS (SELECT 1 FROM todos WHERE id = ?1)";
const COMPLETE_SQL: &str = "UPDATE todos
       SET sort_order = CASE
             WHEN ?2 = 0 AND completed_at IS NOT NULL THEN
               (SELECT COALESCE(MAX(t.sort_order) + 1, 0) FROM todos AS t WHERE t.list_id = todos.list_id)
             ELSE sort_order END,
           completed_at = CASE WHEN ?2 = 1 THEN COALESCE(completed_at, ?3) ELSE NULL END,
           updated_at = ?3
       WHERE id = ?1";
const DELETE_SQL: &str = "DELETE FROM todos WHERE id = ?1";
const REORDER_SQL: &str = "UPDATE todos
SET sort_order = j.pos, updated_at = ?3
FROM (SELECT CAST(key AS INTEGER) AS pos, value AS id FROM json_each(?1)) AS j
WHERE todos.id = j.id AND todos.list_id = ?2 AND todos.sort_order <> j.pos";
const CLEAR_COMPLETED_SQL: &str =
    "DELETE FROM todos WHERE list_id = ?1 AND completed_at IS NOT NULL";
const DUE_SQL: &str = "SELECT id, list_id, title, description, due_on, rrule, important,
       completed_at, sort_order, created_at, updated_at FROM todos
       WHERE completed_at IS NULL AND due_on >= ?1 AND due_on <= ?2
       ORDER BY due_on, sort_order, id LIMIT ?3";
/// A NULL `due_on` never satisfies `due_on < ?1`.
const OVERDUE_SQL: &str = "SELECT id, list_id, title, description, due_on, rrule, important,
       completed_at, sort_order, created_at, updated_at FROM todos
       WHERE completed_at IS NULL AND due_on < ?1
       ORDER BY due_on, sort_order, id LIMIT ?2";
/// A NULL `due_on` never satisfies `due_on <= ?1`.
const REPEATING_DUE_SQL: &str = "SELECT id, list_id, title, description, due_on, rrule, important,
       completed_at, sort_order, created_at, updated_at FROM todos
       WHERE completed_at IS NULL AND rrule IS NOT NULL AND due_on <= ?1
       ORDER BY due_on, sort_order, id LIMIT ?2";
const SEARCH_SQL: &str = "SELECT t.id, t.title, t.description, t.list_id, l.widget_instance_id,
       t.completed_at
       FROM todos AS t JOIN todo_lists AS l ON l.id = t.list_id
       WHERE t.title LIKE ?1 ESCAPE '\\' OR t.description LIKE ?1 ESCAPE '\\'
       ORDER BY (t.completed_at IS NOT NULL), (t.title LIKE ?1 ESCAPE '\\') DESC,
                t.updated_at DESC, t.id
       LIMIT ?2";

/// Keeps "field present with `null`" apart from "field absent": with `#[serde(default)]` an
/// absent field is `None`, a present one (`null` included) is `Some(..)`.
pub(crate) fn present<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TodoListNewDto {
    pub id: String,
    pub widget_instance_id: Option<String>,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoListDto {
    pub id: String,
    pub widget_instance_id: Option<String>,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TodoNewDto {
    pub id: String,
    pub list_id: String,
    pub title: String,
    pub due_on: Option<String>,
}

/// Absent field = unchanged; `null` = clear (`dueOn`, `rrule`); an explicit `null` on `title`,
/// `description` or `important` is `invalid_input` (checked by `update_todo`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TodoChangesDto {
    #[serde(default, deserialize_with = "present")]
    pub title: Option<Option<String>>,
    #[serde(default, deserialize_with = "present")]
    pub due_on: Option<Option<String>>,
    #[serde(default, deserialize_with = "present")]
    pub description: Option<Option<String>>,
    #[serde(default, deserialize_with = "present")]
    pub rrule: Option<Option<String>>,
    #[serde(default, deserialize_with = "present")]
    pub important: Option<Option<bool>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoDto {
    pub id: String,
    pub list_id: String,
    pub title: String,
    pub description: String,
    pub due_on: Option<String>,
    pub rrule: Option<String>,
    pub important: bool,
    pub completed_at: Option<String>,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// A search hit: the front computes the excerpt from `description` (T9).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoHitDto {
    pub id: String,
    pub title: String,
    pub description: String,
    pub list_id: String,
    pub widget_instance_id: Option<String>,
    pub completed_at: Option<String>,
}

type ListRow = (String, Option<String>, String, String, String);
type Row = (
    String,
    String,
    String,
    String,
    Option<String>,
    Option<String>,
    i64,
    Option<String>,
    i64,
    String,
    String,
);
type HitRow = (
    String,
    String,
    String,
    String,
    Option<String>,
    Option<String>,
);

fn to_list_dto(row: ListRow) -> TodoListDto {
    TodoListDto {
        id: row.0,
        widget_instance_id: row.1,
        name: row.2,
        created_at: row.3,
        updated_at: row.4,
    }
}

fn to_dto(row: Row) -> TodoDto {
    TodoDto {
        id: row.0,
        list_id: row.1,
        title: row.2,
        description: row.3,
        due_on: row.4,
        rrule: row.5,
        important: row.6 != 0,
        completed_at: row.7,
        sort_order: row.8,
        created_at: row.9,
        updated_at: row.10,
    }
}

async fn fetch(conn: &mut SqliteConnection, id: &str) -> Result<Option<TodoDto>, DataError> {
    let row = sqlx::query_as::<_, Row>(SELECT_ONE_SQL)
        .bind(id)
        .fetch_optional(conn)
        .await?;
    Ok(row.map(to_dto))
}

async fn must_fetch(conn: &mut SqliteConnection, id: &str) -> Result<TodoDto, DataError> {
    fetch(conn, id).await?.ok_or(DataError::NotFound)
}

/// An id that is not well formed designates no list: `None`.
pub(crate) async fn get_list_for_widget(
    ctx: &DataCtx,
    widget_instance_id: &str,
) -> Result<Option<TodoListDto>, DataError> {
    with_conn!(ctx, conn => {
        let row = sqlx::query_as::<_, ListRow>(LIST_COLUMNS_FOR_WIDGET_SQL)
            .bind(widget_instance_id)
            .fetch_optional(&mut conn)
            .await?;
        Ok(row.map(to_list_dto))
    })
}

/// A missing owning instance is a `Constraint`, a second list for the same instance or an id
/// already used a `Conflict`. The name is stored trimmed.
pub(crate) async fn create_list(
    ctx: &DataCtx,
    input: &TodoListNewDto,
) -> Result<TodoListDto, DataError> {
    ctx.ensure_writable()?;
    validate::new_id(&input.id)?;
    let name = validate::list_name(&input.name)?;
    let now = ctx.now();
    with_conn!(ctx, conn => {
        sqlx::query(LIST_INSERT_SQL)
            .bind(&input.id)
            .bind(input.widget_instance_id.as_deref())
            .bind(name)
            .bind(&now)
            .execute(&mut conn)
            .await?;
        let row = sqlx::query_as::<_, ListRow>(LIST_SELECT_ONE_SQL)
            .bind(&input.id)
            .fetch_optional(&mut conn)
            .await?;
        row.map(to_list_dto).ok_or(DataError::NotFound)
    })
}

/// Active todos by `sort_order`, then the completed ones by completion date, most recent first.
pub(crate) async fn list_todos(ctx: &DataCtx, list_id: &str) -> Result<Vec<TodoDto>, DataError> {
    with_conn!(ctx, conn => {
        let rows = sqlx::query_as::<_, Row>(ITEMS_SQL)
            .bind(list_id)
            .fetch_all(&mut conn)
            .await?;
        Ok(rows.into_iter().map(to_dto).collect())
    })
}

/// Appended at the end of the active ones; the title is stored trimmed. A missing list is a
/// `Constraint`.
pub(crate) async fn create_todo(ctx: &DataCtx, input: &TodoNewDto) -> Result<TodoDto, DataError> {
    ctx.ensure_writable()?;
    validate::new_id(&input.id)?;
    let title = validate::todo_title(&input.title)?;
    if let Some(due_on) = &input.due_on {
        validate::date(due_on, "dueOn")?;
    }
    let now = ctx.now();
    with_conn!(ctx, conn => {
        sqlx::query(INSERT_SQL)
            .bind(&input.id)
            .bind(&input.list_id)
            .bind(title)
            .bind(input.due_on.as_deref())
            .bind(&now)
            .execute(&mut conn)
            .await?;
        must_fetch(&mut conn, &input.id).await
    })
}

/// One statement. A rule with an explicit `dueOn: null` is `invalid_input` before the disk; a
/// rule on a todo without a due date is a `Constraint`.
pub(crate) async fn update_todo(
    ctx: &DataCtx,
    id: &str,
    changes: &TodoChangesDto,
) -> Result<TodoDto, DataError> {
    ctx.ensure_writable()?;
    if matches!(changes.title, Some(None)) {
        return Err(DataError::invalid("title"));
    }
    if matches!(changes.description, Some(None)) {
        return Err(DataError::invalid("description"));
    }
    if matches!(changes.important, Some(None)) {
        return Err(DataError::invalid("important"));
    }
    let title = changes
        .title
        .as_ref()
        .and_then(|t| t.as_deref())
        .map(validate::todo_title)
        .transpose()?;
    if let Some(Some(due_on)) = &changes.due_on {
        validate::date(due_on, "dueOn")?;
    }
    let description = changes.description.as_ref().and_then(|d| d.as_deref());
    if let Some(description) = description {
        validate::description(description)?;
    }
    if let Some(Some(rrule)) = &changes.rrule {
        validate::rrule(rrule)?;
    }
    if matches!(
        (&changes.rrule, &changes.due_on),
        (Some(Some(_)), Some(None))
    ) {
        return Err(DataError::invalid("rrule"));
    }
    let set_due = i64::from(changes.due_on.is_some());
    let due_on = changes.due_on.as_ref().and_then(|d| d.as_deref());
    let set_rrule = i64::from(changes.rrule.is_some());
    let rrule = changes.rrule.as_ref().and_then(|r| r.as_deref());
    let important = changes.important.flatten().map(i64::from);
    let now = ctx.now();
    with_conn!(ctx, conn => {
        let result = sqlx::query(UPDATE_SQL)
            .bind(id)
            .bind(title)
            .bind(set_due)
            .bind(due_on)
            .bind(description)
            .bind(set_rrule)
            .bind(rrule)
            .bind(important)
            .bind(&now)
            .execute(&mut conn)
            .await?;
        if result.rows_affected() == 0 {
            return Err(DataError::NotFound);
        }
        must_fetch(&mut conn, id).await
    })
}

/// Moves the due date of a repeating, open todo from `from_due_on` to `to_due_on`, only if it is
/// still `from_due_on`: absent todo `NotFound`, anything else that changed `Conflict`.
pub(crate) async fn shift_repeat_due(
    ctx: &DataCtx,
    id: &str,
    from_due_on: &str,
    to_due_on: &str,
) -> Result<TodoDto, DataError> {
    ctx.ensure_writable()?;
    validate::date(from_due_on, "fromDueOn")?;
    validate::date(to_due_on, "toDueOn")?;
    let now = ctx.now();
    with_conn!(ctx, conn => {
        let mut tx = conn.begin_with("BEGIN IMMEDIATE").await?;
        let result = sqlx::query(SHIFT_SQL)
            .bind(id)
            .bind(from_due_on)
            .bind(to_due_on)
            .bind(&now)
            .execute(&mut *tx)
            .await?;
        if result.rows_affected() == 0 {
            let exists = sqlx::query_scalar::<_, bool>(EXISTS_SQL)
                .bind(id)
                .fetch_one(&mut *tx)
                .await?;
            tx.rollback().await?;
            return Err(if exists { DataError::Conflict } else { DataError::NotFound });
        }
        tx.commit().await?;
        must_fetch(&mut conn, id).await
    })
}

/// Checking keeps an existing completion date; unchecking sends the todo to the end of the
/// active ones (only if it was completed).
pub(crate) async fn set_completed(
    ctx: &DataCtx,
    id: &str,
    completed: bool,
) -> Result<TodoDto, DataError> {
    ctx.ensure_writable()?;
    let now = ctx.now();
    with_conn!(ctx, conn => {
        let result = sqlx::query(COMPLETE_SQL)
            .bind(id)
            .bind(i64::from(completed))
            .bind(&now)
            .execute(&mut conn)
            .await?;
        if result.rows_affected() == 0 {
            return Err(DataError::NotFound);
        }
        must_fetch(&mut conn, id).await
    })
}

/// `true` if a row was removed.
pub(crate) async fn delete_todo(ctx: &DataCtx, id: &str) -> Result<bool, DataError> {
    ctx.ensure_writable()?;
    with_conn!(ctx, conn => {
        let result = sqlx::query(DELETE_SQL).bind(id).execute(&mut conn).await?;
        Ok(result.rows_affected() > 0)
    })
}

/// Position `i` for the id at index `i`, within `list_id` only. An empty batch does nothing (no
/// disk access); unknown ids and todos of another list are ignored.
pub(crate) async fn reorder_todos(
    ctx: &DataCtx,
    list_id: &str,
    ids: &[String],
) -> Result<(), DataError> {
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
            .bind(list_id)
            .bind(&now)
            .execute(&mut conn)
            .await?;
        Ok(())
    })
}

/// Number of completed todos removed from the list.
pub(crate) async fn clear_completed(ctx: &DataCtx, list_id: &str) -> Result<u32, DataError> {
    ctx.ensure_writable()?;
    with_conn!(ctx, conn => {
        let result = sqlx::query(CLEAR_COMPLETED_SQL)
            .bind(list_id)
            .execute(&mut conn)
            .await?;
        Ok(u32::try_from(result.rows_affected()).unwrap_or(u32::MAX))
    })
}

async fn select_due(
    ctx: &DataCtx,
    sql: &'static str,
    bounds: &[&str],
    limit: u32,
) -> Result<Vec<TodoDto>, DataError> {
    with_conn!(ctx, conn => {
        let mut query = sqlx::query_as::<_, Row>(sql);
        for bound in bounds {
            query = query.bind(*bound);
        }
        let rows = query.bind(i64::from(limit)).fetch_all(&mut conn).await?;
        Ok(rows.into_iter().map(to_dto).collect())
    })
}

/// Open todos due within `from_on..=to_on`. Arguments are validated before the disk; a start
/// after the end is `invalid_input`.
pub(crate) async fn list_due(
    ctx: &DataCtx,
    from_on: &str,
    to_on: &str,
    limit: u32,
) -> Result<Vec<TodoDto>, DataError> {
    validate::date(from_on, "fromOn")?;
    validate::date(to_on, "toOn")?;
    if from_on > to_on {
        return Err(DataError::invalid("toOn"));
    }
    validate::due_limit(limit)?;
    select_due(ctx, DUE_SQL, &[from_on, to_on], limit).await
}

/// Open dated todos strictly before `before_on`.
pub(crate) async fn list_overdue(
    ctx: &DataCtx,
    before_on: &str,
    limit: u32,
) -> Result<Vec<TodoDto>, DataError> {
    validate::date(before_on, "beforeOn")?;
    validate::due_limit(limit)?;
    select_due(ctx, OVERDUE_SQL, &[before_on], limit).await
}

/// Open repeating todos due on or before `to_on`.
pub(crate) async fn list_repeating_due(
    ctx: &DataCtx,
    to_on: &str,
    limit: u32,
) -> Result<Vec<TodoDto>, DataError> {
    validate::date(to_on, "toOn")?;
    validate::due_limit(limit)?;
    select_due(ctx, REPEATING_DUE_SQL, &[to_on], limit).await
}

/// Open todos first, then title matches, then the most recently updated. Validated before the
/// disk.
pub(crate) async fn search_todos(
    ctx: &DataCtx,
    query: &str,
    limit: u32,
) -> Result<Vec<TodoHitDto>, DataError> {
    let term = valid_search(query, limit)?;
    let pattern = like_contains(term);
    with_conn!(ctx, conn => {
        let rows = sqlx::query_as::<_, HitRow>(SEARCH_SQL)
            .bind(&pattern)
            .bind(i64::from(limit))
            .fetch_all(&mut conn)
            .await?;
        Ok(rows
            .into_iter()
            .map(|(id, title, description, list_id, widget_instance_id, completed_at)| TodoHitDto {
                id,
                title,
                description,
                list_id,
                widget_instance_id,
                completed_at,
            })
            .collect())
    })
}

#[tauri::command]
pub async fn todo_list_for_widget(
    backup: State<'_, BackupState>,
    widget_instance_id: String,
) -> Result<Option<TodoListDto>, DataError> {
    get_list_for_widget(&DataCtx::from_backup(&backup), &widget_instance_id).await
}

#[tauri::command]
pub async fn todo_list_create(
    backup: State<'_, BackupState>,
    input: TodoListNewDto,
) -> Result<TodoListDto, DataError> {
    create_list(&DataCtx::from_backup(&backup), &input).await
}

#[tauri::command]
pub async fn todo_list_items(
    backup: State<'_, BackupState>,
    list_id: String,
) -> Result<Vec<TodoDto>, DataError> {
    list_todos(&DataCtx::from_backup(&backup), &list_id).await
}

#[tauri::command]
pub async fn todo_create(
    backup: State<'_, BackupState>,
    input: TodoNewDto,
) -> Result<TodoDto, DataError> {
    create_todo(&DataCtx::from_backup(&backup), &input).await
}

#[tauri::command]
pub async fn todo_update(
    backup: State<'_, BackupState>,
    id: String,
    changes: TodoChangesDto,
) -> Result<TodoDto, DataError> {
    update_todo(&DataCtx::from_backup(&backup), &id, &changes).await
}

#[tauri::command]
pub async fn todo_shift_repeat_due(
    backup: State<'_, BackupState>,
    id: String,
    from_due_on: String,
    to_due_on: String,
) -> Result<TodoDto, DataError> {
    shift_repeat_due(
        &DataCtx::from_backup(&backup),
        &id,
        &from_due_on,
        &to_due_on,
    )
    .await
}

#[tauri::command]
pub async fn todo_set_completed(
    backup: State<'_, BackupState>,
    id: String,
    completed: bool,
) -> Result<TodoDto, DataError> {
    set_completed(&DataCtx::from_backup(&backup), &id, completed).await
}

#[tauri::command]
pub async fn todo_delete(backup: State<'_, BackupState>, id: String) -> Result<bool, DataError> {
    delete_todo(&DataCtx::from_backup(&backup), &id).await
}

#[tauri::command]
pub async fn todo_due(
    backup: State<'_, BackupState>,
    from_on: String,
    to_on: String,
    limit: u32,
) -> Result<Vec<TodoDto>, DataError> {
    list_due(&DataCtx::from_backup(&backup), &from_on, &to_on, limit).await
}

#[tauri::command]
pub async fn todo_overdue(
    backup: State<'_, BackupState>,
    before_on: String,
    limit: u32,
) -> Result<Vec<TodoDto>, DataError> {
    list_overdue(&DataCtx::from_backup(&backup), &before_on, limit).await
}

#[tauri::command]
pub async fn todo_repeating_due(
    backup: State<'_, BackupState>,
    to_on: String,
    limit: u32,
) -> Result<Vec<TodoDto>, DataError> {
    list_repeating_due(&DataCtx::from_backup(&backup), &to_on, limit).await
}

#[tauri::command]
pub async fn todo_reorder(
    backup: State<'_, BackupState>,
    list_id: String,
    ids: Vec<String>,
) -> Result<(), DataError> {
    reorder_todos(&DataCtx::from_backup(&backup), &list_id, &ids).await
}

#[tauri::command]
pub async fn todo_clear_completed(
    backup: State<'_, BackupState>,
    list_id: String,
) -> Result<u32, DataError> {
    clear_completed(&DataCtx::from_backup(&backup), &list_id).await
}

#[tauri::command]
pub async fn todo_search(
    backup: State<'_, BackupState>,
    query: String,
    limit: u32,
) -> Result<Vec<TodoHitDto>, DataError> {
    search_todos(&DataCtx::from_backup(&backup), &query, limit).await
}
