use super::error::TimeError;
use jiff::civil::{Date, DateTime};
use jiff::tz::TimeZone;
use jiff::Timestamp;

const INSTANT_LEN: usize = 24;
const DATE_LEN: usize = 10;
const DATE_TIME_LEN: usize = 19;
const MIN_YEAR: i32 = 1900;
const MAX_YEAR: i32 = 2199;

/// Stored form: `YYYY-MM-DDTHH:MM:SS.mmmZ` (UTC, milliseconds, truncation).
pub fn format_instant(t: Timestamp) -> String {
    t.strftime("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

fn shape_ok(b: &[u8]) -> bool {
    if b.len() != INSTANT_LEN {
        return false;
    }
    b.iter().enumerate().all(|(i, c)| match i {
        4 | 7 => *c == b'-',
        10 => *c == b'T',
        13 | 16 => *c == b':',
        19 => *c == b'.',
        23 => *c == b'Z',
        _ => c.is_ascii_digit(),
    })
}

/// Strict parse of the stored form: exact shape, exact round trip, years 1900..=2199.
pub fn parse_instant(s: &str) -> Result<Timestamp, TimeError> {
    let invalid = || TimeError::InvalidInstant {
        value: s.chars().take(64).collect(),
    };
    if !shape_ok(s.as_bytes()) {
        return Err(invalid());
    }
    let year: i32 = s[..4].parse().map_err(|_| invalid())?;
    if !(MIN_YEAR..=MAX_YEAR).contains(&year) {
        return Err(TimeError::OutOfRange {
            value: s.to_owned(),
        });
    }
    let t: Timestamp = s.parse().map_err(|_| invalid())?;
    if format_instant(t) != s {
        return Err(invalid());
    }
    Ok(t)
}

/// Stored form of a wall-clock date: `YYYY-MM-DD`.
pub fn format_local_date(d: Date) -> String {
    d.strftime("%Y-%m-%d").to_string()
}

/// Stored form of a wall-clock date-time: `YYYY-MM-DDTHH:MM:SS` (no fraction, no offset).
pub fn format_local_date_time(dt: DateTime) -> String {
    dt.strftime("%Y-%m-%dT%H:%M:%S").to_string()
}

/// Parses `len` ASCII digits at `from`; the caller has checked the shape.
fn digits(b: &[u8], from: usize, len: usize) -> i32 {
    b[from..from + len]
        .iter()
        .fold(0, |acc, c| acc * 10 + i32::from(c - b'0'))
}

fn date_shape_ok(b: &[u8]) -> bool {
    b.len() >= DATE_LEN
        && b[..DATE_LEN].iter().enumerate().all(|(i, c)| match i {
            4 | 7 => *c == b'-',
            _ => c.is_ascii_digit(),
        })
}

fn year_in_bounds(year: i32) -> bool {
    (MIN_YEAR..=MAX_YEAR).contains(&year)
}

/// Strict `YYYY-MM-DD`: exact shape, real calendar date, years 1900..=2199.
pub fn parse_local_date(s: &str) -> Result<Date, TimeError> {
    let invalid = || TimeError::InvalidLocalDate {
        value: s.chars().take(64).collect(),
    };
    let b = s.as_bytes();
    if b.len() != DATE_LEN || !date_shape_ok(b) {
        return Err(invalid());
    }
    let (year, month, day) = (digits(b, 0, 4), digits(b, 5, 2), digits(b, 8, 2));
    let date = i16::try_from(year)
        .ok()
        .and_then(|y| Date::new(y, i8::try_from(month).ok()?, i8::try_from(day).ok()?).ok())
        .ok_or_else(invalid)?;
    if !year_in_bounds(year) {
        return Err(TimeError::OutOfRange {
            value: s.to_owned(),
        });
    }
    Ok(date)
}

/// Strict `YYYY-MM-DDTHH:MM:SS`: exact shape, valid date and time (no 24:00, no :60), years
/// 1900..=2199.
pub fn parse_local_date_time(s: &str) -> Result<DateTime, TimeError> {
    let invalid = || TimeError::InvalidLocalDateTime {
        value: s.chars().take(64).collect(),
    };
    let b = s.as_bytes();
    let shape_ok = b.len() == DATE_TIME_LEN
        && date_shape_ok(b)
        && b[10] == b'T'
        && b[11..].iter().enumerate().all(|(i, c)| match i {
            2 | 5 => *c == b':',
            _ => c.is_ascii_digit(),
        });
    if !shape_ok {
        return Err(invalid());
    }
    let year = digits(b, 0, 4);
    let dt = (|| {
        DateTime::new(
            i16::try_from(year).ok()?,
            i8::try_from(digits(b, 5, 2)).ok()?,
            i8::try_from(digits(b, 8, 2)).ok()?,
            i8::try_from(digits(b, 11, 2)).ok()?,
            i8::try_from(digits(b, 14, 2)).ok()?,
            i8::try_from(digits(b, 17, 2)).ok()?,
            0,
        )
        .ok()
    })()
    .ok_or_else(invalid)?;
    if !year_in_bounds(year) {
        return Err(TimeError::OutOfRange {
            value: s.to_owned(),
        });
    }
    Ok(dt)
}

const MAX_TIME_ZONE_LEN: usize = 64;

fn time_zone_shape_ok(s: &str) -> bool {
    if s.is_empty() || s.len() > MAX_TIME_ZONE_LEN {
        return false;
    }
    let chunk_ok = |chunk: &str| {
        !chunk.is_empty()
            && chunk
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'+' | b'-'))
    };
    let mut chunks = s.split('/');
    let first = chunks.next().unwrap_or("");
    first
        .as_bytes()
        .first()
        .is_some_and(u8::is_ascii_alphabetic)
        && chunk_ok(first)
        && chunks.all(chunk_ok)
}

/// Length 1..=64, strict pattern (starts with a letter: no fixed offsets), `Etc/Unknown`
/// refused (case-insensitive), then the embedded tzdb; no file path is ever built from the input.
pub fn parse_time_zone(s: &str) -> Result<TimeZone, TimeError> {
    let unknown = || TimeError::UnknownTimeZone {
        value: s.chars().take(64).collect(),
    };
    if !time_zone_shape_ok(s) || s.eq_ignore_ascii_case("Etc/Unknown") {
        return Err(unknown());
    }
    match TimeZone::get(s) {
        Ok(tz) if !tz.is_unknown() => Ok(tz),
        _ => Err(unknown()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        for s in [
            "2026-10-21T08:15:00.123Z",
            "1900-01-01T00:00:00.000Z",
            "2199-12-31T23:59:59.999Z",
            "2024-02-29T12:00:00.000Z",
        ] {
            let t = parse_instant(s).expect(s);
            assert_eq!(format_instant(t), s);
        }
    }

    #[test]
    fn format_truncates_to_milliseconds() {
        let t: Timestamp = "2026-10-21T08:15:00.123999999Z".parse().expect("ts");
        assert_eq!(format_instant(t), "2026-10-21T08:15:00.123Z");
        let t: Timestamp = "2026-10-21T08:15:00Z".parse().expect("ts");
        assert_eq!(format_instant(t), "2026-10-21T08:15:00.000Z");
    }

    #[test]
    fn rejected_shapes() {
        for s in [
            "",
            "2026-10-21T08:15:00Z",
            "2026-10-21T08:15:00.12Z",
            "2026-10-21T08:15:00.1234Z",
            "2026-10-21T08:15:00.123+00:00",
            "2026-10-21T08:15:00.123z",
            "2026-10-21 08:15:00.123Z",
            "2026-10-21T08:15:00.123Z ",
            " 2026-10-21T08:15:00.12Z",
            "20261021T081500.123Z",
            "2026-10-21T08:15:00,123Z",
            "+026-10-21T08:15:00.123Z",
            "2026-13-21T08:15:00.123Z",
            "2026-02-30T08:15:00.123Z",
            "2026-10-21T24:00:00.123Z",
            "2026-10-21T08:60:00.123Z",
            "2026-10-21T08:15:60.123Z",
            "2026-10-21T08:15:00.12\u{e9}Z",
        ] {
            assert!(
                matches!(parse_instant(s), Err(TimeError::InvalidInstant { .. })),
                "{s:?}"
            );
        }
    }

    #[test]
    fn year_bounds() {
        assert!(matches!(
            parse_instant("1899-12-31T23:59:59.999Z"),
            Err(TimeError::OutOfRange { .. })
        ));
        assert!(matches!(
            parse_instant("2200-01-01T00:00:00.000Z"),
            Err(TimeError::OutOfRange { .. })
        ));
    }
}

#[cfg(test)]
mod local_tests {
    use super::*;
    use crate::time::vectors::VECTORS;

    #[test]
    fn local_date_round_trip_and_rejections() {
        for s in ["1900-01-01", "2028-02-29", "2199-12-31"] {
            assert_eq!(format_local_date(parse_local_date(s).expect(s)), s);
        }
        for s in [
            "2026-02-29",
            "2026-13-01",
            "2026-2-1",
            "2026-10-25 ",
            "",
            "20261025",
        ] {
            assert!(
                matches!(parse_local_date(s), Err(TimeError::InvalidLocalDate { .. })),
                "{s:?}"
            );
        }
        for s in ["1899-12-31", "2200-01-01"] {
            assert!(
                matches!(parse_local_date(s), Err(TimeError::OutOfRange { .. })),
                "{s:?}"
            );
        }
    }

    #[test]
    fn local_date_time_round_trip_and_rejections() {
        let s = "2026-10-25T02:30:00";
        assert_eq!(
            format_local_date_time(parse_local_date_time(s).expect(s)),
            s
        );
        for s in [
            "2026-10-25T24:00:00",
            "2026-12-31T23:59:60",
            "2026-02-30T10:00:00",
            "2026-10-25T02:30",
            "2026-10-25 02:30:00",
            "2026-10-25T02:30:00Z",
            "2026-10-25T02:30:00.000",
        ] {
            assert!(
                matches!(
                    parse_local_date_time(s),
                    Err(TimeError::InvalidLocalDateTime { .. })
                ),
                "{s:?}"
            );
        }
        assert!(matches!(
            parse_local_date_time("2200-01-01T00:00:00"),
            Err(TimeError::OutOfRange { .. })
        ));
    }

    #[test]
    fn time_zone_validity_vectors() {
        for v in VECTORS["timeZoneValidity"].as_array().expect("array") {
            let id = v["id"].as_str().expect("id");
            let value = v["value"].as_str().expect("value");
            assert_eq!(
                parse_time_zone(value).is_ok(),
                v["valid"].as_bool().expect("valid"),
                "{id}"
            );
        }
    }

    #[test]
    fn time_zone_extra_rejections() {
        for s in [
            "etc/unknown",
            "../etc",
            "Europe/ Paris",
            &"A".repeat(65),
            "Europe//Paris",
            "Europe/",
        ] {
            assert!(parse_time_zone(s).is_err(), "{s:?}");
        }
        assert!(parse_time_zone("EST5EDT").is_ok());
    }
}
