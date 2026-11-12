use super::error::TimeError;
use jiff::Timestamp;

const INSTANT_LEN: usize = 24;
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
