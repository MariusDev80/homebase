//! Configuration export / import, Rust side (spec D9, 4.12). The front validates and previews;
//! this module re-checks the structure, takes a `pre-import` safety backup, then replaces the
//! configuration in a single `BEGIN IMMEDIATE` transaction. Every SQL value is a bound parameter.

use super::create::create_backup;
use super::error::{BackupError, ImportProblem};
use super::external::{check_export_destination, recover_orphan_tmp};
use super::fsutil::rename_with_retry;
use super::names::{hb_trim, is_uuid_shape, BackupKind};
use super::paths::DataRoot;
use super::MAX_CONFIG_FILE_BYTES;
use crate::time::clock::Clock;
use crate::time::formats::format_instant;
use serde::Deserialize;
use serde_json::Value;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, SqliteConnection};
use std::ffi::OsString;
use std::fs;
use std::io::{self, Read, Write};
use std::path::Path;
use std::time::Duration;

pub const CONFIG_FORMAT: &str = "homebase/dashboard-config";

const MAX_DASHBOARDS: usize = 100;
const MAX_WIDGETS_PER_DASHBOARD: usize = 200;
const MAX_WIDGETS: usize = 1_000;
const MAX_SETTINGS: usize = 200;
const MAX_NAME_CHARS: usize = 100;
const MAX_WIDGET_TYPE_CHARS: usize = 64;
const MAX_JSON_CHARS: usize = 65_536;
const MAX_GRID: i64 = 10_000;
const MAX_SORT_ORDER: i64 = 1_000_000;
const MAX_CONFIG_VERSION: i64 = 10_000;
const MAX_SETTING_KEY_CHARS: usize = 128;
/// How long the write transaction waits for another writer (the SQL plugin pool of the front).
const WRITE_BUSY_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigImportPlan {
    pub dashboards: Vec<PlanDashboard>,
    pub settings: Vec<PlanSetting>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanDashboard {
    pub id: String,
    pub name: String,
    pub sort_order: i64,
    pub widgets: Vec<PlanWidget>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanWidget {
    pub id: String,
    pub widget_type: String,
    pub grid: PlanGrid,
    /// Serialized JSON object.
    pub config: String,
    pub config_version: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanGrid {
    pub x: i64,
    pub y: i64,
    pub w: i64,
    pub h: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanSetting {
    pub key: String,
    /// Serialized JSON value.
    pub value: String,
}

/// Rows written (upserts), not rows deleted: deletions are counted by the front's preview.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOutcome {
    pub dashboards: u32,
    pub widgets: u32,
    pub settings: u32,
}

fn problem(p: ImportProblem) -> BackupError {
    BackupError::InvalidImport { problem: p }
}

fn char_count(s: &str) -> usize {
    s.chars().count()
}

/// Same as the front's `SECRET_KEY_PATTERN`, written by hand (no `regex`): a key is secret when it
/// contains one of the markers, case-insensitively.
pub fn is_secret_setting_key(key: &str) -> bool {
    const MARKERS: [&str; 9] = [
        "secret",
        "token",
        "password",
        "passwd",
        "credential",
        "apikey",
        "api_key",
        "api-key",
        "api.key",
    ];
    let lower = key.to_lowercase();
    MARKERS.iter().any(|m| lower.contains(m))
}

/// `^[a-z][a-z0-9._-]{0,127}$`
fn is_setting_key_shape(key: &str) -> bool {
    let mut chars = key.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    first.is_ascii_lowercase()
        && key.len() <= MAX_SETTING_KEY_CHARS
        && chars
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-'))
}

fn json_within_limit(text: &str) -> Option<Value> {
    if char_count(text) > MAX_JSON_CHARS {
        return None;
    }
    serde_json::from_str(text).ok()
}

/// Pure structural validation (spec 4.12 step 1). Nothing is written, nothing is created.
pub fn validate_plan(plan: &ConfigImportPlan) -> Result<(), BackupError> {
    if plan.dashboards.is_empty() {
        return Err(problem(ImportProblem::NoDashboard));
    }
    if plan.dashboards.len() > MAX_DASHBOARDS {
        return Err(problem(ImportProblem::TooManyDashboards));
    }
    if plan.settings.len() > MAX_SETTINGS {
        return Err(problem(ImportProblem::TooManySettings));
    }
    let total_widgets: usize = plan.dashboards.iter().map(|d| d.widgets.len()).sum();
    if total_widgets > MAX_WIDGETS {
        return Err(problem(ImportProblem::TooManyWidgets));
    }
    let mut dashboard_ids = std::collections::HashSet::new();
    let mut widget_ids = std::collections::HashSet::new();
    for dashboard in &plan.dashboards {
        if !is_uuid_shape(&dashboard.id) {
            return Err(problem(ImportProblem::InvalidId));
        }
        if !dashboard_ids.insert(dashboard.id.as_str()) {
            return Err(problem(ImportProblem::DuplicateId));
        }
        let name_len = char_count(&dashboard.name);
        if name_len == 0
            || name_len > MAX_NAME_CHARS
            || dashboard.name.contains('\0')
            || dashboard.name != hb_trim(&dashboard.name)
        {
            return Err(problem(ImportProblem::InvalidName));
        }
        if !(0..=MAX_SORT_ORDER).contains(&dashboard.sort_order) {
            return Err(problem(ImportProblem::InvalidSortOrder));
        }
        if dashboard.widgets.len() > MAX_WIDGETS_PER_DASHBOARD {
            return Err(problem(ImportProblem::TooManyWidgets));
        }
        for widget in &dashboard.widgets {
            if !is_uuid_shape(&widget.id) {
                return Err(problem(ImportProblem::InvalidId));
            }
            if !widget_ids.insert(widget.id.as_str()) {
                return Err(problem(ImportProblem::DuplicateId));
            }
            let type_len = char_count(&widget.widget_type);
            if type_len == 0
                || type_len > MAX_WIDGET_TYPE_CHARS
                || widget.widget_type.contains('\0')
            {
                return Err(problem(ImportProblem::InvalidWidgetType));
            }
            let g = widget.grid;
            let origin_ok = (0..=MAX_GRID).contains(&g.x) && (0..=MAX_GRID).contains(&g.y);
            let size_ok = (1..=MAX_GRID).contains(&g.w) && (1..=MAX_GRID).contains(&g.h);
            if !origin_ok || !size_ok {
                return Err(problem(ImportProblem::InvalidGrid));
            }
            if !(1..=MAX_CONFIG_VERSION).contains(&widget.config_version) {
                return Err(problem(ImportProblem::InvalidConfigVersion));
            }
            match json_within_limit(&widget.config) {
                Some(Value::Object(_)) => {}
                _ => return Err(problem(ImportProblem::InvalidConfig)),
            }
        }
    }
    if widget_ids.len() > MAX_WIDGETS {
        return Err(problem(ImportProblem::TooManyWidgets));
    }
    let mut keys = std::collections::HashSet::new();
    for setting in &plan.settings {
        if is_secret_setting_key(&setting.key) {
            return Err(problem(ImportProblem::SecretSetting));
        }
        if !is_setting_key_shape(&setting.key) {
            return Err(problem(ImportProblem::InvalidSettingKey));
        }
        if !keys.insert(setting.key.as_str()) {
            return Err(problem(ImportProblem::DuplicateId));
        }
        if json_within_limit(&setting.value).is_none() {
            return Err(problem(ImportProblem::InvalidSettingValue));
        }
    }
    Ok(())
}

/// SQLite primary code 19 (`SQLITE_CONSTRAINT`) is in the low byte of every extended code.
fn map_write_error(e: sqlx::Error) -> BackupError {
    let constraint = e
        .as_database_error()
        .and_then(|d| d.code())
        .and_then(|c| c.parse::<i64>().ok())
        .is_some_and(|code| code & 0xff == 19);
    if constraint {
        eprintln!("backup: config import rejected by a constraint: {e}");
        return problem(ImportProblem::Constraint);
    }
    e.into()
}

const UPSERT_DASHBOARD: &str = "INSERT INTO dashboards (id, name, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4) \
ON CONFLICT (id) DO UPDATE SET name = excluded.name, sort_order = excluded.sort_order, updated_at = excluded.updated_at";
const DELETE_OTHER_TYPE: &str = "DELETE FROM widget_instances WHERE id = ?1 AND widget_type <> ?2";
const UPSERT_WIDGET: &str = "INSERT INTO widget_instances (id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h, config, config_version, created_at, updated_at) \
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10) \
ON CONFLICT (id) DO UPDATE SET dashboard_id = excluded.dashboard_id, widget_type = excluded.widget_type, \
grid_x = excluded.grid_x, grid_y = excluded.grid_y, grid_w = excluded.grid_w, grid_h = excluded.grid_h, \
config = excluded.config, config_version = excluded.config_version, updated_at = excluded.updated_at";
const DELETE_ABSENT_WIDGETS: &str =
    "DELETE FROM widget_instances WHERE id NOT IN (SELECT value FROM json_each(?1))";
const DELETE_ABSENT_DASHBOARDS: &str =
    "DELETE FROM dashboards WHERE id NOT IN (SELECT value FROM json_each(?1))";
const UPSERT_SETTING: &str =
    "INSERT INTO settings (key, value, created_at, updated_at) VALUES (?1, ?2, ?3, ?3) \
ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at";

/// Replaces the configuration inside one `BEGIN IMMEDIATE` transaction. Order matters (spec
/// 4.12): upsert dashboards, then per instance delete-if-type-differs and upsert (this moves an
/// instance away from a dashboard about to disappear), then delete absent instances, then absent
/// dashboards. The plan is not re-validated here.
pub async fn write_plan(
    db: &Path,
    plan: &ConfigImportPlan,
    now: &str,
    busy_timeout: Duration,
) -> Result<ImportOutcome, BackupError> {
    let options = SqliteConnectOptions::new()
        .filename(db)
        .create_if_missing(false)
        .busy_timeout(busy_timeout)
        .foreign_keys(true);
    let mut conn = SqliteConnection::connect_with(&options).await?;
    let result = write_in_transaction(db, &mut conn, plan, now).await;
    // The transaction is already committed or rolled back: a close error changes nothing.
    if let Err(e) = conn.close().await {
        eprintln!("backup: closing the config import connection failed: {e}");
    }
    result
}

/// Test seam: async hook run right after `BEGIN IMMEDIATE`, keyed by database path.
#[cfg(test)]
pub(super) type AfterBeginHook =
    fn(std::path::PathBuf) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>>;
#[cfg(test)]
pub(super) static AFTER_BEGIN: std::sync::Mutex<Option<(std::path::PathBuf, AfterBeginHook)>> =
    std::sync::Mutex::new(None);

async fn write_in_transaction(
    db: &Path,
    conn: &mut SqliteConnection,
    plan: &ConfigImportPlan,
    now: &str,
) -> Result<ImportOutcome, BackupError> {
    let mut tx = conn.begin_with("BEGIN IMMEDIATE").await?;
    #[cfg(test)]
    {
        let hook = AFTER_BEGIN
            .lock()
            .ok()
            .and_then(|g| g.as_ref().filter(|(p, _)| p == db).map(|(_, h)| *h));
        if let Some(hook) = hook {
            hook(db.to_path_buf()).await;
        }
    }
    #[cfg(not(test))]
    let _ = db;
    let outcome = match run_statements(&mut tx, plan, now).await {
        Ok(outcome) => outcome,
        Err(e) => {
            if let Err(rollback) = tx.rollback().await {
                eprintln!("backup: rollback of the config import failed: {rollback}");
            }
            return Err(e);
        }
    };
    tx.commit().await?;
    Ok(outcome)
}

async fn run_statements(
    conn: &mut SqliteConnection,
    plan: &ConfigImportPlan,
    now: &str,
) -> Result<ImportOutcome, BackupError> {
    let mut written = ImportOutcome {
        dashboards: 0,
        widgets: 0,
        settings: 0,
    };
    for dashboard in &plan.dashboards {
        let done = sqlx::query(UPSERT_DASHBOARD)
            .bind(&dashboard.id)
            .bind(&dashboard.name)
            .bind(dashboard.sort_order)
            .bind(now)
            .execute(&mut *conn)
            .await
            .map_err(map_write_error)?;
        written.dashboards += done.rows_affected() as u32;
    }
    let mut widget_ids: Vec<&str> = Vec::new();
    for dashboard in &plan.dashboards {
        for widget in &dashboard.widgets {
            widget_ids.push(&widget.id);
            sqlx::query(DELETE_OTHER_TYPE)
                .bind(&widget.id)
                .bind(&widget.widget_type)
                .execute(&mut *conn)
                .await
                .map_err(map_write_error)?;
            let done = sqlx::query(UPSERT_WIDGET)
                .bind(&widget.id)
                .bind(&dashboard.id)
                .bind(&widget.widget_type)
                .bind(widget.grid.x)
                .bind(widget.grid.y)
                .bind(widget.grid.w)
                .bind(widget.grid.h)
                .bind(&widget.config)
                .bind(widget.config_version)
                .bind(now)
                .execute(&mut *conn)
                .await
                .map_err(map_write_error)?;
            written.widgets += done.rows_affected() as u32;
        }
    }
    let widget_list = serde_json::to_string(&widget_ids).map_err(|_| BackupError::Io {
        code: "serialize".into(),
    })?;
    sqlx::query(DELETE_ABSENT_WIDGETS)
        .bind(widget_list)
        .execute(&mut *conn)
        .await
        .map_err(map_write_error)?;
    let dashboard_ids: Vec<&str> = plan.dashboards.iter().map(|d| d.id.as_str()).collect();
    let dashboard_list = serde_json::to_string(&dashboard_ids).map_err(|_| BackupError::Io {
        code: "serialize".into(),
    })?;
    sqlx::query(DELETE_ABSENT_DASHBOARDS)
        .bind(dashboard_list)
        .execute(&mut *conn)
        .await
        .map_err(map_write_error)?;
    for setting in &plan.settings {
        let done = sqlx::query(UPSERT_SETTING)
            .bind(&setting.key)
            .bind(&setting.value)
            .bind(now)
            .execute(&mut *conn)
            .await
            .map_err(map_write_error)?;
        written.settings += done.rows_affected() as u32;
    }
    Ok(written)
}

/// The caller holds the backup lock. Validation, then the `pre-import` backup (database only; its
/// failure cancels the import), then the transaction.
pub async fn apply_config_import(
    root: &DataRoot,
    clock: &dyn Clock,
    plan: &ConfigImportPlan,
) -> Result<ImportOutcome, BackupError> {
    apply_config_import_with(root, clock, plan, WRITE_BUSY_TIMEOUT).await
}

pub async fn apply_config_import_with(
    root: &DataRoot,
    clock: &dyn Clock,
    plan: &ConfigImportPlan,
    busy_timeout: Duration,
) -> Result<ImportOutcome, BackupError> {
    validate_plan(plan)?;
    create_backup(root, clock, BackupKind::PreImport, &[]).await?;
    let now = format_instant(clock.now());
    write_plan(&root.db(), plan, &now, busy_timeout).await
}

/// Parses `text` as a JSON object whose `format` is `homebase/dashboard-config`.
fn parse_config_object(text: &str) -> Result<serde_json::Map<String, Value>, BackupError> {
    match serde_json::from_str::<Value>(text) {
        Ok(Value::Object(map))
            if map.get("format").and_then(Value::as_str) == Some(CONFIG_FORMAT) =>
        {
            Ok(map)
        }
        _ => Err(problem(ImportProblem::NotConfig)),
    }
}

/// Export check (spec 4.12): size, envelope `format`, no secret key in `settings`.
pub fn check_config_export(contents: &str) -> Result<(), BackupError> {
    if contents.len() as u64 > MAX_CONFIG_FILE_BYTES {
        return Err(BackupError::TooLarge);
    }
    let map = parse_config_object(contents)?;
    let Some(Value::Object(settings)) = map.get("settings") else {
        return Err(problem(ImportProblem::NotConfig));
    };
    if settings.keys().any(|k| is_secret_setting_key(k)) {
        return Err(problem(ImportProblem::SecretSetting));
    }
    Ok(())
}

/// Import check at selection time (spec 4.12): only the envelope `format`.
pub fn check_config_import_text(text: &str) -> Result<(), BackupError> {
    parse_config_object(text).map(|_| ())
}

/// Reads the file chosen by the user: at most `MAX_CONFIG_FILE_BYTES` (read bounded, never more
/// than one extra byte), UTF-8, leading BOM removed. Blocking.
pub fn read_config_file(path: &Path) -> Result<String, BackupError> {
    let file = fs::File::open(path)?;
    let mut bytes = Vec::new();
    file.take(MAX_CONFIG_FILE_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_CONFIG_FILE_BYTES {
        return Err(BackupError::TooLarge);
    }
    let text = String::from_utf8(bytes).map_err(|_| problem(ImportProblem::NotUtf8))?;
    Ok(text
        .strip_prefix('\u{FEFF}')
        .map(str::to_owned)
        .unwrap_or(text))
}

/// Writes `contents` to `dest` (chosen in the save dialog) through `.<name>.homebase-tmp`, then
/// renames it over `dest`. `dest` must be a `.json` outside the data root. Blocking.
pub fn write_config_to(root: &DataRoot, dest: &Path, contents: &str) -> Result<(), BackupError> {
    check_export_destination(root, dest, "json")?;
    let mut tmp_name = OsString::from(".");
    tmp_name.push(
        dest.file_name()
            .ok_or_else(|| io::Error::from(io::ErrorKind::InvalidInput))?,
    );
    tmp_name.push(".homebase-tmp");
    let tmp = dest.with_file_name(tmp_name);
    recover_orphan_tmp(&tmp)?;
    let result = (|| -> io::Result<()> {
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)?;
        output.write_all(contents.as_bytes())?;
        output.sync_all()?;
        drop(output);
        rename_with_retry(&tmp, dest)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result.map_err(BackupError::from)
}
