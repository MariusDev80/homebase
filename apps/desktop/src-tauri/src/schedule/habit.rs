//! Habits: types and pure functions (spec habits 4.2). No SQL, no clock: callers pass `now`.

use super::error::ScheduleError;
use crate::time::error::TimeError;
use crate::time::formats::format_local_date_time;
use crate::time::recurrence::{
    parse_weekday, weekday_name, Freq, RecurrenceRule, RuleEnd, Weekday,
};
use crate::time::zone::resolve_local;
use jiff::civil::{Date, DateTime, Time};
use jiff::tz::TimeZone;
use jiff::{Timestamp, ToSpan};

/// Weekdays in mask order: bit 0 is Monday, bit 6 is Sunday.
const WEEK: [Weekday; 7] = [
    Weekday::Mo,
    Weekday::Tu,
    Weekday::We,
    Weekday::Th,
    Weekday::Fr,
    Weekday::Sa,
    Weekday::Su,
];

/// Every day of the week.
pub const ALL_DAYS: u8 = 0b111_1111;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HabitSchedule {
    /// `mask`: bit 0 = Monday ... bit 6 = Sunday, `1..=127`.
    Days { mask: u8 },
    /// `target` times per ISO week, `1..=7`.
    Weekly { target: u8 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HabitRow {
    pub id: String,
    pub title: String,
    pub schedule: HabitSchedule,
    /// Wall-clock start date (`YYYY-MM-DD`).
    pub start_on: String,
    pub archived_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// 1 to 7 distinct tokens `"MO"` to `"SU"` (the count is checked before any parsing) to a mask;
/// otherwise `InvalidInput { field }`.
pub fn mask_of(days: &[String], field: &str) -> Result<u8, ScheduleError> {
    if days.is_empty() || days.len() > WEEK.len() {
        return Err(ScheduleError::invalid(field));
    }
    let mut mask = 0u8;
    for token in days {
        let day = parse_weekday(token).ok_or_else(|| ScheduleError::invalid(field))?;
        let bit = WEEK
            .iter()
            .position(|d| *d == day)
            .ok_or_else(|| ScheduleError::invalid(field))?;
        let flag = 1u8 << bit;
        if mask & flag != 0 {
            return Err(ScheduleError::invalid(field));
        }
        mask |= flag;
    }
    Ok(mask)
}

/// The tokens of a mask, Monday first.
pub fn days_of(mask: u8) -> Vec<&'static str> {
    WEEK.iter()
        .enumerate()
        .filter(|(bit, _)| mask & (1u8 << bit) != 0)
        .map(|(_, day)| weekday_name(*day))
        .collect()
}

/// The recurrence rule of a habit reminder: 127 gives `FREQ=DAILY`, otherwise
/// `FREQ=WEEKLY;BYDAY=<days, Monday first>`. Precondition: `mask` in `1..=127` (guaranteed by
/// `mask_of`); an empty mask would give an invalid rule.
pub fn reminder_rule(mask: u8) -> String {
    debug_assert!(
        (1..=127).contains(&mask),
        "habit reminder mask out of bounds"
    );
    if mask & ALL_DAYS == ALL_DAYS {
        "FREQ=DAILY".to_owned()
    } else {
        format!("FREQ=WEEKLY;BYDAY={}", days_of(mask).join(","))
    }
}

/// The mask of a habit reminder rule; `None` outside the two forms (`DAILY`, or `WEEKLY` with
/// days; interval 1, no end, nothing else).
pub fn reminder_mask(rule: &RecurrenceRule) -> Option<u8> {
    if rule.interval != 1
        || rule.end != RuleEnd::Never
        || rule.by_nth_weekday.is_some()
        || rule.by_month_day.is_some()
    {
        return None;
    }
    match rule.freq {
        Freq::Daily if rule.by_day.is_empty() => Some(ALL_DAYS),
        Freq::Weekly if !rule.by_day.is_empty() => {
            let mut mask = 0u8;
            for day in &rule.by_day {
                let bit = WEEK.iter().position(|d| d == day)?;
                mask |= 1u8 << bit;
            }
            Some(mask)
        }
        _ => None,
    }
}

/// Strict `HH:MM` (`^([01]\d|2[0-3]):[0-5]\d$`); the error names the field `reminder.time`.
pub fn parse_time_of_day(s: &str) -> Result<Time, ScheduleError> {
    let invalid = || ScheduleError::invalid("reminder.time");
    let b = s.as_bytes();
    if b.len() != 5 || b[2] != b':' {
        return Err(invalid());
    }
    let digit = |i: usize| -> Result<i8, ScheduleError> {
        if b[i].is_ascii_digit() {
            Ok(i8::try_from(b[i] - b'0').map_err(|_| invalid())?)
        } else {
            Err(invalid())
        }
    };
    let hour = digit(0)? * 10 + digit(1)?;
    let minute = digit(3)? * 10 + digit(4)?;
    if hour > 23 || minute > 59 {
        return Err(invalid());
    }
    Time::new(hour, minute, 0, 0).map_err(|_| invalid())
}

/// Days `J-1` to `J+1` (bounds included), `J` being the date of `now` in `tz`.
pub fn check_window(now: Timestamp, tz: &TimeZone) -> (Date, Date) {
    let today = tz.to_datetime(now).date();
    (today.saturating_sub(1.day()), today.saturating_add(1.day()))
}

/// D3: the exception keys `<day>T<HH:MM>:00` of the checked days whose resolved instant is after
/// `now` (a key at or before `now` has no effect any more); sorted, unique.
pub fn habit_exdates(
    checked: &[Date],
    time: Time,
    tz: &TimeZone,
    now: Timestamp,
) -> Result<Vec<String>, TimeError> {
    let mut keys = std::collections::BTreeSet::new();
    for day in checked {
        let local = DateTime::from_parts(*day, time);
        if resolve_local(local, tz)? > now {
            keys.insert(format_local_date_time(local));
        }
    }
    Ok(keys.into_iter().collect())
}

/// Last acceptable day for a check or a start: the UTC date of `now` plus one day (time zones go
/// up to UTC+14).
pub fn latest_allowed_day(now: Timestamp) -> Date {
    TimeZone::UTC
        .to_datetime(now)
        .date()
        .saturating_add(1.day())
}
