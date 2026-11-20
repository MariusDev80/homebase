//! Wall-clock <-> instant resolution (ADR-003 section 3.3). One rule, `Disambiguation::Compatible`:
//! a fold resolves to its first occurrence, a gap shifts forward (RFC 5545 section 3.3.5).

use super::error::TimeError;
use super::formats::format_local_date_time;
use jiff::civil::{Date, DateTime, Time};
use jiff::tz::{AmbiguousOffset, TimeZone};
use jiff::Timestamp;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(
    not(test),
    expect(dead_code, reason = "used by the phase 2 reminder scheduler")
)]
pub enum LocalTimeKind {
    Unique,
    Gap,
    Fold,
}

/// Wall-clock time to instant, `compatible` disambiguation.
pub fn resolve_local(local: DateTime, tz: &TimeZone) -> Result<Timestamp, TimeError> {
    tz.to_timestamp(local).map_err(|_| TimeError::OutOfRange {
        value: format_local_date_time(local),
    })
}

#[cfg_attr(
    not(test),
    expect(dead_code, reason = "used by the phase 2 reminder scheduler")
)]
pub fn classify_local(local: DateTime, tz: &TimeZone) -> LocalTimeKind {
    match tz.to_ambiguous_timestamp(local).offset() {
        AmbiguousOffset::Unambiguous { .. } => LocalTimeKind::Unique,
        AmbiguousOffset::Gap { .. } => LocalTimeKind::Gap,
        AmbiguousOffset::Fold { .. } => LocalTimeKind::Fold,
    }
}

/// Instant to wall-clock time in `tz`, truncated to the second.
pub fn to_local(t: Timestamp, tz: &TimeZone) -> DateTime {
    let dt = tz.to_datetime(t);
    let time = dt.time();
    DateTime::from_parts(
        dt.date(),
        Time::constant(time.hour(), time.minute(), time.second(), 0),
    )
}

/// First instant of the day (handles a non-existent midnight, e.g. `America/Santiago`).
pub fn start_of_day(d: Date, tz: &TimeZone) -> Result<Timestamp, TimeError> {
    d.to_zoned(tz.clone())
        .map(|z| z.timestamp())
        .map_err(|_| TimeError::OutOfRange {
            value: d.to_string(),
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::time::formats::{
        format_instant, format_local_date, format_local_date_time, parse_local_date,
        parse_local_date_time, parse_time_zone,
    };
    use crate::time::vectors::VECTORS;

    #[test]
    fn resolve_local_vectors() {
        for v in VECTORS["resolveLocal"].as_array().expect("array") {
            let id = v["id"].as_str().expect("id");
            let tz = parse_time_zone(v["timeZone"].as_str().expect("tz")).expect(id);
            let local = parse_local_date_time(v["local"].as_str().expect("local")).expect(id);
            let at = resolve_local(local, &tz).expect(id);
            assert_eq!(
                format_instant(at),
                v["expected"].as_str().expect("exp"),
                "{id}"
            );
            let kind = match v["kind"].as_str().expect("kind") {
                "unique" => LocalTimeKind::Unique,
                "gap" => LocalTimeKind::Gap,
                "fold" => LocalTimeKind::Fold,
                other => panic!("{id}: unknown kind {other}"),
            };
            assert_eq!(classify_local(local, &tz), kind, "{id} kind");
        }
    }

    #[test]
    fn to_local_vectors() {
        for v in VECTORS["toLocal"].as_array().expect("array") {
            let id = v["id"].as_str().expect("id");
            let tz = parse_time_zone(v["timeZone"].as_str().expect("tz")).expect(id);
            let at =
                crate::time::formats::parse_instant(v["instant"].as_str().expect("i")).expect(id);
            assert_eq!(
                format_local_date_time(to_local(at, &tz)),
                v["expected"].as_str().expect("exp"),
                "{id}"
            );
        }
    }

    #[test]
    fn start_of_day_vectors() {
        for v in VECTORS["startOfDay"].as_array().expect("array") {
            let id = v["id"].as_str().expect("id");
            let tz = parse_time_zone(v["timeZone"].as_str().expect("tz")).expect(id);
            let date = parse_local_date(v["date"].as_str().expect("date")).expect(id);
            assert_eq!(
                format_instant(start_of_day(date, &tz).expect(id)),
                v["expected"].as_str().expect("exp"),
                "{id}"
            );
            assert_eq!(format_local_date(date), v["date"].as_str().expect("date"));
        }
    }
}
