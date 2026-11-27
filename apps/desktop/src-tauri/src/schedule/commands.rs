//! The twelve Tauri commands of the schedule module (spec 4.4). Every input comes from the
//! WebView: sizes and numbers are bounded before any conversion, calculation or disk access. Each
//! command is a thin wrapper over a `pub(crate)` business function that takes the
//! [`SchedulerCtx`], so the logic is tested without Tauri. A command that changes a deadline wakes
//! the scheduler thread after its commit.

use super::error::ScheduleError;
use super::notice::Notice;
use super::reminder::{next_fire, status_of, ReminderRow, ReminderStatus};
use super::session::{check_duration, SessionKind, SessionRow};
use super::store::{self, HistoryCursor, SeenTarget, UnseenDelivery};
use super::text::{check_id, check_label, check_title};
use super::tick::{cache_of, settle_due, show_notices, Cache, TickReport};
use super::{
    SchedulerCtx, SchedulerState, CATCHUP_WINDOW, LABEL_MAX_CHARS, LIST_MAX_LIMIT, MAX_REMINDERS,
    MAX_RUNNING_SESSIONS, TITLE_MAX_CHARS,
};
use crate::time::commands::{to_spec, AnchorDto, RecurrenceSpecDto};
use crate::time::error::TimeError;
use crate::time::formats::{
    format_instant, format_local_date_time, parse_instant, parse_local_date_time, parse_time_zone,
};
use crate::time::recurrence::{format_rule, Anchor, RecurrenceSpec, MAX_EXDATES};
use crate::time::zone::resolve_local;
use jiff::{SignedDuration, Timestamp};
use sqlx::SqliteConnection;
use std::collections::HashSet;
use tauri::State;

// ---------------------------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------------------------

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReminderInputDto {
    pub title: String,
    pub start_local: String,
    pub time_zone: String,
    pub rrule: Option<String>,
    pub exdates: Vec<String>,
    pub enabled: bool,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReminderCreateDto {
    pub id: String,
    pub title: String,
    pub start_local: String,
    pub time_zone: String,
    pub rrule: Option<String>,
    pub exdates: Vec<String>,
    pub enabled: bool,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderDto {
    pub id: String,
    pub title: String,
    pub start_local: String,
    pub time_zone: String,
    pub rrule: Option<String>,
    pub exdates: Vec<String>,
    pub enabled: bool,
    pub next_fire_at: Option<String>,
    pub next_fire_key: Option<String>,
    pub status: ReminderStatus,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryDto {
    pub reminder_id: String,
    pub title: String,
    pub time_zone: String,
    pub occurrence_key: String,
    pub due_at: String,
    /// `on_time`, `late` or `missed`.
    pub outcome: String,
    pub skipped_count: u32,
    pub seen_at: Option<String>,
    pub created_at: String,
}

#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum MarkSeenDto {
    // A struct variant (not a unit one) so that `deny_unknown_fields` applies to it too.
    All {},
    #[serde(rename_all = "camelCase")]
    One {
        reminder_id: String,
        occurrence_key: String,
    },
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionStartDto {
    pub id: String,
    pub kind: SessionKind,
    pub label: String,
    pub duration_ms: Option<i64>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoryCursorDto {
    pub started_at: String,
    pub id: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDto {
    pub id: String,
    pub kind: SessionKind,
    pub label: String,
    pub started_at: String,
    pub ends_at: Option<String>,
    pub ended_at: Option<String>,
    pub end_reason: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub(super) fn reminder_dto(row: ReminderRow, status: ReminderStatus) -> ReminderDto {
    ReminderDto {
        // A line written outside the Rust may hold unreadable exceptions: it is reported with
        // `status: invalid`, never as a global error.
        exdates: serde_json::from_str(&row.exdates).unwrap_or_default(),
        id: row.id,
        title: row.title,
        start_local: row.start_local,
        time_zone: row.time_zone,
        rrule: row.rrule,
        enabled: row.enabled,
        next_fire_at: row.next_fire_at,
        next_fire_key: row.next_fire_key,
        status,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn delivery_dto(d: UnseenDelivery) -> DeliveryDto {
    DeliveryDto {
        reminder_id: d.reminder_id,
        title: d.title,
        time_zone: d.time_zone,
        occurrence_key: d.occurrence_key,
        due_at: d.due_at,
        outcome: d.outcome.as_sql().to_owned(),
        skipped_count: d.skipped_count,
        seen_at: d.seen_at,
        created_at: d.created_at,
    }
}

fn session_dto(row: SessionRow) -> SessionDto {
    SessionDto {
        id: row.id,
        kind: row.kind,
        label: row.label,
        started_at: row.started_at,
        ends_at: row.ends_at,
        ended_at: row.ended_at,
        end_reason: row.end_reason,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

// ---------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------

/// The clock read through `Clock`, truncated to the millisecond like the passes do.
pub(super) fn now_of(ctx: &SchedulerCtx) -> Result<Timestamp, ScheduleError> {
    Ok(parse_instant(&format_instant(ctx.clock.now()))?)
}

/// Settles what is already due (4.3 steps 1 and 2) before a command changes a deadline; `true` if
/// something was processed.
pub(super) async fn settle(
    conn: &mut SqliteConnection,
    now: Timestamp,
    notices: &mut Vec<Notice>,
) -> Result<bool, ScheduleError> {
    let mut report = TickReport::default();
    settle_due(conn, now, &mut report, notices).await?;
    Ok(report.sessions_completed + report.reminders_processed + report.invalid > 0)
}

/// Status of a reminder just written: its cache tells it without searching the rule again.
pub(super) fn known_status(enabled: bool, cache: &Option<Cache>) -> ReminderStatus {
    if !enabled {
        ReminderStatus::Disabled
    } else if cache.is_some() {
        ReminderStatus::Scheduled
    } else {
        ReminderStatus::Finished
    }
}

/// Cheap size check on a user text, before it is walked char by char.
pub(super) fn bounded(field: &str, s: &str, max_chars: usize) -> Result<(), ScheduleError> {
    if s.len() > max_chars.saturating_mul(4) {
        return Err(ScheduleError::invalid(field));
    }
    Ok(())
}

fn check_limit(limit: u32) -> Result<i64, ScheduleError> {
    if limit == 0 || limit > LIST_MAX_LIMIT {
        return Err(ScheduleError::invalid("limit"));
    }
    Ok(i64::from(limit))
}

/// A reminder's canonical stored form (rule text and exceptions as the engine writes them).
pub(super) struct Parts {
    pub(super) title: String,
    pub(super) start_local: String,
    pub(super) time_zone: String,
    pub(super) rrule: Option<String>,
    pub(super) exdates_json: String,
    pub(super) spec: RecurrenceSpec,
}

impl Parts {
    pub(super) fn into_row(
        self,
        id: String,
        enabled: bool,
        cache: Option<Cache>,
        created_at: String,
        updated_at: String,
    ) -> ReminderRow {
        let (next_fire_at, next_fire_key) = match cache {
            Some((at, key)) => (Some(at), Some(key)),
            None => (None, None),
        };
        ReminderRow {
            id,
            title: self.title,
            start_local: self.start_local,
            time_zone: self.time_zone,
            rrule: self.rrule,
            exdates: self.exdates_json,
            enabled,
            next_fire_at,
            next_fire_key,
            habit_id: None,
            created_at,
            updated_at,
        }
    }
}

/// Validates the title, then converts and validates the series (same conversion as
/// `time_validate`). Pure: no disk, no clock.
pub(super) fn prepare(
    title: String,
    start_local: String,
    time_zone: String,
    rrule: Option<String>,
    exdates: Vec<String>,
) -> Result<Parts, ScheduleError> {
    bounded("title", &title, TITLE_MAX_CHARS)?;
    check_title(&title)?;
    let spec = to_spec(&RecurrenceSpecDto {
        anchor: AnchorDto::DateTime {
            start_local,
            time_zone,
        },
        rrule,
        exdates,
    })?;
    let Anchor::DateTime {
        start_local,
        time_zone_id,
        ..
    } = &spec.anchor
    else {
        return Err(TimeError::NotSchedulable.into());
    };
    let exdates_json = serde_json::to_string(&spec.exdates).map_err(|_| ScheduleError::Database)?;
    // `spec` is moved last: the borrows above end with the fields built before it.
    Ok(Parts {
        title,
        start_local: format_local_date_time(*start_local),
        time_zone: time_zone_id.clone(),
        rrule: spec.rule.as_ref().map(format_rule),
        exdates_json,
        spec,
    })
}

/// Above this many entries the list is left alone: `prepare` refuses it (limit of 366) anyway.
const PRUNE_MAX_INPUT: usize = 1_000;

/// Lazy pruning of the exceptions (ADR-003 section 3.5.3, C34: they double as the history of the
/// skipped occurrences, so nothing is dropped while the list fits). Duplicates are counted once
/// to decide whether the list is saturated; a raw list over the limit but without enough distinct
/// entries is left as is (refused by `prepare`, as before).
/// Only a saturated list (more than `MAX_EXDATES` distinct entries, i.e. a new key added to a full
/// list) is pruned, and only of entries resolved (in the reminder's zone, `compatible`) strictly
/// before `now - CATCHUP_WINDOW`, which can neither be scheduled nor caught up any more; the oldest
/// go first, just enough to get back to `MAX_EXDATES`. If there are not enough of them, the list
/// is returned unchanged for `prepare` to refuse. Entries that do not parse, an unknown zone or an
/// oversized list are also left as they are. The kept entries keep their order and format.
/// Assumes a clock right within 7 days: a clock wrong by more than that, ahead at the write or set
/// back afterwards (the startup pass then recomputes `next_fire(now)`), can make an exception that
/// was dropped ring again, on time or at the catch-up (spec timers-reminders, L37).
pub(super) fn prune_past_exdates(
    exdates: Vec<String>,
    time_zone: &str,
    now: Timestamp,
) -> Vec<String> {
    if exdates.len() <= MAX_EXDATES || exdates.len() > PRUNE_MAX_INPUT {
        return exdates;
    }
    let mut seen = HashSet::new();
    let unique: Vec<String> = exdates
        .iter()
        .filter(|value| seen.insert(value.as_str()))
        .cloned()
        .collect();
    if unique.len() <= MAX_EXDATES {
        return exdates;
    }
    let (Ok(tz), Ok(cutoff)) = (parse_time_zone(time_zone), now.checked_sub(CATCHUP_WINDOW)) else {
        return exdates;
    };
    let excess = unique.len() - MAX_EXDATES;
    let mut stale: Vec<(Timestamp, usize)> = unique
        .iter()
        .enumerate()
        .filter_map(|(index, value)| {
            let at = resolve_local(parse_local_date_time(value).ok()?, &tz).ok()?;
            (at < cutoff).then_some((at, index))
        })
        .collect();
    if stale.len() < excess {
        return exdates;
    }
    stale.sort_unstable();
    let dropped: HashSet<usize> = stale.iter().take(excess).map(|&(_, index)| index).collect();
    unique
        .into_iter()
        .enumerate()
        .filter_map(|(index, value)| (!dropped.contains(&index)).then_some(value))
        .collect()
}

/// Cache of the next occurrence after `now`; none for a disabled reminder or a finished series.
pub(super) fn cache_for(
    spec: &RecurrenceSpec,
    enabled: bool,
    now: Timestamp,
) -> Result<Option<Cache>, ScheduleError> {
    if !enabled {
        return Ok(None);
    }
    Ok(next_fire(spec, now)?.as_ref().and_then(cache_of))
}

// ---------------------------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------------------------

pub(crate) async fn list_reminders(ctx: &SchedulerCtx) -> Result<Vec<ReminderDto>, ScheduleError> {
    let (rows, now) = locked!(ctx, conn => {
        let now = now_of(ctx)?;
        Ok((store::list_reminders(&mut conn).await?, now))
    })?;
    // Computing every status can be costly (it may search a rule): off the gate and off the
    // async worker threads.
    tauri::async_runtime::spawn_blocking(move || {
        rows.into_iter()
            .map(|r| {
                let status = status_of(&r, now);
                reminder_dto(r, status)
            })
            .collect()
    })
    .await
    .map_err(|_| ScheduleError::Database)
}

pub(crate) async fn create_reminder(
    ctx: &SchedulerCtx,
    input: ReminderCreateDto,
) -> Result<ReminderDto, ScheduleError> {
    let ReminderCreateDto {
        id,
        title,
        start_local,
        time_zone,
        rrule,
        exdates,
        enabled,
    } = input;
    check_id(&id)?;
    // One clock read per command: the same `now` prunes the exceptions and dates the write.
    let now = now_of(ctx)?;
    let exdates = prune_past_exdates(exdates, &time_zone, now);
    let parts = prepare(title, start_local, time_zone, rrule, exdates)?;
    let (row, status) = locked!(ctx, conn => {
        let cache = cache_for(&parts.spec, enabled, now)?;
        let status = known_status(enabled, &cache);
        let stamp = format_instant(now);
        let row = parts.into_row(id, enabled, cache, stamp.clone(), stamp);
        // The count and the insert are one transaction.
        store::insert_reminder_limited(&mut conn, &row, MAX_REMINDERS).await?;
        Ok((row, status))
    })?;
    ctx.signal.wake();
    Ok(reminder_dto(row, status))
}

pub(crate) async fn update_reminder(
    ctx: &SchedulerCtx,
    id: String,
    input: ReminderInputDto,
) -> Result<ReminderDto, ScheduleError> {
    check_id(&id)?;
    let ReminderInputDto {
        title,
        start_local,
        time_zone,
        rrule,
        exdates,
        enabled,
    } = input;
    // One clock read per command: the same `now` prunes the exceptions and dates the write.
    let now = now_of(ctx)?;
    let exdates = prune_past_exdates(exdates, &time_zone, now);
    let parts = prepare(title, start_local, time_zone, rrule, exdates)?;
    let mut notices = Vec::new();
    let result = locked!(ctx, conn => {
        settle(&mut conn, now, &mut notices).await?;
        let existing = store::get_reminder(&mut conn, &id)
            .await?
            .ok_or(ScheduleError::NotFound)?;
        let cache = cache_for(&parts.spec, enabled, now)?;
        let status = known_status(enabled, &cache);
        let row = parts.into_row(id, enabled, cache, existing.created_at, format_instant(now));
        if !store::replace_reminder(&mut conn, &row).await? {
            return Err(ScheduleError::NotFound);
        }
        Ok((row, status))
    });
    show_notices(ctx, notices);
    let (row, status) = result?;
    ctx.signal.wake();
    Ok(reminder_dto(row, status))
}

pub(crate) async fn delete_reminder(ctx: &SchedulerCtx, id: String) -> Result<bool, ScheduleError> {
    check_id(&id)?;
    let mut notices = Vec::new();
    let result = locked!(ctx, conn => {
        settle(&mut conn, now_of(ctx)?, &mut notices).await?;
        store::delete_reminder(&mut conn, &id).await
    });
    show_notices(ctx, notices);
    let deleted = result?;
    ctx.signal.wake();
    Ok(deleted)
}

pub(crate) async fn unseen_deliveries(
    ctx: &SchedulerCtx,
    limit: u32,
) -> Result<Vec<DeliveryDto>, ScheduleError> {
    let limit = check_limit(limit)?;
    let rows = locked!(ctx, conn => store::unseen_deliveries(&mut conn, limit).await)?;
    Ok(rows.into_iter().map(delivery_dto).collect())
}

pub(crate) async fn mark_deliveries_seen(
    ctx: &SchedulerCtx,
    target: MarkSeenDto,
) -> Result<u64, ScheduleError> {
    let key;
    let seen = match &target {
        MarkSeenDto::All {} => SeenTarget::All,
        MarkSeenDto::One {
            reminder_id,
            occurrence_key,
        } => {
            check_id(reminder_id).map_err(|_| ScheduleError::invalid("reminderId"))?;
            key = format_local_date_time(
                parse_local_date_time(occurrence_key)
                    .map_err(|_| ScheduleError::invalid("occurrenceKey"))?,
            );
            SeenTarget::One {
                reminder_id,
                occurrence_key: &key,
            }
        }
    };
    locked!(ctx, conn => {
        let now = format_instant(now_of(ctx)?);
        store::mark_seen(&mut conn, seen, &now).await
    })
}

// ---------------------------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------------------------

pub(crate) async fn running_sessions(ctx: &SchedulerCtx) -> Result<Vec<SessionDto>, ScheduleError> {
    let rows = locked!(ctx, conn => store::list_running_sessions(&mut conn).await)?;
    Ok(rows.into_iter().map(session_dto).collect())
}

pub(crate) async fn history_sessions(
    ctx: &SchedulerCtx,
    before: Option<HistoryCursorDto>,
    limit: u32,
) -> Result<Vec<SessionDto>, ScheduleError> {
    let limit = check_limit(limit)?;
    let cursor = before
        .map(|c| -> Result<(String, String), ScheduleError> {
            let bad = || ScheduleError::invalid("before");
            check_id(&c.id).map_err(|_| bad())?;
            let started = parse_instant(&c.started_at).map_err(|_| bad())?;
            Ok((format_instant(started), c.id))
        })
        .transpose()?;
    let rows = locked!(ctx, conn => {
        let before = cursor.as_ref().map(|(started_at, id)| HistoryCursor { started_at, id });
        store::session_history(&mut conn, before, limit).await
    })?;
    Ok(rows.into_iter().map(session_dto).collect())
}

pub(crate) async fn start_session(
    ctx: &SchedulerCtx,
    input: SessionStartDto,
) -> Result<SessionDto, ScheduleError> {
    let SessionStartDto {
        id,
        kind,
        label,
        duration_ms,
    } = input;
    check_id(&id)?;
    bounded("label", &label, LABEL_MAX_CHARS)?;
    check_label(&label)?;
    check_duration(kind, duration_ms)?;
    let mut notices = Vec::new();
    let result = locked!(ctx, conn => {
        let now = now_of(ctx)?;
        settle(&mut conn, now, &mut notices).await?;
        let ends_at = duration_ms
            .map(|ms| now.checked_add(SignedDuration::from_millis(ms)))
            .transpose()
            .map_err(|_| ScheduleError::invalid("durationMs"))?;
        let stamp = format_instant(now);
        let row = SessionRow {
            id,
            kind,
            label,
            started_at: stamp.clone(),
            ends_at: ends_at.map(format_instant),
            ended_at: None,
            end_reason: None,
            created_at: stamp.clone(),
            updated_at: stamp,
        };
        store::insert_session(&mut conn, &row, MAX_RUNNING_SESSIONS).await?;
        Ok(row)
    });
    show_notices(ctx, notices);
    let row = result?;
    ctx.signal.wake();
    Ok(session_dto(row))
}

pub(crate) async fn stop_session(
    ctx: &SchedulerCtx,
    id: String,
) -> Result<SessionDto, ScheduleError> {
    check_id(&id)?;
    let mut notices = Vec::new();
    let result = locked!(ctx, conn => {
        let now = now_of(ctx)?;
        let now_text = format_instant(now);
        // A timer that ended before this call is completed (with its toast) first.
        let settled = settle(&mut conn, now, &mut notices).await?;
        let current = store::get_session(&mut conn, &id)
            .await?
            .ok_or(ScheduleError::NotFound)?;
        if current.ended_at.is_some() {
            // Already over: returned as is (idempotent).
            return Ok((current, settled));
        }
        let due = match current.ends_at.as_deref() {
            Some(ends) => parse_instant(ends)? <= now,
            None => false,
        };
        if due {
            // Defensive: `settle` has completed every due session already.
            store::complete_session(&mut conn, &id, &now_text).await?;
        } else {
            // A clock set back must not write an end before the start.
            let started = parse_instant(&current.started_at)?;
            let ended_at = format_instant(now.max(started));
            store::stop_session(&mut conn, &id, &ended_at, &now_text).await?;
        }
        let after = store::get_session(&mut conn, &id)
            .await?
            .ok_or(ScheduleError::NotFound)?;
        Ok((after, true))
    });
    show_notices(ctx, notices);
    let (row, changed) = result?;
    if changed {
        ctx.signal.wake();
    }
    Ok(session_dto(row))
}

pub(crate) async fn rename_session(
    ctx: &SchedulerCtx,
    id: String,
    label: String,
) -> Result<SessionDto, ScheduleError> {
    check_id(&id)?;
    bounded("label", &label, LABEL_MAX_CHARS)?;
    check_label(&label)?;
    let row = locked!(ctx, conn => {
        let now = format_instant(now_of(ctx)?);
        if !store::rename_session(&mut conn, &id, &label, &now).await? {
            return Err(ScheduleError::NotFound);
        }
        store::get_session(&mut conn, &id)
            .await?
            .ok_or(ScheduleError::NotFound)
    })?;
    Ok(session_dto(row))
}

pub(crate) async fn delete_session(ctx: &SchedulerCtx, id: String) -> Result<bool, ScheduleError> {
    check_id(&id)?;
    let mut notices = Vec::new();
    let result = locked!(ctx, conn => {
        settle(&mut conn, now_of(ctx)?, &mut notices).await?;
        store::delete_session(&mut conn, &id).await
    });
    show_notices(ctx, notices);
    let deleted = result?;
    ctx.signal.wake();
    Ok(deleted)
}

// ---------------------------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------------------------

#[tauri::command]
pub async fn reminder_list(
    state: State<'_, SchedulerState>,
) -> Result<Vec<ReminderDto>, ScheduleError> {
    list_reminders(&state.ctx).await
}

#[tauri::command]
pub async fn reminder_create(
    state: State<'_, SchedulerState>,
    input: ReminderCreateDto,
) -> Result<ReminderDto, ScheduleError> {
    create_reminder(&state.ctx, input).await
}

#[tauri::command]
pub async fn reminder_update(
    state: State<'_, SchedulerState>,
    id: String,
    input: ReminderInputDto,
) -> Result<ReminderDto, ScheduleError> {
    update_reminder(&state.ctx, id, input).await
}

#[tauri::command]
pub async fn reminder_delete(
    state: State<'_, SchedulerState>,
    id: String,
) -> Result<bool, ScheduleError> {
    delete_reminder(&state.ctx, id).await
}

#[tauri::command]
pub async fn reminder_unseen_deliveries(
    state: State<'_, SchedulerState>,
    limit: u32,
) -> Result<Vec<DeliveryDto>, ScheduleError> {
    unseen_deliveries(&state.ctx, limit).await
}

#[tauri::command]
pub async fn reminder_mark_seen(
    state: State<'_, SchedulerState>,
    target: MarkSeenDto,
) -> Result<u64, ScheduleError> {
    mark_deliveries_seen(&state.ctx, target).await
}

#[tauri::command]
pub async fn session_list_running(
    state: State<'_, SchedulerState>,
) -> Result<Vec<SessionDto>, ScheduleError> {
    running_sessions(&state.ctx).await
}

#[tauri::command]
pub async fn session_history(
    state: State<'_, SchedulerState>,
    before: Option<HistoryCursorDto>,
    limit: u32,
) -> Result<Vec<SessionDto>, ScheduleError> {
    history_sessions(&state.ctx, before, limit).await
}

#[tauri::command]
pub async fn session_start(
    state: State<'_, SchedulerState>,
    input: SessionStartDto,
) -> Result<SessionDto, ScheduleError> {
    start_session(&state.ctx, input).await
}

#[tauri::command]
pub async fn session_stop(
    state: State<'_, SchedulerState>,
    id: String,
) -> Result<SessionDto, ScheduleError> {
    stop_session(&state.ctx, id).await
}

#[tauri::command]
pub async fn session_rename(
    state: State<'_, SchedulerState>,
    id: String,
    label: String,
) -> Result<SessionDto, ScheduleError> {
    rename_session(&state.ctx, id, label).await
}

#[tauri::command]
pub async fn session_delete(
    state: State<'_, SchedulerState>,
    id: String,
) -> Result<bool, ScheduleError> {
    delete_session(&state.ctx, id).await
}
