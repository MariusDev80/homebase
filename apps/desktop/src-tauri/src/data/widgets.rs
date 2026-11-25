//! Widget instance commands (spec typed-data-commands 4.5.3). `configJson` travels as text and
//! is stored as is; the `CHECK` of V1 decides whether it is an object (`constraint`).

use super::error::DataError;
use super::{validate, DataCtx, MAX_BATCH, MAX_WIDGETS, MAX_WIDGETS_PER_DASHBOARD};
use crate::backup::BackupState;
use serde::{Deserialize, Serialize};
use sqlx::{Connection, SqliteConnection};
use tauri::State;

const SELECT_ONE_SQL: &str = "SELECT id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h,
       config, config_version, created_at, updated_at
       FROM widget_instances WHERE id = ?1";
const SELECT_BY_DASHBOARD_SQL: &str =
    "SELECT id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h,
       config, config_version, created_at, updated_at
       FROM widget_instances WHERE dashboard_id = ?1 ORDER BY grid_y, grid_x, created_at, id";
const FIND_FIRST_SQL: &str =
    "SELECT w.id, w.dashboard_id, w.widget_type, w.grid_x, w.grid_y, w.grid_w, w.grid_h,
       w.config, w.config_version, w.created_at, w.updated_at
       FROM widget_instances AS w JOIN dashboards AS d ON d.id = w.dashboard_id
       WHERE w.widget_type = ?1
       ORDER BY d.sort_order, d.created_at, d.id, w.grid_y, w.grid_x, w.created_at, w.id
       LIMIT 1";
const INSERT_SQL: &str = "INSERT INTO widget_instances
         (id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h,
          config, config_version, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)";
const COUNT_IN_DASHBOARD_SQL: &str =
    "SELECT COUNT(*) FROM widget_instances WHERE dashboard_id = ?1";
const COUNT_ALL_SQL: &str = "SELECT COUNT(*) FROM widget_instances";
const UPDATE_CONFIG_SQL: &str =
    "UPDATE widget_instances SET config = ?2, config_version = ?3, updated_at = ?4 WHERE id = ?1";
const DELETE_SQL: &str = "DELETE FROM widget_instances WHERE id = ?1";
/// One statement: all the rows change or none does. The JSON payload is built by Rust from
/// validated items.
pub(crate) const UPDATE_LAYOUT_SQL: &str = "UPDATE widget_instances
SET grid_x = j.x, grid_y = j.y, grid_w = j.w, grid_h = j.h, updated_at = ?3
FROM (
  SELECT json_extract(value, '$.id') AS id,
         json_extract(value, '$.x')  AS x,
         json_extract(value, '$.y')  AS y,
         json_extract(value, '$.w')  AS w,
         json_extract(value, '$.h')  AS h
  FROM json_each(?2)
) AS j
WHERE widget_instances.id = j.id AND widget_instances.dashboard_id = ?1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GridDto {
    pub x: i64,
    pub y: i64,
    pub w: i64,
    pub h: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LayoutItemDto {
    pub id: String,
    pub grid: GridDto,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WidgetNewDto {
    pub id: String,
    pub dashboard_id: String,
    pub widget_type: String,
    pub grid: GridDto,
    pub config_json: String,
    pub config_version: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetDto {
    pub id: String,
    pub dashboard_id: String,
    pub widget_type: String,
    pub grid: GridDto,
    pub config_json: String,
    pub config_version: i64,
    pub created_at: String,
    pub updated_at: String,
}

type Row = (
    String,
    String,
    String,
    i64,
    i64,
    i64,
    i64,
    String,
    i64,
    String,
    String,
);

fn to_dto(row: Row) -> WidgetDto {
    WidgetDto {
        id: row.0,
        dashboard_id: row.1,
        widget_type: row.2,
        grid: GridDto {
            x: row.3,
            y: row.4,
            w: row.5,
            h: row.6,
        },
        config_json: row.7,
        config_version: row.8,
        created_at: row.9,
        updated_at: row.10,
    }
}

async fn fetch(conn: &mut SqliteConnection, id: &str) -> Result<Option<WidgetDto>, DataError> {
    let row = sqlx::query_as::<_, Row>(SELECT_ONE_SQL)
        .bind(id)
        .fetch_optional(conn)
        .await?;
    Ok(row.map(to_dto))
}

pub(crate) async fn list_widgets(
    ctx: &DataCtx,
    dashboard_id: &str,
) -> Result<Vec<WidgetDto>, DataError> {
    with_conn!(ctx, conn => {
        let rows = sqlx::query_as::<_, Row>(SELECT_BY_DASHBOARD_SQL)
            .bind(dashboard_id)
            .fetch_all(&mut conn)
            .await?;
        Ok(rows.into_iter().map(to_dto).collect())
    })
}

/// An id that is not well formed designates no row: `None`.
pub(crate) async fn get_widget(ctx: &DataCtx, id: &str) -> Result<Option<WidgetDto>, DataError> {
    with_conn!(ctx, conn => fetch(&mut conn, id).await)
}

/// Same bounds as the configuration import (type, grid, version): an export is always importable.
pub(crate) async fn create_widget(
    ctx: &DataCtx,
    input: &WidgetNewDto,
) -> Result<WidgetDto, DataError> {
    ctx.ensure_writable()?;
    validate::new_id(&input.id)?;
    validate::widget_type(&input.widget_type)?;
    validate::grid(input.grid.x, input.grid.y, input.grid.w, input.grid.h)?;
    validate::config_version(input.config_version)?;
    validate::json_text(&input.config_json, "configJson")?;
    let now = ctx.now();
    with_conn!(ctx, conn => {
        let mut tx = conn.begin_with("BEGIN IMMEDIATE").await?;
        // A missing dashboard is a `Constraint` (foreign key), an existing id a `Conflict`.
        sqlx::query(INSERT_SQL)
            .bind(&input.id)
            .bind(&input.dashboard_id)
            .bind(&input.widget_type)
            .bind(input.grid.x)
            .bind(input.grid.y)
            .bind(input.grid.w)
            .bind(input.grid.h)
            .bind(&input.config_json)
            .bind(input.config_version)
            .bind(&now)
            .execute(&mut *tx)
            .await?;
        let in_dashboard = sqlx::query_scalar::<_, i64>(COUNT_IN_DASHBOARD_SQL)
            .bind(&input.dashboard_id)
            .fetch_one(&mut *tx)
            .await?;
        let total = sqlx::query_scalar::<_, i64>(COUNT_ALL_SQL)
            .fetch_one(&mut *tx)
            .await?;
        if in_dashboard > MAX_WIDGETS_PER_DASHBOARD || total > MAX_WIDGETS {
            tx.rollback().await?;
            return Err(DataError::LimitReached);
        }
        tx.commit().await?;
        fetch(&mut conn, &input.id).await?.ok_or(DataError::NotFound)
    })
}

pub(crate) async fn update_widget_config(
    ctx: &DataCtx,
    id: &str,
    config_json: &str,
    config_version: i64,
) -> Result<WidgetDto, DataError> {
    ctx.ensure_writable()?;
    validate::config_version(config_version)?;
    validate::json_text(config_json, "configJson")?;
    let now = ctx.now();
    with_conn!(ctx, conn => {
        let result = sqlx::query(UPDATE_CONFIG_SQL)
            .bind(id)
            .bind(config_json)
            .bind(config_version)
            .bind(&now)
            .execute(&mut conn)
            .await?;
        if result.rows_affected() == 0 {
            return Err(DataError::NotFound);
        }
        fetch(&mut conn, id).await?.ok_or(DataError::NotFound)
    })
}

/// Number of rows changed. An empty batch is `0` without any disk access; unknown ids and
/// instances of another dashboard are ignored.
pub(crate) async fn update_widget_layout(
    ctx: &DataCtx,
    dashboard_id: &str,
    items: &[LayoutItemDto],
) -> Result<u32, DataError> {
    ctx.ensure_writable()?;
    if items.is_empty() {
        return Ok(0);
    }
    validate::check_items(items, MAX_BATCH)?;
    let payload = layout_payload(items)?;
    write_layout(ctx, dashboard_id, &payload).await
}

/// JSON text read by `json_each` (built from validated items).
pub(crate) fn layout_payload(items: &[LayoutItemDto]) -> Result<String, DataError> {
    let array: Vec<serde_json::Value> = items
        .iter()
        .map(|i| {
            serde_json::json!({
                "id": i.id, "x": i.grid.x, "y": i.grid.y, "w": i.grid.w, "h": i.grid.h
            })
        })
        .collect();
    serde_json::to_string(&array).map_err(|_| DataError::Database)
}

/// The statement of [`update_widget_layout`] over an already built payload (the atomicity test
/// feeds it a payload the validation would have refused).
pub(crate) async fn write_layout(
    ctx: &DataCtx,
    dashboard_id: &str,
    payload: &str,
) -> Result<u32, DataError> {
    let now = ctx.now();
    with_conn!(ctx, conn => {
        let result = sqlx::query(UPDATE_LAYOUT_SQL)
            .bind(dashboard_id)
            .bind(payload)
            .bind(&now)
            .execute(&mut conn)
            .await?;
        Ok(u32::try_from(result.rows_affected()).unwrap_or(u32::MAX))
    })
}

/// A type longer than 64 characters matches nothing: `None`.
pub(crate) async fn find_first_widget_of_type(
    ctx: &DataCtx,
    widget_type: &str,
) -> Result<Option<WidgetDto>, DataError> {
    if widget_type.chars().count() > validate::MAX_WIDGET_TYPE_CHARS {
        return Ok(None);
    }
    with_conn!(ctx, conn => {
        let row = sqlx::query_as::<_, Row>(FIND_FIRST_SQL)
            .bind(widget_type)
            .fetch_optional(&mut conn)
            .await?;
        Ok(row.map(to_dto))
    })
}

/// `true` if a row was removed (cascades to its notes, lists and tasks).
pub(crate) async fn delete_widget(ctx: &DataCtx, id: &str) -> Result<bool, DataError> {
    ctx.ensure_writable()?;
    with_conn!(ctx, conn => {
        let result = sqlx::query(DELETE_SQL).bind(id).execute(&mut conn).await?;
        Ok(result.rows_affected() > 0)
    })
}

#[tauri::command]
pub async fn widget_list(
    backup: State<'_, BackupState>,
    dashboard_id: String,
) -> Result<Vec<WidgetDto>, DataError> {
    list_widgets(&DataCtx::from_backup(&backup), &dashboard_id).await
}

#[tauri::command]
pub async fn widget_get(
    backup: State<'_, BackupState>,
    id: String,
) -> Result<Option<WidgetDto>, DataError> {
    get_widget(&DataCtx::from_backup(&backup), &id).await
}

#[tauri::command]
pub async fn widget_create(
    backup: State<'_, BackupState>,
    input: WidgetNewDto,
) -> Result<WidgetDto, DataError> {
    create_widget(&DataCtx::from_backup(&backup), &input).await
}

#[tauri::command]
pub async fn widget_update_config(
    backup: State<'_, BackupState>,
    id: String,
    config_json: String,
    config_version: i64,
) -> Result<WidgetDto, DataError> {
    update_widget_config(
        &DataCtx::from_backup(&backup),
        &id,
        &config_json,
        config_version,
    )
    .await
}

#[tauri::command]
pub async fn widget_update_layout(
    backup: State<'_, BackupState>,
    dashboard_id: String,
    items: Vec<LayoutItemDto>,
) -> Result<u32, DataError> {
    update_widget_layout(&DataCtx::from_backup(&backup), &dashboard_id, &items).await
}

#[tauri::command]
pub async fn widget_find_first_of_type(
    backup: State<'_, BackupState>,
    widget_type: String,
) -> Result<Option<WidgetDto>, DataError> {
    find_first_widget_of_type(&DataCtx::from_backup(&backup), &widget_type).await
}

#[tauri::command]
pub async fn widget_delete(backup: State<'_, BackupState>, id: String) -> Result<bool, DataError> {
    delete_widget(&DataCtx::from_backup(&backup), &id).await
}
