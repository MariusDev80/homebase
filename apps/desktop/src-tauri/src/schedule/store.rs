//! The only file with SQL on `reminders`, `reminder_deliveries` and `time_sessions` (spec D2).
//! Every value is a bound parameter. Functions take a connection: the caller (tick, commands)
//! opens one per operation with [`connect`] under the module gate (D3) and closes it with
//! [`close`]. Instants are the stored text form (`time::formats`); this file only stores them.

use super::error::ScheduleError;
use super::reminder::{Outcome, ReminderRow};
use super::session::{SessionKind, SessionRow};
use sqlx::sqlite::{SqliteConnectOptions, SqliteRow};
use sqlx::{Connection, Row, SqliteConnection};
use std::path::Path;
use std::time::Duration;

const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

/// A dedicated connection (D3): never creates the file, waits for a busy database, enforces
/// foreign keys (the delivery cascade).
pub async fn connect(db: &Path) -> Result<SqliteConnection, ScheduleError> {
    let options = SqliteConnectOptions::new()
        .filename(db)
        .create_if_missing(false)
        .busy_timeout(BUSY_TIMEOUT)
        .foreign_keys(true);
    Ok(SqliteConnection::connect_with(&options).await?)
}

pub async fn close(conn: SqliteConnection) {
    // The statements are already committed or failed: a close error changes nothing.
    if conn.close().await.is_err() {
        eprintln!("schedule: closing a database connection failed");
    }
}

/// A row of `reminder_deliveries`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeliveryRow {
    pub reminder_id: String,
    pub occurrence_key: String,
    pub due_at: String,
    pub outcome: Outcome,
    pub skipped_count: u32,
    pub seen_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// An unseen delivery joined with its reminder's title and time zone.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnseenDelivery {
    pub reminder_id: String,
    pub title: String,
    pub time_zone: String,
    pub occurrence_key: String,
    pub due_at: String,
    pub outcome: Outcome,
    pub skipped_count: u32,
    pub seen_at: Option<String>,
    pub created_at: String,
}

/// Which deliveries `mark_seen` touches.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeenTarget<'a> {
    All,
    One {
        reminder_id: &'a str,
        occurrence_key: &'a str,
    },
}

/// Keyset cursor of the session history: `(started_at, id)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HistoryCursor<'a> {
    pub started_at: &'a str,
    pub id: &'a str,
}

macro_rules! reminder_select {
    ($tail:literal) => {
        concat!(
            "SELECT id, title, start_local, time_zone, rrule, exdates, enabled, ",
            "next_fire_at, next_fire_key, created_at, updated_at ",
            $tail
        )
    };
}

macro_rules! session_select {
    ($tail:literal) => {
        concat!(
            "SELECT id, kind, label, started_at, ends_at, ended_at, end_reason, ",
            "created_at, updated_at ",
            $tail
        )
    };
}

fn corrupt() -> ScheduleError {
    eprintln!("schedule: unreadable row");
    ScheduleError::Database
}

fn reminder_from(row: &SqliteRow) -> Result<ReminderRow, ScheduleError> {
    Ok(ReminderRow {
        id: row.try_get("id")?,
        title: row.try_get("title")?,
        start_local: row.try_get("start_local")?,
        time_zone: row.try_get("time_zone")?,
        rrule: row.try_get("rrule")?,
        exdates: row.try_get("exdates")?,
        enabled: row.try_get::<i64, _>("enabled")? != 0,
        next_fire_at: row.try_get("next_fire_at")?,
        next_fire_key: row.try_get("next_fire_key")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn session_from(row: &SqliteRow) -> Result<SessionRow, ScheduleError> {
    let kind: String = row.try_get("kind")?;
    Ok(SessionRow {
        id: row.try_get("id")?,
        kind: SessionKind::from_sql(&kind).ok_or_else(corrupt)?,
        label: row.try_get("label")?,
        started_at: row.try_get("started_at")?,
        ends_at: row.try_get("ends_at")?,
        ended_at: row.try_get("ended_at")?,
        end_reason: row.try_get("end_reason")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn delivery_from(row: &SqliteRow) -> Result<DeliveryRow, ScheduleError> {
    let outcome: String = row.try_get("outcome")?;
    let skipped: i64 = row.try_get("skipped_count")?;
    Ok(DeliveryRow {
        reminder_id: row.try_get("reminder_id")?,
        occurrence_key: row.try_get("occurrence_key")?,
        due_at: row.try_get("due_at")?,
        outcome: Outcome::from_sql(&outcome).ok_or_else(corrupt)?,
        skipped_count: u32::try_from(skipped).map_err(|_| corrupt())?,
        seen_at: row.try_get("seen_at")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn unseen_from(row: &SqliteRow) -> Result<UnseenDelivery, ScheduleError> {
    let outcome: String = row.try_get("outcome")?;
    let skipped: i64 = row.try_get("skipped_count")?;
    Ok(UnseenDelivery {
        reminder_id: row.try_get("reminder_id")?,
        title: row.try_get("title")?,
        time_zone: row.try_get("time_zone")?,
        occurrence_key: row.try_get("occurrence_key")?,
        due_at: row.try_get("due_at")?,
        outcome: Outcome::from_sql(&outcome).ok_or_else(corrupt)?,
        skipped_count: u32::try_from(skipped).map_err(|_| corrupt())?,
        seen_at: row.try_get("seen_at")?,
        created_at: row.try_get("created_at")?,
    })
}

// ---------------------------------------------------------------------------------------------
// reminders
// ---------------------------------------------------------------------------------------------

pub async fn insert_reminder(
    conn: &mut SqliteConnection,
    row: &ReminderRow,
) -> Result<(), ScheduleError> {
    sqlx::query(
        "INSERT INTO reminders (id, title, start_local, time_zone, rrule, exdates, enabled, \
         next_fire_at, next_fire_key, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
    )
    .bind(&row.id)
    .bind(&row.title)
    .bind(&row.start_local)
    .bind(&row.time_zone)
    .bind(row.rrule.as_deref())
    .bind(&row.exdates)
    .bind(i64::from(row.enabled))
    .bind(row.next_fire_at.as_deref())
    .bind(row.next_fire_key.as_deref())
    .bind(&row.created_at)
    .bind(&row.updated_at)
    .execute(conn)
    .await?;
    Ok(())
}

/// Replaces the editable fields and the cache of a reminder (`created_at` is kept). `false` if
/// the reminder does not exist.
pub async fn replace_reminder(
    conn: &mut SqliteConnection,
    row: &ReminderRow,
) -> Result<bool, ScheduleError> {
    let result = sqlx::query(
        "UPDATE reminders SET title = ?2, start_local = ?3, time_zone = ?4, rrule = ?5, \
         exdates = ?6, enabled = ?7, next_fire_at = ?8, next_fire_key = ?9, updated_at = ?10 \
         WHERE id = ?1",
    )
    .bind(&row.id)
    .bind(&row.title)
    .bind(&row.start_local)
    .bind(&row.time_zone)
    .bind(row.rrule.as_deref())
    .bind(&row.exdates)
    .bind(i64::from(row.enabled))
    .bind(row.next_fire_at.as_deref())
    .bind(row.next_fire_key.as_deref())
    .bind(&row.updated_at)
    .execute(conn)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Deletes a reminder; its deliveries go with it (cascade). `false` if absent.
pub async fn delete_reminder(conn: &mut SqliteConnection, id: &str) -> Result<bool, ScheduleError> {
    let result = sqlx::query("DELETE FROM reminders WHERE id = ?1")
        .bind(id)
        .execute(conn)
        .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn get_reminder(
    conn: &mut SqliteConnection,
    id: &str,
) -> Result<Option<ReminderRow>, ScheduleError> {
    let row = sqlx::query(reminder_select!("FROM reminders WHERE id = ?1"))
        .bind(id)
        .fetch_optional(conn)
        .await?;
    row.as_ref().map(reminder_from).transpose()
}

/// All reminders: scheduled first by next occurrence, then the others by title.
pub async fn list_reminders(
    conn: &mut SqliteConnection,
) -> Result<Vec<ReminderRow>, ScheduleError> {
    let rows = sqlx::query(reminder_select!(
        "FROM reminders \
         ORDER BY next_fire_at IS NULL, next_fire_at, title COLLATE NOCASE, id"
    ))
    .fetch_all(conn)
    .await?;
    rows.iter().map(reminder_from).collect()
}

pub async fn count_reminders(conn: &mut SqliteConnection) -> Result<i64, ScheduleError> {
    Ok(sqlx::query_scalar("SELECT COUNT(*) FROM reminders")
        .fetch_one(conn)
        .await?)
}

/// Enabled reminders whose cached next occurrence is `<= now`, oldest first.
pub async fn due_reminders(
    conn: &mut SqliteConnection,
    now: &str,
    limit: i64,
) -> Result<Vec<ReminderRow>, ScheduleError> {
    let rows = sqlx::query(reminder_select!(
        "FROM reminders \
         WHERE enabled = 1 AND next_fire_at IS NOT NULL AND next_fire_at <= ?1 \
         ORDER BY next_fire_at, id LIMIT ?2"
    ))
    .bind(now)
    .bind(limit)
    .fetch_all(conn)
    .await?;
    rows.iter().map(reminder_from).collect()
}

/// Every enabled reminder (startup safety net: the cache is recomputed for all of them).
pub async fn enabled_reminders(
    conn: &mut SqliteConnection,
) -> Result<Vec<ReminderRow>, ScheduleError> {
    let rows = sqlx::query(reminder_select!(
        "FROM reminders WHERE enabled = 1 ORDER BY id"
    ))
    .fetch_all(conn)
    .await?;
    rows.iter().map(reminder_from).collect()
}

/// Compare-and-write of the cache: only if `next_fire_at` still equals `expected`. `updated_at`
/// is left alone (the cache is not a user edit). Returns the rows changed.
pub async fn write_cache(
    conn: &mut SqliteConnection,
    id: &str,
    expected: Option<&str>,
    next: Option<(&str, &str)>,
) -> Result<u64, ScheduleError> {
    let result = sqlx::query(
        "UPDATE reminders SET next_fire_at = ?2, next_fire_key = ?3 \
         WHERE id = ?1 AND next_fire_at IS ?4",
    )
    .bind(id)
    .bind(next.map(|(at, _)| at))
    .bind(next.map(|(_, key)| key))
    .bind(expected)
    .execute(conn)
    .await?;
    Ok(result.rows_affected())
}

/// One transaction (`BEGIN IMMEDIATE`): records the delivery (if any) and advances the cache
/// (D5). Returns `true` when the delivery row was created by this call (so the caller may show
/// its toast), `false` when it already existed, when there was no delivery, or when the cache
/// no longer held `expected` (then nothing is written).
pub async fn record_firing(
    conn: &mut SqliteConnection,
    reminder_id: &str,
    expected: Option<&str>,
    delivery: Option<&DeliveryRow>,
    next: Option<(&str, &str)>,
) -> Result<bool, ScheduleError> {
    let mut tx = conn.begin_with("BEGIN IMMEDIATE").await?;
    // Compare-and-write first: a reminder that was deleted or whose cache moved writes nothing.
    let changed = write_cache(&mut tx, reminder_id, expected, next).await?;
    if changed == 0 {
        tx.rollback().await?;
        return Ok(false);
    }
    let inserted = match delivery {
        Some(d) => {
            sqlx::query(
                "INSERT INTO reminder_deliveries (reminder_id, occurrence_key, due_at, outcome, \n                 skipped_count, seen_at, created_at, updated_at) \n                 VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?6) \n                 ON CONFLICT (reminder_id, occurrence_key) DO NOTHING",
            )
            .bind(&d.reminder_id)
            .bind(&d.occurrence_key)
            .bind(&d.due_at)
            .bind(d.outcome.as_sql())
            .bind(i64::from(d.skipped_count))
            .bind(&d.created_at)
            .execute(&mut *tx)
            .await?
            .rows_affected()
                > 0
        }
        None => false,
    };
    tx.commit().await?;
    Ok(inserted)
}

// ---------------------------------------------------------------------------------------------
// deliveries
// ---------------------------------------------------------------------------------------------

pub async fn get_delivery(
    conn: &mut SqliteConnection,
    reminder_id: &str,
    occurrence_key: &str,
) -> Result<Option<DeliveryRow>, ScheduleError> {
    let row = sqlx::query(
        "SELECT reminder_id, occurrence_key, due_at, outcome, skipped_count, seen_at, \
         created_at, updated_at FROM reminder_deliveries \
         WHERE reminder_id = ?1 AND occurrence_key = ?2",
    )
    .bind(reminder_id)
    .bind(occurrence_key)
    .fetch_optional(conn)
    .await?;
    row.as_ref().map(delivery_from).transpose()
}

pub async fn unseen_deliveries(
    conn: &mut SqliteConnection,
    limit: i64,
) -> Result<Vec<UnseenDelivery>, ScheduleError> {
    let rows = sqlx::query(
        "SELECT d.reminder_id, r.title, r.time_zone, d.occurrence_key, d.due_at, d.outcome, \
         d.skipped_count, d.seen_at, d.created_at \
         FROM reminder_deliveries d JOIN reminders r ON r.id = d.reminder_id \
         WHERE d.seen_at IS NULL \
         ORDER BY d.created_at DESC, d.reminder_id, d.occurrence_key LIMIT ?1",
    )
    .bind(limit)
    .fetch_all(conn)
    .await?;
    rows.iter().map(unseen_from).collect()
}

/// Marks unseen deliveries as seen; returns the number of rows changed.
pub async fn mark_seen(
    conn: &mut SqliteConnection,
    target: SeenTarget<'_>,
    now: &str,
) -> Result<u64, ScheduleError> {
    let (reminder_id, occurrence_key) = match target {
        SeenTarget::All => (None, None),
        SeenTarget::One {
            reminder_id,
            occurrence_key,
        } => (Some(reminder_id), Some(occurrence_key)),
    };
    let result = sqlx::query(
        "UPDATE reminder_deliveries SET seen_at = ?1, updated_at = ?1 \
         WHERE seen_at IS NULL AND (?2 IS NULL OR (reminder_id = ?2 AND occurrence_key = ?3))",
    )
    .bind(now)
    .bind(reminder_id)
    .bind(occurrence_key)
    .execute(conn)
    .await?;
    Ok(result.rows_affected())
}

// ---------------------------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------------------------

/// Inserts a new running session inside a `BEGIN IMMEDIATE` transaction after checking the
/// bounds: at most `max_running` running sessions (`LimitReached`) and a single running
/// pomodoro (`AlreadyRunning`). An existing id gives `Conflict`.
pub async fn insert_session(
    conn: &mut SqliteConnection,
    row: &SessionRow,
    max_running: i64,
) -> Result<(), ScheduleError> {
    let mut tx = conn.begin_with("BEGIN IMMEDIATE").await?;
    let running: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM time_sessions WHERE ended_at IS NULL")
            .fetch_one(&mut *tx)
            .await?;
    if running >= max_running {
        return Err(ScheduleError::LimitReached);
    }
    if row.kind.is_pomodoro() {
        let pomodoros: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM time_sessions WHERE ended_at IS NULL AND kind IN \
             ('pomodoro_work', 'pomodoro_short_break', 'pomodoro_long_break')",
        )
        .fetch_one(&mut *tx)
        .await?;
        if pomodoros > 0 {
            return Err(ScheduleError::AlreadyRunning);
        }
    }
    sqlx::query(
        "INSERT INTO time_sessions (id, kind, label, started_at, ends_at, ended_at, end_reason, \
         created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
    )
    .bind(&row.id)
    .bind(row.kind.as_sql())
    .bind(&row.label)
    .bind(&row.started_at)
    .bind(row.ends_at.as_deref())
    .bind(row.ended_at.as_deref())
    .bind(row.end_reason.as_deref())
    .bind(&row.created_at)
    .bind(&row.updated_at)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

pub async fn get_session(
    conn: &mut SqliteConnection,
    id: &str,
) -> Result<Option<SessionRow>, ScheduleError> {
    let row = sqlx::query(session_select!("FROM time_sessions WHERE id = ?1"))
        .bind(id)
        .fetch_optional(conn)
        .await?;
    row.as_ref().map(session_from).transpose()
}

pub async fn list_running_sessions(
    conn: &mut SqliteConnection,
) -> Result<Vec<SessionRow>, ScheduleError> {
    let rows = sqlx::query(session_select!(
        "FROM time_sessions WHERE ended_at IS NULL \
         ORDER BY started_at, id"
    ))
    .fetch_all(conn)
    .await?;
    rows.iter().map(session_from).collect()
}

/// Finished sessions, newest first, after `before` (exclusive) when given.
pub async fn session_history(
    conn: &mut SqliteConnection,
    before: Option<HistoryCursor<'_>>,
    limit: i64,
) -> Result<Vec<SessionRow>, ScheduleError> {
    let rows = sqlx::query(session_select!(
        "FROM time_sessions \
         WHERE ended_at IS NOT NULL \
         AND (?1 IS NULL OR started_at < ?1 OR (started_at = ?1 AND id < ?2)) \
         ORDER BY started_at DESC, id DESC LIMIT ?3"
    ))
    .bind(before.map(|c| c.started_at))
    .bind(before.map(|c| c.id))
    .bind(limit)
    .fetch_all(conn)
    .await?;
    rows.iter().map(session_from).collect()
}

/// Running countdowns and pomodoro phases whose `ends_at` is `<= now`, oldest first.
pub async fn due_sessions(
    conn: &mut SqliteConnection,
    now: &str,
    limit: i64,
) -> Result<Vec<SessionRow>, ScheduleError> {
    let rows = sqlx::query(session_select!(
        "FROM time_sessions \
         WHERE ended_at IS NULL AND ends_at IS NOT NULL AND ends_at <= ?1 \
         ORDER BY ends_at, id LIMIT ?2"
    ))
    .bind(now)
    .bind(limit)
    .fetch_all(conn)
    .await?;
    rows.iter().map(session_from).collect()
}

/// Completes a running session at its own `ends_at`. `false` if it was not running (so the
/// caller shows no toast).
pub async fn complete_session(
    conn: &mut SqliteConnection,
    id: &str,
    now: &str,
) -> Result<bool, ScheduleError> {
    let result = sqlx::query(
        "UPDATE time_sessions SET ended_at = ends_at, end_reason = 'completed', updated_at = ?2 \
         WHERE id = ?1 AND ended_at IS NULL AND ends_at IS NOT NULL",
    )
    .bind(id)
    .bind(now)
    .execute(conn)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Stops a running session at `ended_at`. `false` if it was not running.
pub async fn stop_session(
    conn: &mut SqliteConnection,
    id: &str,
    ended_at: &str,
    now: &str,
) -> Result<bool, ScheduleError> {
    let result = sqlx::query(
        "UPDATE time_sessions SET ended_at = ?2, end_reason = 'stopped', updated_at = ?3 \
         WHERE id = ?1 AND ended_at IS NULL",
    )
    .bind(id)
    .bind(ended_at)
    .bind(now)
    .execute(conn)
    .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn rename_session(
    conn: &mut SqliteConnection,
    id: &str,
    label: &str,
    now: &str,
) -> Result<bool, ScheduleError> {
    let result = sqlx::query("UPDATE time_sessions SET label = ?2, updated_at = ?3 WHERE id = ?1")
        .bind(id)
        .bind(label)
        .bind(now)
        .execute(conn)
        .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn delete_session(conn: &mut SqliteConnection, id: &str) -> Result<bool, ScheduleError> {
    let result = sqlx::query("DELETE FROM time_sessions WHERE id = ?1")
        .bind(id)
        .execute(conn)
        .await?;
    Ok(result.rows_affected() > 0)
}

// ---------------------------------------------------------------------------------------------
// next wake-up
// ---------------------------------------------------------------------------------------------

/// Earliest of the next reminder occurrence and the next running session end.
pub async fn next_due(conn: &mut SqliteConnection) -> Result<Option<String>, ScheduleError> {
    Ok(sqlx::query_scalar(
        "SELECT MIN(t) FROM (\
         SELECT MIN(next_fire_at) AS t FROM reminders WHERE next_fire_at IS NOT NULL \
         UNION ALL \
         SELECT MIN(ends_at) FROM time_sessions WHERE ended_at IS NULL AND ends_at IS NOT NULL)",
    )
    .fetch_one(conn)
    .await?)
}
