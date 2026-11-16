//! Recurrence (ADR-003 section 3.5): canonical subset of RFC 5545 RRULE, validation, expansion.
//! The only place that talks to the `rrule` crate is `engine.rs`.

mod engine;
#[cfg(test)]
mod tests;

use super::error::{RuleErrorCode, TimeError};
use super::formats::{
    format_local_date, format_local_date_time, parse_local_date, parse_local_date_time,
};
use super::zone::{resolve_local, start_of_day, to_local};
use jiff::civil::{Date, DateTime};
use jiff::tz::TimeZone;
use jiff::{Span, Timestamp};
use std::collections::HashSet;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Freq {
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Weekday {
    Mo,
    Tu,
    We,
    Th,
    Fr,
    Sa,
    Su,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnchorKind {
    DateTime,
    Date,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuleEnd {
    Never,
    Count(u32),
    UntilInstant(Timestamp),
    UntilDate(Date),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecurrenceRule {
    pub freq: Freq,
    pub interval: u16,
    /// WEEKLY: sorted, no duplicates.
    pub by_day: Vec<Weekday>,
    /// MONTHLY: `n` in {1, 2, 3, 4, -1}.
    pub by_nth_weekday: Option<(i8, Weekday)>,
    /// MONTHLY: 1..=31 or -1.
    pub by_month_day: Option<i8>,
    pub end: RuleEnd,
}

#[derive(Debug, Clone)]
pub enum Anchor {
    DateTime {
        start_local: DateTime,
        time_zone_id: String,
        time_zone: TimeZone,
    },
    Date {
        start_on: Date,
    },
}

/// `exdates` are canonical: nominal wall-clock strings (timed anchor) or dates (dated anchor).
#[derive(Debug, Clone)]
pub struct RecurrenceSpec {
    pub anchor: Anchor,
    pub rule: Option<RecurrenceRule>,
    pub exdates: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OccurrenceStart {
    Instant {
        at: Timestamp,
        nominal_local: DateTime,
    },
    Date(Date),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Occurrence {
    pub key: String,
    pub start: OccurrenceStart,
}

pub struct ExpandRequest {
    pub from: Timestamp,
    pub to: Timestamp,
    pub range_time_zone: TimeZone,
    pub limit: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Expansion {
    pub occurrences: Vec<Occurrence>,
    pub truncated: bool,
}

pub const MAX_RANGE_DAYS: i64 = 400;
pub const MAX_LIMIT: usize = 1000;
pub const MAX_ITERATIONS: usize = 100_000;
pub const NEXT_HORIZON_YEARS: i16 = 10;
pub const MAX_RULE_CHARS: usize = 256;
pub const MAX_EXDATES: usize = 366;

const SECONDS_PER_DAY: i64 = 86_400;
const MAX_COUNT: u32 = 1000;

// ---------------------------------------------------------------------------------------------
// Codec
// ---------------------------------------------------------------------------------------------

fn rule_error(code: RuleErrorCode, part: Option<&str>) -> TimeError {
    TimeError::InvalidRule {
        code,
        part: part.map(str::to_owned),
    }
}

fn interval_max(freq: Freq) -> u16 {
    match freq {
        Freq::Daily => 366,
        Freq::Weekly => 52,
        Freq::Monthly => 11,
        Freq::Yearly => 10,
    }
}

fn freq_name(freq: Freq) -> &'static str {
    match freq {
        Freq::Daily => "DAILY",
        Freq::Weekly => "WEEKLY",
        Freq::Monthly => "MONTHLY",
        Freq::Yearly => "YEARLY",
    }
}

fn weekday_name(day: Weekday) -> &'static str {
    match day {
        Weekday::Mo => "MO",
        Weekday::Tu => "TU",
        Weekday::We => "WE",
        Weekday::Th => "TH",
        Weekday::Fr => "FR",
        Weekday::Sa => "SA",
        Weekday::Su => "SU",
    }
}

fn parse_weekday(text: &str) -> Option<Weekday> {
    Some(match text {
        "MO" => Weekday::Mo,
        "TU" => Weekday::Tu,
        "WE" => Weekday::We,
        "TH" => Weekday::Th,
        "FR" => Weekday::Fr,
        "SA" => Weekday::Sa,
        "SU" => Weekday::Su,
        _ => return None,
    })
}

/// `^[1-9][0-9]*$` within `min..=max` (no sign, no leading zero, no overflow).
fn parse_unsigned(text: &str, max: u32) -> Option<u32> {
    let b = text.as_bytes();
    if b.is_empty() || b.len() > 4 || b[0] == b'0' || !b.iter().all(u8::is_ascii_digit) {
        return None;
    }
    let value: u32 = text.parse().ok()?;
    (1..=max).contains(&value).then_some(value)
}

/// One `BYDAY` token: `^(-1|[1-4])?(MO|TU|WE|TH|FR|SA|SU)$`.
fn parse_by_day_token(token: &str) -> Option<(Option<i8>, Weekday)> {
    if !token.is_ascii() || token.len() < 2 {
        return None;
    }
    let (ordinal, day) = token.split_at(token.len() - 2);
    let weekday = parse_weekday(day)?;
    let n = match ordinal {
        "" => None,
        "-1" => Some(-1),
        "1" => Some(1),
        "2" => Some(2),
        "3" => Some(3),
        "4" => Some(4),
        _ => return None,
    };
    Some((n, weekday))
}

enum UntilForm {
    Date(Date),
    Local,
    Utc(DateTime),
}

fn all_digits(b: &[u8]) -> bool {
    b.iter().all(u8::is_ascii_digit)
}

/// `YYYYMMDD`, `YYYYMMDDTHHMMSS` or `YYYYMMDDTHHMMSSZ`, with a valid date and time in 1900..2199.
fn parse_until(text: &str) -> Option<UntilForm> {
    if !text.is_ascii() {
        return None;
    }
    let b = text.as_bytes();
    let date_text = |t: &str| format!("{}-{}-{}", &t[0..4], &t[4..6], &t[6..8]);
    let time_text = |t: &str| format!("{}:{}:{}", &t[9..11], &t[11..13], &t[13..15]);
    match b.len() {
        8 if all_digits(b) => parse_local_date(&date_text(text)).ok().map(UntilForm::Date),
        15 | 16 if all_digits(&b[..8]) && b[8] == b'T' && all_digits(&b[9..15]) => {
            let utc = match b.len() {
                16 if b[15] == b'Z' => true,
                15 => false,
                _ => return None,
            };
            let dt =
                parse_local_date_time(&format!("{}T{}", date_text(text), time_text(text))).ok()?;
            Some(if utc {
                UntilForm::Utc(dt)
            } else {
                UntilForm::Local
            })
        }
        _ => None,
    }
}

/// `^[A-Z]+=[^;=]+(;[A-Z]+=[^;=]+)*$` as a list of (key, value).
fn split_parts(text: &str) -> Option<Vec<(&str, &str)>> {
    let mut parts = Vec::new();
    for piece in text.split(';') {
        let (key, value) = piece.split_once('=')?;
        if key.is_empty()
            || !key.bytes().all(|c| c.is_ascii_uppercase())
            || value.is_empty()
            || value.contains('=')
        {
            return None;
        }
        parts.push((key, value));
    }
    Some(parts)
}

/// Parses and validates a rule against ADR-003 section 3.5.2, checks 1 to 11 (the check 12,
/// `until_before_start`, needs the anchor: see [`validate_spec`]).
pub fn parse_rule(text: &str, anchor: AnchorKind) -> Result<RecurrenceRule, TimeError> {
    // 1. too_long (cheap byte bound first so that a huge input is never walked char by char)
    if text.len() > MAX_RULE_CHARS * 4 || text.chars().count() > MAX_RULE_CHARS {
        return Err(rule_error(RuleErrorCode::TooLong, None));
    }
    // 2. syntax
    let parts = split_parts(text).ok_or_else(|| rule_error(RuleErrorCode::Syntax, None))?;
    // 3. duplicate_part
    for (i, (key, _)) in parts.iter().enumerate() {
        if parts[..i].iter().any(|(earlier, _)| earlier == key) {
            return Err(rule_error(RuleErrorCode::DuplicatePart, Some(key)));
        }
    }
    // 4. unsupported_part
    for (key, _) in &parts {
        if !["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "COUNT", "UNTIL"].contains(key) {
            return Err(rule_error(RuleErrorCode::UnsupportedPart, Some(key)));
        }
    }
    let get = |name: &str| parts.iter().find(|(key, _)| *key == name).map(|(_, v)| *v);
    // 5. missing_freq
    let freq_text =
        get("FREQ").ok_or_else(|| rule_error(RuleErrorCode::MissingFreq, Some("FREQ")))?;
    // 6. invalid_value, in canonical order
    let invalid = |part: &str| rule_error(RuleErrorCode::InvalidValue, Some(part));
    let freq = match freq_text {
        "DAILY" => Freq::Daily,
        "WEEKLY" => Freq::Weekly,
        "MONTHLY" => Freq::Monthly,
        "YEARLY" => Freq::Yearly,
        _ => return Err(invalid("FREQ")),
    };
    let interval = match get("INTERVAL") {
        None => 1,
        Some(v) => parse_unsigned(v, u32::from(interval_max(freq)))
            .and_then(|n| u16::try_from(n).ok())
            .ok_or_else(|| invalid("INTERVAL"))?,
    };
    let by_day_tokens = match get("BYDAY") {
        None => None,
        Some(v) => Some(
            v.split(',')
                .map(parse_by_day_token)
                .collect::<Option<Vec<_>>>()
                .ok_or_else(|| invalid("BYDAY"))?,
        ),
    };
    let by_month_day = match get("BYMONTHDAY") {
        None => None,
        Some("-1") => Some(-1_i8),
        Some(v) => Some(
            parse_unsigned(v, 31)
                .and_then(|n| i8::try_from(n).ok())
                .ok_or_else(|| invalid("BYMONTHDAY"))?,
        ),
    };
    let count = match get("COUNT") {
        None => None,
        Some(v) => Some(parse_unsigned(v, MAX_COUNT).ok_or_else(|| invalid("COUNT"))?),
    };
    let until = match get("UNTIL") {
        None => None,
        Some(v) => Some(parse_until(v).ok_or_else(|| invalid("UNTIL"))?),
    };
    // 7. duplicate_value
    if let Some(tokens) = &by_day_tokens {
        for (i, token) in tokens.iter().enumerate() {
            if tokens[..i].contains(token) {
                return Err(rule_error(RuleErrorCode::DuplicateValue, Some("BYDAY")));
            }
        }
    }
    // 8. part_not_allowed
    let not_allowed = |part: &str| rule_error(RuleErrorCode::PartNotAllowed, Some(part));
    let mut by_day = Vec::new();
    let mut by_nth_weekday = None;
    if let Some(tokens) = &by_day_tokens {
        match freq {
            Freq::Weekly => {
                for (n, weekday) in tokens {
                    if n.is_some() {
                        return Err(not_allowed("BYDAY"));
                    }
                    by_day.push(*weekday);
                }
                by_day.sort_unstable();
            }
            Freq::Monthly => match tokens.as_slice() {
                [(Some(n), weekday)] => by_nth_weekday = Some((*n, *weekday)),
                _ => return Err(not_allowed("BYDAY")),
            },
            Freq::Daily | Freq::Yearly => return Err(not_allowed("BYDAY")),
        }
    }
    if by_month_day.is_some() && freq != Freq::Monthly {
        return Err(not_allowed("BYMONTHDAY"));
    }
    // 9. conflicting_parts
    if by_day_tokens.is_some() && by_month_day.is_some() {
        return Err(rule_error(RuleErrorCode::ConflictingParts, None));
    }
    // 10. count_and_until
    if count.is_some() && until.is_some() {
        return Err(rule_error(RuleErrorCode::CountAndUntil, None));
    }
    // 11. UNTIL kind against the anchor
    let end = match (count, until, anchor) {
        (Some(n), _, _) => RuleEnd::Count(n),
        (None, None, _) => RuleEnd::Never,
        (None, Some(UntilForm::Utc(dt)), AnchorKind::DateTime) => {
            let at = TimeZone::UTC
                .to_timestamp(dt)
                .map_err(|_| invalid("UNTIL"))?;
            RuleEnd::UntilInstant(at)
        }
        (None, Some(UntilForm::Local), AnchorKind::DateTime) => {
            return Err(rule_error(RuleErrorCode::UntilNotUtc, Some("UNTIL")))
        }
        (None, Some(UntilForm::Date(d)), AnchorKind::Date) => RuleEnd::UntilDate(d),
        (None, Some(_), _) => {
            return Err(rule_error(RuleErrorCode::UntilKindMismatch, Some("UNTIL")))
        }
    };
    Ok(RecurrenceRule {
        freq,
        interval,
        by_day,
        by_nth_weekday,
        by_month_day,
        end,
    })
}

/// Canonical text: `FREQ`, `INTERVAL` (omitted when 1), `BYDAY`, `BYMONTHDAY`, `COUNT`, `UNTIL`.
pub fn format_rule(rule: &RecurrenceRule) -> String {
    let mut text = format!("FREQ={}", freq_name(rule.freq));
    if rule.interval > 1 {
        text.push_str(&format!(";INTERVAL={}", rule.interval));
    }
    if !rule.by_day.is_empty() {
        let mut days = rule.by_day.clone();
        days.sort_unstable();
        let names: Vec<&str> = days.into_iter().map(weekday_name).collect();
        text.push_str(&format!(";BYDAY={}", names.join(",")));
    }
    if let Some((n, weekday)) = rule.by_nth_weekday {
        text.push_str(&format!(";BYDAY={n}{}", weekday_name(weekday)));
    }
    if let Some(day) = rule.by_month_day {
        text.push_str(&format!(";BYMONTHDAY={day}"));
    }
    match &rule.end {
        RuleEnd::Never => {}
        RuleEnd::Count(n) => text.push_str(&format!(";COUNT={n}")),
        RuleEnd::UntilInstant(at) => {
            text.push_str(&format!(";UNTIL={}", at.strftime("%Y%m%dT%H%M%SZ")));
        }
        RuleEnd::UntilDate(d) => text.push_str(&format!(";UNTIL={}", d.strftime("%Y%m%d"))),
    }
    text
}

// ---------------------------------------------------------------------------------------------
// Validation and expansion
// ---------------------------------------------------------------------------------------------

/// Check 12 (`until_before_start`), `UNTIL` kind against the anchor, and the format of the
/// `exdates` according to the anchor.
pub fn validate_spec(spec: &RecurrenceSpec) -> Result<(), TimeError> {
    let bad_exdate = |value: &String| TimeError::InvalidExdate {
        value: value.chars().take(64).collect(),
    };
    match &spec.anchor {
        Anchor::DateTime {
            start_local,
            time_zone,
            ..
        } => {
            for value in &spec.exdates {
                parse_local_date_time(value).map_err(|_| bad_exdate(value))?;
            }
            match spec.rule.as_ref().map(|rule| &rule.end) {
                Some(RuleEnd::UntilInstant(until)) => {
                    if *until < resolve_local(*start_local, time_zone)? {
                        return Err(rule_error(RuleErrorCode::UntilBeforeStart, Some("UNTIL")));
                    }
                }
                Some(RuleEnd::UntilDate(_)) => {
                    return Err(rule_error(RuleErrorCode::UntilKindMismatch, Some("UNTIL")));
                }
                _ => {}
            }
        }
        Anchor::Date { start_on } => {
            for value in &spec.exdates {
                parse_local_date(value).map_err(|_| bad_exdate(value))?;
            }
            match spec.rule.as_ref().map(|rule| &rule.end) {
                Some(RuleEnd::UntilDate(until)) => {
                    if until < start_on {
                        return Err(rule_error(RuleErrorCode::UntilBeforeStart, Some("UNTIL")));
                    }
                }
                Some(RuleEnd::UntilInstant(_)) => {
                    return Err(rule_error(RuleErrorCode::UntilKindMismatch, Some("UNTIL")));
                }
                _ => {}
            }
        }
    }
    Ok(())
}

fn one_day() -> Span {
    Span::new().days(1)
}

fn out_of_range(value: impl std::fmt::Display) -> TimeError {
    TimeError::OutOfRange {
        value: value.to_string(),
    }
}

/// Nominal wall-clock times of the series (anchor included only when it matches the rule), in
/// ascending order, up to `upper` inclusive. Without a rule: the anchor alone.
fn nominal_times(
    spec: &RecurrenceSpec,
    start: DateTime,
    upper: DateTime,
) -> Result<Vec<DateTime>, TimeError> {
    match &spec.rule {
        None => Ok(if start <= upper { vec![start] } else { vec![] }),
        Some(rule) => engine::floating_occurrences(start, rule, upper),
    }
}

/// Upper bound of the nominal iteration for a timed anchor: `hi`, lowered to the day after the
/// local time of an instant `UNTIL` (a nominal time never resolves earlier than itself, so no
/// occurrence at or before `UNTIL` is beyond it). Results are unchanged; only wasted iteration
/// (and a spurious `ExpansionLimit`) is avoided.
fn capped_upper(
    spec: &RecurrenceSpec,
    time_zone: &TimeZone,
    hi: DateTime,
) -> Result<DateTime, TimeError> {
    match spec.rule.as_ref().map(|rule| &rule.end) {
        Some(RuleEnd::UntilInstant(at)) => {
            let cap = to_local(*at, time_zone)
                .checked_add(one_day())
                .map_err(|_| out_of_range(at))?;
            Ok(hi.min(cap))
        }
        _ => Ok(hi),
    }
}

/// Expansion of the series over `[from, to)` (ADR-003 section 3.5.4).
pub fn expand(spec: &RecurrenceSpec, req: &ExpandRequest) -> Result<Expansion, TimeError> {
    if req.from >= req.to
        || req.to.as_second() - req.from.as_second() > MAX_RANGE_DAYS * SECONDS_PER_DAY
    {
        return Err(TimeError::InvalidRange);
    }
    if req.limit == 0 || req.limit > MAX_LIMIT {
        return Err(out_of_range(req.limit));
    }
    validate_spec(spec)?;
    let excluded: HashSet<&str> = spec.exdates.iter().map(String::as_str).collect();
    let mut found: Vec<Occurrence> = Vec::new();
    match &spec.anchor {
        Anchor::DateTime {
            start_local,
            time_zone,
            ..
        } => {
            let lo = to_local(req.from, time_zone)
                .checked_sub(one_day())
                .map_err(|_| out_of_range(req.from))?;
            let hi = to_local(req.to, time_zone)
                .checked_add(one_day())
                .map_err(|_| out_of_range(req.to))?;
            let until = match spec.rule.as_ref().map(|rule| &rule.end) {
                Some(RuleEnd::UntilInstant(at)) => Some(*at),
                _ => None,
            };
            let upper = capped_upper(spec, time_zone, hi)?;
            for nominal in nominal_times(spec, *start_local, upper)? {
                if nominal < lo || nominal > hi {
                    continue;
                }
                let key = format_local_date_time(nominal);
                if excluded.contains(key.as_str()) {
                    continue;
                }
                let at = resolve_local(nominal, time_zone)?;
                if until.is_some_and(|limit| at > limit) || at < req.from || at >= req.to {
                    continue;
                }
                found.push(Occurrence {
                    key,
                    start: OccurrenceStart::Instant {
                        at,
                        nominal_local: nominal,
                    },
                });
            }
            found.sort_by(|a, b| sort_key(a).cmp(&sort_key(b)));
        }
        Anchor::Date { start_on } => {
            let tz = &req.range_time_zone;
            let lo = to_local(req.from, tz)
                .date()
                .checked_sub(one_day())
                .map_err(|_| out_of_range(req.from))?;
            let hi = to_local(req.to, tz)
                .date()
                .checked_add(one_day())
                .map_err(|_| out_of_range(req.to))?;
            let until = match spec.rule.as_ref().map(|rule| &rule.end) {
                Some(RuleEnd::UntilDate(d)) => Some(*d),
                _ => None,
            };
            let last_day = until.map_or(hi, |last| {
                last.checked_add(one_day()).map_or(hi, |next| hi.min(next))
            });
            let upper = DateTime::from_parts(last_day, jiff::civil::Time::constant(23, 59, 59, 0));
            for nominal in nominal_times(spec, start_on.to_datetime(jiff::civil::Time::MIN), upper)?
            {
                let date = nominal.date();
                if date < lo || date > hi || until.is_some_and(|last| date > last) {
                    continue;
                }
                let key = format_local_date(date);
                if excluded.contains(key.as_str()) {
                    continue;
                }
                // The day [startOfDay(d), startOfDay(d + 1)) in the display zone must overlap
                // the range.
                let next = date
                    .checked_add(one_day())
                    .map_err(|_| out_of_range(&key))?;
                if start_of_day(date, tz)? >= req.to || start_of_day(next, tz)? <= req.from {
                    continue;
                }
                found.push(Occurrence {
                    key,
                    start: OccurrenceStart::Date(date),
                });
            }
            found.sort_by(|a, b| sort_key(a).cmp(&sort_key(b)));
        }
    }
    let truncated = found.len() > req.limit;
    found.truncate(req.limit);
    Ok(Expansion {
        occurrences: found,
        truncated,
    })
}

/// Chronological order; dated occurrences are ordered by their ISO key.
fn sort_key(occurrence: &Occurrence) -> (Timestamp, &str) {
    let at = match &occurrence.start {
        OccurrenceStart::Instant { at, .. } => *at,
        OccurrenceStart::Date(_) => Timestamp::UNIX_EPOCH,
    };
    (at, occurrence.key.as_str())
}

/// First occurrence strictly after `after`, searched over [`NEXT_HORIZON_YEARS`] years at most.
/// Timed anchors only: a dated anchor never triggers a notification (section 3.5.5).
pub fn next_after(
    spec: &RecurrenceSpec,
    after: Timestamp,
) -> Result<Option<Occurrence>, TimeError> {
    let Anchor::DateTime {
        start_local,
        time_zone,
        ..
    } = &spec.anchor
    else {
        return Err(TimeError::NotSchedulable);
    };
    validate_spec(spec)?;
    let horizon = after
        .to_zoned(time_zone.clone())
        .checked_add(Span::new().years(NEXT_HORIZON_YEARS))
        .map_err(|_| out_of_range(after))?
        .timestamp();
    let lo = to_local(after, time_zone)
        .checked_sub(one_day())
        .map_err(|_| out_of_range(after))?;
    let upper = to_local(horizon, time_zone)
        .checked_add(one_day())
        .map_err(|_| out_of_range(horizon))?;
    let upper = capped_upper(spec, time_zone, upper)?;
    let until = match spec.rule.as_ref().map(|rule| &rule.end) {
        Some(RuleEnd::UntilInstant(at)) => Some(*at),
        _ => None,
    };
    // An occurrence is never after `UNTIL`: a series already over at `after` has no next one, and
    // the nominal iteration from the anchor (possibly decades back) is not needed to know it.
    if until.is_some_and(|limit| limit <= after) {
        return Ok(None);
    }
    let excluded: HashSet<&str> = spec.exdates.iter().map(String::as_str).collect();
    // Nominal times are ascending and an anchor yields at most one occurrence per day, so the
    // resolved instants are ascending too (a gap shift never reorders two different days):
    // the first one strictly after `after` is the answer.
    for nominal in nominal_times(spec, *start_local, upper)? {
        if nominal < lo {
            continue;
        }
        let key = format_local_date_time(nominal);
        if excluded.contains(key.as_str()) {
            continue;
        }
        let at = resolve_local(nominal, time_zone)?;
        if at <= after {
            continue;
        }
        if at > horizon || until.is_some_and(|limit| at > limit) {
            break;
        }
        return Ok(Some(Occurrence {
            key,
            start: OccurrenceStart::Instant {
                at,
                nominal_local: nominal,
            },
        }));
    }
    Ok(None)
}
