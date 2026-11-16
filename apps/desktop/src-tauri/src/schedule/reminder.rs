//! Reminder rows and pure planning (spec D4, D6, 4.2). No SQL, no clock: callers pass `now`.

use super::{CATCHUP_WINDOW, COUNT_WINDOW, GRACE};
use crate::time::commands::{to_spec, AnchorDto, RecurrenceSpecDto};
use crate::time::error::TimeError;
use crate::time::recurrence::{
    expand, next_after, ExpandRequest, Occurrence, OccurrenceStart, RecurrenceSpec, MAX_LIMIT,
};
use jiff::civil;
use jiff::tz::TimeZone;
use jiff::{SignedDuration, Timestamp};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReminderRow {
    pub id: String,
    pub title: String,
    pub start_local: String,
    pub time_zone: String,
    pub rrule: Option<String>,
    /// JSON array of nominal wall-clock strings.
    pub exdates: String,
    pub enabled: bool,
    pub next_fire_at: Option<String>,
    pub next_fire_key: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[cfg_attr(not(test), expect(dead_code, reason = "used by the R3 commands"))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReminderStatus {
    Scheduled,
    Finished,
    Disabled,
    Invalid,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    OnTime,
    Late,
    Missed,
}

impl Outcome {
    /// Value stored in `reminder_deliveries.outcome`.
    pub fn as_sql(self) -> &'static str {
        match self {
            Self::OnTime => "on_time",
            Self::Late => "late",
            Self::Missed => "missed",
        }
    }

    #[cfg_attr(not(test), expect(dead_code, reason = "used by the R3 commands"))]
    pub fn from_sql(s: &str) -> Option<Self> {
        Some(match s {
            "on_time" => Self::OnTime,
            "late" => Self::Late,
            "missed" => Self::Missed,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedDelivery {
    pub key: String,
    pub due_at: Timestamp,
    pub nominal_local: civil::DateTime,
    pub outcome: Outcome,
    /// Occurrences before the last one, skipped in the same pass.
    pub skipped: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DuePlan {
    pub delivery: Option<PlannedDelivery>,
    pub next: Option<Occurrence>,
}

/// Rebuilds the recurrence spec with the same conversion as `time_validate` (`to_spec`).
pub fn spec_of(row: &ReminderRow) -> Result<RecurrenceSpec, TimeError> {
    let exdates: Vec<String> =
        serde_json::from_str(&row.exdates).map_err(|_| TimeError::InvalidExdate {
            value: row.exdates.chars().take(64).collect(),
        })?;
    to_spec(&RecurrenceSpecDto {
        anchor: AnchorDto::DateTime {
            start_local: row.start_local.clone(),
            time_zone: row.time_zone.clone(),
        },
        rrule: row.rrule.clone(),
        exdates,
    })
}

/// Status shown to the user. An enabled reminder without a cached occurrence is `Finished` only if
/// the series really has no occurrence after `now`; if computing it fails, it is `Invalid`.
#[cfg_attr(not(test), expect(dead_code, reason = "used by the R3 commands"))]
pub fn status_of(row: &ReminderRow, now: Timestamp) -> ReminderStatus {
    let Ok(spec) = spec_of(row) else {
        return ReminderStatus::Invalid;
    };
    if !row.enabled {
        ReminderStatus::Disabled
    } else if row.next_fire_at.is_some() {
        ReminderStatus::Scheduled
    } else {
        match next_fire(&spec, now) {
            Err(_) => ReminderStatus::Invalid,
            Ok(None) => ReminderStatus::Finished,
            // Stale cache (cleared by hand): the startup pass recomputes it.
            Ok(Some(_)) => ReminderStatus::Scheduled,
        }
    }
}

/// Bounds are inclusive: exactly `GRACE` late is on time, exactly `CATCHUP_WINDOW` late is late.
pub fn outcome_for(due_at: Timestamp, now: Timestamp) -> Outcome {
    let delay = now.duration_since(due_at);
    if delay <= GRACE {
        Outcome::OnTime
    } else if delay <= CATCHUP_WINDOW {
        Outcome::Late
    } else {
        Outcome::Missed
    }
}

fn out_of_range(t: Timestamp) -> TimeError {
    TimeError::OutOfRange {
        value: t.to_string(),
    }
}

/// Plan of one due reminder (D6 steps 1 to 3). `cached_next` is its `next_fire_at`, `<= now`.
pub fn plan_due(
    spec: &RecurrenceSpec,
    cached_next: Timestamp,
    now: Timestamp,
) -> Result<DuePlan, TimeError> {
    debug_assert!(
        cached_next <= now,
        "plan_due called on a reminder not yet due"
    );
    let floor = now
        .checked_sub(COUNT_WINDOW)
        .map_err(|_| out_of_range(now))?;
    let to = now
        .checked_add(SignedDuration::from_millis(1))
        .map_err(|_| out_of_range(now))?;
    let from = cached_next.max(floor).min(now);
    let expansion = expand(
        spec,
        &ExpandRequest {
            from,
            to,
            range_time_zone: TimeZone::UTC,
            limit: MAX_LIMIT,
        },
    )?;
    let delivery = match expansion.occurrences.last() {
        None => None,
        Some(last) => {
            let OccurrenceStart::Instant { at, nominal_local } = &last.start else {
                return Err(TimeError::NotSchedulable);
            };
            Some(PlannedDelivery {
                key: last.key.clone(),
                due_at: *at,
                nominal_local: *nominal_local,
                outcome: outcome_for(*at, now),
                skipped: u32::try_from(expansion.occurrences.len() - 1).unwrap_or(u32::MAX),
            })
        }
    };
    Ok(DuePlan {
        delivery,
        next: next_after(spec, now)?,
    })
}

/// Next occurrence strictly after `now`; `None` once the series is over.
pub fn next_fire(spec: &RecurrenceSpec, now: Timestamp) -> Result<Option<Occurrence>, TimeError> {
    next_after(spec, now)
}
