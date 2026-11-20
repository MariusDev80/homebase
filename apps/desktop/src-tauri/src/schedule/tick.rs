//! One scheduler pass (spec 4.3): completes the due timers, fires the due reminders, groups
//! the notices and shows them after the commits. The clock is read once, through `Clock`.

use super::error::ScheduleError;
use super::notice::{group, render, Notice};
use super::reminder::{next_fire, plan_due, spec_of, Outcome, ReminderRow};
use super::session::SessionKind;
use super::store::{self, DeliveryRow};
use super::{SchedulerCtx, CATCHUP_WINDOW, DUE_BATCH, GRACE};
use crate::time::formats::{format_instant, parse_instant};
use crate::time::recurrence::OccurrenceStart;
use jiff::Timestamp;
use sqlx::SqliteConnection;
use std::collections::HashSet;

/// `Startup` also recomputes every reminder's cached next occurrence (safety net, 4.3 step 3).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Startup,
    Regular,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct TickReport {
    /// The instant of the pass (truncated to the millisecond).
    pub now: Timestamp,
    pub sessions_completed: usize,
    pub reminders_processed: usize,
    pub invalid: usize,
    pub toasts: usize,
    pub next_due: Option<Timestamp>,
}

/// A cached next occurrence: instant text and occurrence key.
pub(super) type Cache = (String, String);

/// Takes `ctx.gate`, reads `ctx.clock.now()` once (truncated to the millisecond), applies 4.3 and
/// shows the toasts after the commits. A failure in the middle still shows the toasts of what was
/// already committed, then returns the error.
pub async fn tick(ctx: &SchedulerCtx, phase: Phase) -> Result<TickReport, ScheduleError> {
    let _gate = ctx.gate.lock().await;
    // What is written is exactly what is compared.
    let now = parse_instant(&format_instant(ctx.clock.now()))?;
    let mut conn = store::connect_with_timeout(&ctx.db, ctx.busy_timeout).await?;
    let mut report = TickReport {
        now,
        ..TickReport::default()
    };
    let mut notices = Vec::new();
    let outcome = pass(&mut conn, now, phase, &mut report, &mut notices).await;
    store::close(conn).await;
    report.toasts = show_notices(ctx, notices);
    outcome.map(|()| report)
}

/// Groups the notices (D6) and shows them. Called outside any transaction.
pub(super) fn show_notices(ctx: &SchedulerCtx, notices: Vec<Notice>) -> usize {
    let grouped = group(notices);
    for notice in &grouped {
        ctx.notifier.show(&render(notice));
    }
    grouped.len()
}

/// Steps 1 and 2 of 4.3: completes the due timers and fires the due reminders, collecting the
/// notices to show. The commands that change a deadline call it first, under the gate, so what
/// was already due is handled before the change.
pub(super) async fn settle_due(
    conn: &mut SqliteConnection,
    now: Timestamp,
    report: &mut TickReport,
    notices: &mut Vec<Notice>,
) -> Result<(), ScheduleError> {
    let now_text = format_instant(now);
    complete_due_sessions(conn, now, &now_text, report, notices).await?;
    fire_due_reminders(conn, now, &now_text, report, notices).await
}

async fn pass(
    conn: &mut SqliteConnection,
    now: Timestamp,
    phase: Phase,
    report: &mut TickReport,
    notices: &mut Vec<Notice>,
) -> Result<(), ScheduleError> {
    settle_due(conn, now, report, notices).await?;
    if phase == Phase::Startup {
        refresh_caches(conn, now, report).await?;
    }
    report.next_due = store::next_due(conn)
        .await?
        .and_then(|text| parse_instant(&text).ok());
    Ok(())
}

async fn complete_due_sessions(
    conn: &mut SqliteConnection,
    now: Timestamp,
    now_text: &str,
    report: &mut TickReport,
    notices: &mut Vec<Notice>,
) -> Result<(), ScheduleError> {
    loop {
        let rows = store::due_sessions(conn, now_text, DUE_BATCH).await?;
        for row in &rows {
            // At most once: only the pass that changes the row shows the toast.
            if !store::complete_session(conn, &row.id, now_text).await? {
                continue;
            }
            report.sessions_completed += 1;
            if row.kind == SessionKind::Stopwatch {
                continue;
            }
            let (Some(ends), Ok(started)) = (
                row.ends_at.as_deref().and_then(|t| parse_instant(t).ok()),
                parse_instant(&row.started_at),
            ) else {
                eprintln!("schedule: a session has unreadable instants");
                continue;
            };
            let late = now.duration_since(ends);
            if late > CATCHUP_WINDOW {
                continue;
            }
            notices.push(Notice::SessionEnded {
                kind: row.kind,
                label: row.label.clone(),
                planned: ends.duration_since(started),
                late_by: (late > GRACE).then_some(late),
                due_at: ends,
            });
        }
        if rows.len() < usize::try_from(DUE_BATCH).unwrap_or(usize::MAX) {
            return Ok(());
        }
    }
}

async fn fire_due_reminders(
    conn: &mut SqliteConnection,
    now: Timestamp,
    now_text: &str,
    report: &mut TickReport,
    notices: &mut Vec<Notice>,
) -> Result<(), ScheduleError> {
    // A row that a pass cannot move forward (cache changed under us) is not retried forever.
    let mut seen: HashSet<String> = HashSet::new();
    loop {
        let rows = store::due_reminders(conn, now_text, DUE_BATCH).await?;
        let mut progressed = false;
        for row in &rows {
            if !seen.insert(row.id.clone()) {
                continue;
            }
            progressed = true;
            fire_one(conn, row, now, now_text, report, notices).await?;
        }
        if !progressed || rows.len() < usize::try_from(DUE_BATCH).unwrap_or(usize::MAX) {
            return Ok(());
        }
    }
}

pub(super) fn cache_of(occurrence: &crate::time::recurrence::Occurrence) -> Option<Cache> {
    match &occurrence.start {
        OccurrenceStart::Instant { at, .. } => Some((format_instant(*at), occurrence.key.clone())),
        OccurrenceStart::Date(_) => None,
    }
}

fn as_refs(cache: &Option<Cache>) -> Option<(&str, &str)> {
    cache.as_ref().map(|(at, key)| (at.as_str(), key.as_str()))
}

async fn fire_one(
    conn: &mut SqliteConnection,
    row: &ReminderRow,
    now: Timestamp,
    now_text: &str,
    report: &mut TickReport,
    notices: &mut Vec<Notice>,
) -> Result<(), ScheduleError> {
    let expected = row.next_fire_at.as_deref();
    let plan = spec_of(row).ok().and_then(|spec| {
        let cached = parse_instant(expected?).ok()?;
        plan_due(&spec, cached, now).ok()
    });
    let Some(plan) = plan else {
        // Invalid line (written outside the Rust, or the rule no longer computes): the id only.
        eprintln!("schedule: reminder {} cannot be scheduled", row.id);
        store::write_cache(conn, &row.id, expected, None).await?;
        report.invalid += 1;
        return Ok(());
    };
    let next = plan.next.as_ref().and_then(cache_of);
    let delivery = plan.delivery.as_ref().map(|d| DeliveryRow {
        reminder_id: row.id.clone(),
        occurrence_key: d.key.clone(),
        due_at: format_instant(d.due_at),
        outcome: d.outcome,
        skipped_count: d.skipped,
        seen_at: None,
        created_at: now_text.to_owned(),
        updated_at: now_text.to_owned(),
    });
    let firing =
        store::record_firing_detailed(conn, &row.id, expected, delivery.as_ref(), as_refs(&next))
            .await?;
    if firing.written {
        report.reminders_processed += 1;
    }
    if let (true, Some(d)) = (firing.inserted, &plan.delivery) {
        // A missed occurrence is recorded, never notified.
        if d.outcome != Outcome::Missed {
            notices.push(Notice::Reminder {
                title: row.title.clone(),
                nominal_local: d.nominal_local,
                outcome: d.outcome,
                skipped: d.skipped,
                due_at: d.due_at,
            });
        }
    }
    Ok(())
}

/// Startup safety net (tzdb or engine update between two versions): every enabled reminder gets
/// its cache recomputed; an invalid one is cleared. No catch-up is lost: due occurrences were
/// processed before.
async fn refresh_caches(
    conn: &mut SqliteConnection,
    now: Timestamp,
    report: &mut TickReport,
) -> Result<(), ScheduleError> {
    for row in &store::enabled_reminders(conn).await? {
        let computed = spec_of(row)
            .ok()
            .and_then(|spec| next_fire(&spec, now).ok());
        let next: Option<Cache> = computed
            .as_ref()
            .and_then(|o| o.as_ref().and_then(cache_of));
        let current = row.next_fire_at.clone().zip(row.next_fire_key.clone());
        if next == current {
            continue;
        }
        if computed.is_none() {
            eprintln!("schedule: reminder {} cannot be scheduled", row.id);
            report.invalid += 1;
        }
        store::write_cache(conn, &row.id, row.next_fire_at.as_deref(), as_refs(&next)).await?;
    }
    Ok(())
}
