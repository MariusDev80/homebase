//! Dashboard commands (spec typed-data-commands 4.5.2). `dashboard_delete` stays in `backup/`
//! (the only user-requested deletion, with its `pre-delete` archive): there is no `DELETE` here.
//! The overflow of a dashboard goes through [`create_with_widgets`], one transaction.

use super::error::DataError;
use super::widgets::{layout_payload, LayoutItemDto};
use super::{validate, DataCtx, MAX_DASHBOARDS, MAX_WIDGETS_PER_DASHBOARD};
use crate::backup::names::is_uuid_shape;
use crate::backup::BackupState;
use serde::{Deserialize, Serialize};
use sqlx::{Connection, SqliteConnection};
use tauri::State;

const SELECT_ONE_SQL: &str =
    "SELECT id, name, sort_order, icon, theme, theme_version, created_at, updated_at
       FROM dashboards WHERE id = ?1";
const SELECT_ALL_SQL: &str =
    "SELECT id, name, sort_order, icon, theme, theme_version, created_at, updated_at
       FROM dashboards ORDER BY sort_order, created_at, id";
const COUNT_SQL: &str = "SELECT COUNT(*) FROM dashboards";
const INSERT_SQL: &str =
    "INSERT INTO dashboards (id, name, sort_order, icon, theme, theme_version, created_at, updated_at)
       SELECT ?1, ?2, COALESCE(MAX(sort_order) + 1, 0), ?3, ?4, ?5, ?6, ?6 FROM dashboards";
const INSERT_IF_NONE_SQL: &str =
    "INSERT INTO dashboards (id, name, sort_order, icon, theme, theme_version, created_at, updated_at)
       SELECT ?1, ?2, 0, ?3, ?4, ?5, ?6, ?6 WHERE NOT EXISTS (SELECT 1 FROM dashboards)";
const UPDATE_SQL: &str =
    "UPDATE dashboards SET name = ?2, icon = ?3, updated_at = ?4 WHERE id = ?1";
const UPDATE_THEME_SQL: &str =
    "UPDATE dashboards SET theme = ?2, theme_version = ?3, updated_at = ?4 WHERE id = ?1";
/// Moves the instances of the source dashboard (`?4`) to the new one (`?1`). The JSON payload is
/// built by Rust from validated items, never copied from the input.
pub(crate) const MOVE_TO_NEW_SQL: &str = "UPDATE widget_instances
SET dashboard_id = ?1, grid_x = j.x, grid_y = j.y, grid_w = j.w, grid_h = j.h, updated_at = ?3
FROM (
  SELECT json_extract(value, '$.id') AS id,
         json_extract(value, '$.x')  AS x,
         json_extract(value, '$.y')  AS y,
         json_extract(value, '$.w')  AS w,
         json_extract(value, '$.h')  AS h
  FROM json_each(?2)
) AS j
WHERE widget_instances.id = j.id AND widget_instances.dashboard_id = ?4";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DashboardNewDto {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
    pub theme_json: Option<String>,
    pub theme_version: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardDto {
    pub id: String,
    pub name: String,
    pub sort_order: i64,
    pub icon: String,
    pub theme_json: String,
    pub theme_version: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DashboardWithWidgetsDto {
    pub dashboard: DashboardNewDto,
    pub source_dashboard_id: String,
    pub items: Vec<LayoutItemDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardWithWidgetsResult {
    pub dashboard: DashboardDto,
    pub moved: u32,
}

type Row = (String, String, i64, String, String, i64, String, String);

fn to_dto(row: Row) -> DashboardDto {
    DashboardDto {
        id: row.0,
        name: row.1,
        sort_order: row.2,
        icon: row.3,
        theme_json: row.4,
        theme_version: row.5,
        created_at: row.6,
        updated_at: row.7,
    }
}

async fn fetch(conn: &mut SqliteConnection, id: &str) -> Result<Option<DashboardDto>, DataError> {
    let row = sqlx::query_as::<_, Row>(SELECT_ONE_SQL)
        .bind(id)
        .fetch_optional(conn)
        .await?;
    Ok(row.map(to_dto))
}

async fn must_fetch(conn: &mut SqliteConnection, id: &str) -> Result<DashboardDto, DataError> {
    fetch(conn, id).await?.ok_or(DataError::NotFound)
}

/// A creation, once checked: id, name (trimmed), icon, theme text and version, in that order.
struct Checked<'a> {
    id: &'a str,
    name: &'a str,
    icon: &'a str,
    theme: &'a str,
    theme_version: i64,
}

fn check_new(input: &DashboardNewDto) -> Result<Checked<'_>, DataError> {
    validate::new_id(&input.id)?;
    let name = validate::dashboard_name(&input.name)?;
    let icon = input.icon.as_deref().unwrap_or(validate::DEFAULT_ICON);
    validate::icon(icon)?;
    let (theme, theme_version) = validate::theme(input.theme_json.as_deref(), input.theme_version)?;
    Ok(Checked {
        id: &input.id,
        name,
        icon,
        theme,
        theme_version,
    })
}

fn bind_insert<'q>(
    sql: &'q str,
    c: &'q Checked<'q>,
    now: &'q str,
) -> sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>> {
    sqlx::query(sql)
        .bind(c.id)
        .bind(c.name)
        .bind(c.icon)
        .bind(c.theme)
        .bind(c.theme_version)
        .bind(now)
}

pub(crate) async fn list_dashboards(ctx: &DataCtx) -> Result<Vec<DashboardDto>, DataError> {
    with_conn!(ctx, conn => {
        let rows = sqlx::query_as::<_, Row>(SELECT_ALL_SQL)
            .fetch_all(&mut conn)
            .await?;
        Ok(rows.into_iter().map(to_dto).collect())
    })
}

/// An id that is not well formed designates no row: `None`.
pub(crate) async fn get_dashboard(
    ctx: &DataCtx,
    id: &str,
) -> Result<Option<DashboardDto>, DataError> {
    with_conn!(ctx, conn => fetch(&mut conn, id).await)
}

pub(crate) async fn create_dashboard(
    ctx: &DataCtx,
    input: &DashboardNewDto,
) -> Result<DashboardDto, DataError> {
    ctx.ensure_writable()?;
    let checked = check_new(input)?;
    let now = ctx.now();
    with_conn!(ctx, conn => {
        let mut tx = conn.begin_with("BEGIN IMMEDIATE").await?;
        // The insert comes first: an existing id is a `Conflict`, whatever the count.
        bind_insert(INSERT_SQL, &checked, &now).execute(&mut *tx).await?;
        let count = sqlx::query_scalar::<_, i64>(COUNT_SQL)
            .fetch_one(&mut *tx)
            .await?;
        if count > MAX_DASHBOARDS {
            tx.rollback().await?;
            return Err(DataError::LimitReached);
        }
        tx.commit().await?;
        must_fetch(&mut conn, checked.id).await
    })
}

/// `true` if the dashboard was created (none existed). One atomic statement. The input is
/// checked even when nothing is inserted.
pub(crate) async fn ensure_default_dashboard(
    ctx: &DataCtx,
    input: &DashboardNewDto,
) -> Result<bool, DataError> {
    ctx.ensure_writable()?;
    let checked = check_new(input)?;
    let now = ctx.now();
    with_conn!(ctx, conn => {
        let result = bind_insert(INSERT_IF_NONE_SQL, &checked, &now)
            .execute(&mut conn)
            .await?;
        Ok(result.rows_affected() > 0)
    })
}

pub(crate) async fn update_dashboard(
    ctx: &DataCtx,
    id: &str,
    name: &str,
    icon: &str,
) -> Result<DashboardDto, DataError> {
    ctx.ensure_writable()?;
    let name = validate::dashboard_name(name)?;
    validate::icon(icon)?;
    let now = ctx.now();
    with_conn!(ctx, conn => {
        let result = sqlx::query(UPDATE_SQL)
            .bind(id)
            .bind(name)
            .bind(icon)
            .bind(&now)
            .execute(&mut conn)
            .await?;
        if result.rows_affected() == 0 {
            return Err(DataError::NotFound);
        }
        must_fetch(&mut conn, id).await
    })
}

pub(crate) async fn update_dashboard_theme(
    ctx: &DataCtx,
    id: &str,
    theme_json: &str,
    theme_version: i64,
) -> Result<DashboardDto, DataError> {
    ctx.ensure_writable()?;
    let (theme, version) = validate::theme(Some(theme_json), Some(theme_version))?;
    let now = ctx.now();
    with_conn!(ctx, conn => {
        let result = sqlx::query(UPDATE_THEME_SQL)
            .bind(id)
            .bind(theme)
            .bind(version)
            .bind(&now)
            .execute(&mut conn)
            .await?;
        if result.rows_affected() == 0 {
            return Err(DataError::NotFound);
        }
        must_fetch(&mut conn, id).await
    })
}

/// T3: creates the "(next)" dashboard and moves the widgets of the source dashboard into it in
/// one transaction. Nothing is created when anything fails.
pub(crate) async fn create_with_widgets(
    ctx: &DataCtx,
    input: &DashboardWithWidgetsDto,
) -> Result<DashboardWithWidgetsResult, DataError> {
    ctx.ensure_writable()?;
    let checked = check_new(&input.dashboard)?;
    if !is_uuid_shape(&input.source_dashboard_id) {
        return Err(DataError::invalid("sourceDashboardId"));
    }
    if input.items.is_empty() {
        return Err(DataError::invalid("items"));
    }
    let max = usize::try_from(MAX_WIDGETS_PER_DASHBOARD).unwrap_or(200);
    validate::check_items(&input.items, max)?;
    let payload = layout_payload(&input.items)?;
    write_with_widgets(ctx, &checked, &input.source_dashboard_id, &payload).await
}

/// The transaction of [`create_with_widgets`], over an already built payload (tests feed it a
/// payload the validation would have refused, to prove the atomicity).
async fn write_with_widgets(
    ctx: &DataCtx,
    checked: &Checked<'_>,
    source: &str,
    payload: &str,
) -> Result<DashboardWithWidgetsResult, DataError> {
    let now = ctx.now();
    with_conn!(ctx, conn => {
        let mut tx = conn.begin_with("BEGIN IMMEDIATE").await?;
        bind_insert(INSERT_SQL, checked, &now).execute(&mut *tx).await?;
        let count = sqlx::query_scalar::<_, i64>(COUNT_SQL)
            .fetch_one(&mut *tx)
            .await?;
        if count > MAX_DASHBOARDS {
            tx.rollback().await?;
            return Err(DataError::LimitReached);
        }
        let moved = sqlx::query(MOVE_TO_NEW_SQL)
            .bind(checked.id)
            .bind(payload)
            .bind(&now)
            .bind(source)
            .execute(&mut *tx)
            .await?
            .rows_affected();
        if moved == 0 {
            // Stale front state (widgets gone or elsewhere): no dashboard is created.
            tx.rollback().await?;
            return Err(DataError::Conflict);
        }
        tx.commit().await?;
        Ok(DashboardWithWidgetsResult {
            dashboard: must_fetch(&mut conn, checked.id).await?,
            moved: u32::try_from(moved).unwrap_or(u32::MAX),
        })
    })
}

/// Test entry of the transaction without the validation of the items.
#[cfg(test)]
pub(crate) async fn create_with_widgets_unchecked(
    ctx: &DataCtx,
    input: &DashboardNewDto,
    source: &str,
    payload: &str,
) -> Result<DashboardWithWidgetsResult, DataError> {
    let checked = check_new(input)?;
    write_with_widgets(ctx, &checked, source, payload).await
}

#[tauri::command]
pub async fn dashboard_list(
    backup: State<'_, BackupState>,
) -> Result<Vec<DashboardDto>, DataError> {
    list_dashboards(&DataCtx::from_backup(&backup)).await
}

#[tauri::command]
pub async fn dashboard_get(
    backup: State<'_, BackupState>,
    id: String,
) -> Result<Option<DashboardDto>, DataError> {
    get_dashboard(&DataCtx::from_backup(&backup), &id).await
}

#[tauri::command]
pub async fn dashboard_create(
    backup: State<'_, BackupState>,
    input: DashboardNewDto,
) -> Result<DashboardDto, DataError> {
    create_dashboard(&DataCtx::from_backup(&backup), &input).await
}

#[tauri::command]
pub async fn dashboard_ensure_default(
    backup: State<'_, BackupState>,
    input: DashboardNewDto,
) -> Result<bool, DataError> {
    ensure_default_dashboard(&DataCtx::from_backup(&backup), &input).await
}

#[tauri::command]
pub async fn dashboard_update(
    backup: State<'_, BackupState>,
    id: String,
    name: String,
    icon: String,
) -> Result<DashboardDto, DataError> {
    update_dashboard(&DataCtx::from_backup(&backup), &id, &name, &icon).await
}

#[tauri::command]
pub async fn dashboard_update_theme(
    backup: State<'_, BackupState>,
    id: String,
    theme_json: String,
    theme_version: i64,
) -> Result<DashboardDto, DataError> {
    update_dashboard_theme(
        &DataCtx::from_backup(&backup),
        &id,
        &theme_json,
        theme_version,
    )
    .await
}

#[tauri::command]
pub async fn dashboard_create_with_widgets(
    backup: State<'_, BackupState>,
    input: DashboardWithWidgetsDto,
) -> Result<DashboardWithWidgetsResult, DataError> {
    create_with_widgets(&DataCtx::from_backup(&backup), &input).await
}
