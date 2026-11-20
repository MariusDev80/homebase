//! The only file with SQL on `habits` and `habit_checks` (spec habits D1). Every value is a bound
//! parameter. Functions take a connection opened by `store::connect_with_timeout` under the
//! module gate. Dates are the stored text forms (`YYYY-MM-DD`, instants from `time::formats`).

use super::error::ScheduleError;
use super::habit::{HabitRow, HabitSchedule};
use sqlx::sqlite::SqliteRow;
use sqlx::{Row, SqliteConnection};

/// A row of `habit_checks` (the identity of a check is `(habit_id, day_on)`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckRow {
    pub habit_id: String,
    pub day_on: String,
}

macro_rules! habit_select {
    ($tail:literal) => {
        concat!(
            "SELECT id, title, kind, days_mask, weekly_target, start_on, archived_at, ",
            "created_at, updated_at ",
            $tail
        )
    };
}

/// `None` for a row written outside the Rust code that the checks should have refused (mask out
/// of bounds, kind and columns out of step): logged by id only, never a panic.
fn habit_from(row: &SqliteRow) -> Result<Option<HabitRow>, ScheduleError> {
    let id: String = row.try_get("id")?;
    let kind: String = row.try_get("kind")?;
    let mask: Option<i64> = row.try_get("days_mask")?;
    let target: Option<i64> = row.try_get("weekly_target")?;
    let schedule = match (kind.as_str(), mask, target) {
        ("days", Some(m), None) => u8::try_from(m)
            .ok()
            .filter(|m| (1..=127).contains(m))
            .map(|mask| HabitSchedule::Days { mask }),
        ("weekly", None, Some(t)) => u8::try_from(t)
            .ok()
            .filter(|t| (1..=7).contains(t))
            .map(|target| HabitSchedule::Weekly { target }),
        _ => None,
    };
    let Some(schedule) = schedule else {
        eprintln!("schedule: unreadable habit {id:?}");
        return Ok(None);
    };
    Ok(Some(HabitRow {
        id,
        title: row.try_get("title")?,
        schedule,
        start_on: row.try_get("start_on")?,
        archived_at: row.try_get("archived_at")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    }))
}

fn schedule_columns(schedule: HabitSchedule) -> (&'static str, Option<i64>, Option<i64>) {
    match schedule {
        HabitSchedule::Days { mask } => ("days", Some(i64::from(mask)), None),
        HabitSchedule::Weekly { target } => ("weekly", None, Some(i64::from(target))),
    }
}

pub async fn insert_habit(
    conn: &mut SqliteConnection,
    row: &HabitRow,
) -> Result<(), ScheduleError> {
    let (kind, mask, target) = schedule_columns(row.schedule);
    sqlx::query(
        "INSERT INTO habits (id, title, kind, days_mask, weekly_target, start_on, archived_at, \
         created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
    )
    .bind(&row.id)
    .bind(&row.title)
    .bind(kind)
    .bind(mask)
    .bind(target)
    .bind(&row.start_on)
    .bind(row.archived_at.as_deref())
    .bind(&row.created_at)
    .bind(&row.updated_at)
    .execute(conn)
    .await?;
    Ok(())
}

pub async fn count_habits(conn: &mut SqliteConnection) -> Result<i64, ScheduleError> {
    Ok(sqlx::query_scalar("SELECT COUNT(*) FROM habits")
        .fetch_one(conn)
        .await?)
}

/// Replaces the title, the schedule, the start and `updated_at` (the rest is kept). `false` if
/// the habit does not exist.
pub async fn replace_habit(
    conn: &mut SqliteConnection,
    row: &HabitRow,
) -> Result<bool, ScheduleError> {
    let (kind, mask, target) = schedule_columns(row.schedule);
    let result = sqlx::query(
        "UPDATE habits SET title = ?2, kind = ?3, days_mask = ?4, weekly_target = ?5, \
         start_on = ?6, updated_at = ?7 WHERE id = ?1",
    )
    .bind(&row.id)
    .bind(&row.title)
    .bind(kind)
    .bind(mask)
    .bind(target)
    .bind(&row.start_on)
    .bind(&row.updated_at)
    .execute(conn)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Archives (`Some(now)`: an existing `archived_at` is kept) or restores (`None`). `false` if the
/// habit does not exist.
pub async fn set_archived(
    conn: &mut SqliteConnection,
    id: &str,
    archived_at: Option<&str>,
    now: &str,
) -> Result<bool, ScheduleError> {
    let result = sqlx::query(
        "UPDATE habits SET archived_at = CASE WHEN ?2 IS NULL THEN NULL \
         ELSE COALESCE(archived_at, ?2) END, \
         updated_at = CASE WHEN (?2 IS NULL) <> (archived_at IS NULL) THEN ?3 ELSE updated_at END \
         WHERE id = ?1",
    )
    .bind(id)
    .bind(archived_at)
    .bind(now)
    .execute(conn)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Deletes a habit; its checks, its reminder and the deliveries of that reminder go with it
/// (cascade). `false` if absent.
pub async fn delete_habit(conn: &mut SqliteConnection, id: &str) -> Result<bool, ScheduleError> {
    let result = sqlx::query("DELETE FROM habits WHERE id = ?1")
        .bind(id)
        .execute(conn)
        .await?;
    Ok(result.rows_affected() > 0)
}

/// `None` if absent or unreadable.
pub async fn get_habit(
    conn: &mut SqliteConnection,
    id: &str,
) -> Result<Option<HabitRow>, ScheduleError> {
    let row = sqlx::query(habit_select!("FROM habits WHERE id = ?1"))
        .bind(id)
        .fetch_optional(conn)
        .await?;
    match row {
        Some(row) => habit_from(&row),
        None => Ok(None),
    }
}

/// Every readable habit, archived ones included, in creation order.
pub async fn list_habits(conn: &mut SqliteConnection) -> Result<Vec<HabitRow>, ScheduleError> {
    let rows = sqlx::query(habit_select!("FROM habits ORDER BY created_at, id"))
        .fetch_all(conn)
        .await?;
    let mut habits = Vec::with_capacity(rows.len());
    for row in &rows {
        if let Some(habit) = habit_from(row)? {
            habits.push(habit);
        }
    }
    Ok(habits)
}

/// Records a check. `false` if the day was already checked (idempotent). The caller has checked
/// that the habit exists.
pub async fn insert_check(
    conn: &mut SqliteConnection,
    habit_id: &str,
    day_on: &str,
    now: &str,
) -> Result<bool, ScheduleError> {
    let result = sqlx::query(
        "INSERT INTO habit_checks (habit_id, day_on, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?3) ON CONFLICT (habit_id, day_on) DO NOTHING",
    )
    .bind(habit_id)
    .bind(day_on)
    .bind(now)
    .execute(conn)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Removes a check. `false` if the day was not checked.
pub async fn delete_check(
    conn: &mut SqliteConnection,
    habit_id: &str,
    day_on: &str,
) -> Result<bool, ScheduleError> {
    let result = sqlx::query("DELETE FROM habit_checks WHERE habit_id = ?1 AND day_on = ?2")
        .bind(habit_id)
        .bind(day_on)
        .execute(conn)
        .await?;
    Ok(result.rows_affected() > 0)
}

/// The checks of every habit with `from <= day_on <= to`, by habit then day, at most `limit`.
pub async fn checks_between(
    conn: &mut SqliteConnection,
    from: &str,
    to: &str,
    limit: i64,
) -> Result<Vec<CheckRow>, ScheduleError> {
    let rows = sqlx::query(
        "SELECT habit_id, day_on FROM habit_checks WHERE day_on BETWEEN ?1 AND ?2 \
         ORDER BY habit_id, day_on LIMIT ?3",
    )
    .bind(from)
    .bind(to)
    .bind(limit)
    .fetch_all(conn)
    .await?;
    rows.iter()
        .map(|row| {
            Ok(CheckRow {
                habit_id: row.try_get("habit_id")?,
                day_on: row.try_get("day_on")?,
            })
        })
        .collect()
}

/// The checked days of one habit with `from <= day_on <= to`, oldest first.
pub async fn checked_days(
    conn: &mut SqliteConnection,
    habit_id: &str,
    from: &str,
    to: &str,
) -> Result<Vec<String>, ScheduleError> {
    Ok(sqlx::query_scalar(
        "SELECT day_on FROM habit_checks WHERE habit_id = ?1 AND day_on BETWEEN ?2 AND ?3 \
         ORDER BY day_on",
    )
    .bind(habit_id)
    .bind(from)
    .bind(to)
    .fetch_all(conn)
    .await?)
}
