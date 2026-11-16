//! Rust side of the shared vectors (ADR-003 section 8.6) and of the section 8.11 tests.

use super::*;
use crate::time::formats::{
    format_instant, format_local_date, format_local_date_time, parse_instant, parse_local_date,
    parse_local_date_time, parse_time_zone,
};
use crate::time::vectors::VECTORS;
use serde_json::Value;

fn str_of<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or_else(|| panic!("missing {key}"))
}

fn anchor_kind(v: &Value) -> AnchorKind {
    match str_of(v, "anchorKind") {
        "date-time" => AnchorKind::DateTime,
        "date" => AnchorKind::Date,
        other => panic!("unknown anchorKind {other}"),
    }
}

fn code_name(error: &TimeError) -> String {
    let json = serde_json::to_value(error).expect("serialize");
    match json["kind"].as_str().expect("kind") {
        "invalid_rule" => json["code"].as_str().expect("code").to_owned(),
        other => other.to_owned(),
    }
}

#[test]
fn rule_codec_vectors() {
    let vectors = VECTORS["ruleCodec"].as_array().expect("ruleCodec");
    assert!(vectors.len() > 100);
    for v in vectors {
        let id = str_of(v, "id");
        let result = parse_rule(str_of(v, "input"), anchor_kind(v));
        match (v.get("canonical"), v.get("error")) {
            (Some(canonical), None) => {
                let rule = result.unwrap_or_else(|e| panic!("{id}: {e:?}"));
                let canonical = canonical.as_str().expect("canonical");
                assert_eq!(format_rule(&rule), canonical, "{id}");
                let again = parse_rule(canonical, anchor_kind(v)).expect(id);
                assert_eq!(again, rule, "{id} round trip");
            }
            (None, Some(expected)) => {
                let error = result.expect_err(id);
                assert_eq!(code_name(&error), expected.as_str().expect("code"), "{id}");
                if let Some(part) = v.get("part") {
                    let json = serde_json::to_value(&error).expect("json");
                    assert_eq!(json["part"], *part, "{id} part");
                }
            }
            _ => panic!("{id}: needs exactly one of canonical / error"),
        }
    }
}

fn spec_from(v: &Value) -> RecurrenceSpec {
    let anchor = &v["anchor"];
    let (anchor, kind) = match str_of(anchor, "kind") {
        "date-time" => {
            let id = str_of(anchor, "timeZone");
            (
                Anchor::DateTime {
                    start_local: parse_local_date_time(str_of(anchor, "startLocal"))
                        .expect("start"),
                    time_zone_id: id.to_owned(),
                    time_zone: parse_time_zone(id).expect("tz"),
                },
                AnchorKind::DateTime,
            )
        }
        _ => (
            Anchor::Date {
                start_on: parse_local_date(str_of(anchor, "startOn")).expect("start"),
            },
            AnchorKind::Date,
        ),
    };
    let rule = v["rrule"]
        .as_str()
        .map(|text| parse_rule(text, kind).expect("rule"));
    let mut exdates: Vec<String> = v["exdates"]
        .as_array()
        .expect("exdates")
        .iter()
        .map(|e| e.as_str().expect("exdate").to_owned())
        .collect();
    exdates.sort();
    exdates.dedup();
    RecurrenceSpec {
        anchor,
        rule,
        exdates,
    }
}

#[test]
fn every_valid_rule_yields_an_occurrence_within_the_horizon() {
    // Invariant relied upon by engine.rs: the crate stops silently after 100 000 empty loops, so
    // each rule of the subset must produce results quickly from any anchor.
    let upper = parse_local_date_time("2100-12-31T23:59:59").expect("upper");
    let mut checked = 0;
    for v in VECTORS["ruleCodec"].as_array().expect("ruleCodec") {
        if v.get("canonical").is_none() {
            continue;
        }
        let rule = parse_rule(str_of(v, "input"), anchor_kind(v)).expect("valid");
        let start = parse_local_date_time("2026-01-31T09:00:00").expect("start");
        let found = engine::floating_occurrences(start, &rule, upper)
            .unwrap_or_else(|e| panic!("{}: {e:?}", str_of(v, "id")));
        assert!(!found.is_empty(), "{}", str_of(v, "id"));
        checked += 1;
    }
    assert!(checked > 30);
}

#[test]
fn expand_vectors() {
    let vectors = VECTORS["expand"].as_array().expect("expand");
    assert!(vectors.len() > 30);
    for v in vectors {
        let id = str_of(v, "id");
        let spec = spec_from(v);
        let range = &v["range"];
        let req = ExpandRequest {
            from: parse_instant(str_of(range, "from")).expect(id),
            to: parse_instant(str_of(range, "to")).expect(id),
            range_time_zone: parse_time_zone(str_of(range, "timeZone")).expect(id),
            limit: usize::try_from(v["limit"].as_u64().expect("limit")).expect("limit"),
        };
        let result = expand(&spec, &req);
        if let Some(expected) = v.get("error") {
            let error = result.expect_err(id);
            assert_eq!(code_name(&error), expected.as_str().expect("error"), "{id}");
            continue;
        }
        let expansion = result.unwrap_or_else(|e| panic!("{id}: {e:?}"));
        let got: Vec<(String, String)> = expansion
            .occurrences
            .iter()
            .map(|o| {
                let when = match &o.start {
                    OccurrenceStart::Instant { at, .. } => format_instant(*at),
                    OccurrenceStart::Date(d) => format_local_date(*d),
                };
                (o.key.clone(), when)
            })
            .collect();
        let expected: Vec<(String, String)> = v["expected"]
            .as_array()
            .expect("expected")
            .iter()
            .map(|e| {
                let when = e.get("start").or_else(|| e.get("date")).expect("when");
                (
                    str_of(e, "key").to_owned(),
                    when.as_str().expect("when").to_owned(),
                )
            })
            .collect();
        assert_eq!(got, expected, "{id}");
        assert_eq!(
            expansion.truncated,
            v["truncated"].as_bool().expect("truncated"),
            "{id} truncated"
        );
    }
}

#[test]
fn date_next_vectors() {
    let vectors = VECTORS["dateNext"].as_array().expect("dateNext");
    let max = parse_local_date_time("2199-12-31T23:59:59").expect("max");
    for v in vectors {
        let id = str_of(v, "id");
        let rule = parse_rule(str_of(v, "rrule"), AnchorKind::Date).expect(id);
        let anchor = parse_local_date(str_of(v, "anchor")).expect(id);
        let after = parse_local_date(str_of(v, "after")).expect(id);
        let start = anchor.to_datetime(jiff::civil::Time::MIN);
        let next = engine::floating_occurrences(start, &rule, max)
            .expect(id)
            .into_iter()
            .map(|dt| dt.date())
            .find(|d| *d > after)
            .map(format_local_date);
        let expected = v["expected"].as_str().map(str::to_owned);
        assert_eq!(next, expected, "{id}");
    }
}

fn timed_spec(start: &str, zone: &str, rule: Option<&str>) -> RecurrenceSpec {
    RecurrenceSpec {
        anchor: Anchor::DateTime {
            start_local: parse_local_date_time(start).expect("start"),
            time_zone_id: zone.to_owned(),
            time_zone: parse_time_zone(zone).expect("tz"),
        },
        rule: rule.map(|r| parse_rule(r, AnchorKind::DateTime).expect("rule")),
        exdates: vec![],
    }
}

#[test]
fn validate_spec_until_before_start() {
    let spec = timed_spec(
        "2026-11-01T09:00:00",
        "Europe/Paris",
        Some("FREQ=DAILY;UNTIL=20261031T000000Z"),
    );
    assert_eq!(
        code_name(&validate_spec(&spec).expect_err("before")),
        "until_before_start"
    );
    let ok = timed_spec(
        "2026-11-01T09:00:00",
        "Europe/Paris",
        Some("FREQ=DAILY;UNTIL=20261101T080000Z"),
    );
    assert!(validate_spec(&ok).is_ok());
    let dated = RecurrenceSpec {
        anchor: Anchor::Date {
            start_on: parse_local_date("2026-11-01").expect("d"),
        },
        rule: Some(parse_rule("FREQ=DAILY;UNTIL=20261031", AnchorKind::Date).expect("r")),
        exdates: vec![],
    };
    assert_eq!(
        code_name(&validate_spec(&dated).expect_err("before")),
        "until_before_start"
    );
}

#[test]
fn validate_spec_rejects_bad_exdates() {
    let mut spec = timed_spec("2026-11-01T09:00:00", "Europe/Paris", None);
    spec.exdates = vec!["2026-11-01".to_owned()];
    assert!(matches!(
        validate_spec(&spec),
        Err(TimeError::InvalidExdate { .. })
    ));
}

fn ts(s: &str) -> Timestamp {
    parse_instant(s).expect("instant")
}

#[test]
fn next_after_is_strictly_after() {
    let spec = timed_spec("2026-11-02T09:00:00", "Europe/Paris", Some("FREQ=DAILY"));
    let first = next_after(&spec, ts("2026-11-03T07:59:59.000Z"))
        .expect("ok")
        .expect("some");
    assert_eq!(first.key, "2026-11-03T09:00:00");
    let second = next_after(&spec, ts("2026-11-03T08:00:00.000Z"))
        .expect("ok")
        .expect("some");
    assert_eq!(second.key, "2026-11-04T09:00:00");
}

#[test]
fn next_after_exhausted_rule_is_none() {
    let spec = timed_spec(
        "2026-11-02T09:00:00",
        "Europe/Paris",
        Some("FREQ=DAILY;COUNT=2"),
    );
    assert_eq!(
        next_after(&spec, ts("2026-11-03T08:00:00.000Z")).expect("ok"),
        None
    );
}

#[test]
fn next_after_horizon_is_ten_years() {
    let spec = timed_spec(
        "2028-02-29T09:00:00",
        "Europe/Paris",
        Some("FREQ=YEARLY;INTERVAL=10"),
    );
    // Hits are 2028, 2048 (2038 is not a leap year): 20 years from 2028-03-01, 10 from 2038-03-01.
    assert_eq!(
        next_after(&spec, ts("2028-03-01T00:00:00.000Z")).expect("ok"),
        None
    );
    let found = next_after(&spec, ts("2038-03-01T00:00:00.000Z"))
        .expect("ok")
        .expect("some");
    assert_eq!(found.key, "2048-02-29T09:00:00");
}

#[test]
fn next_after_dated_anchor_is_not_schedulable() {
    let spec = RecurrenceSpec {
        anchor: Anchor::Date {
            start_on: parse_local_date("2026-11-01").expect("d"),
        },
        rule: None,
        exdates: vec![],
    };
    assert_eq!(
        next_after(&spec, ts("2026-11-01T00:00:00.000Z")),
        Err(TimeError::NotSchedulable)
    );
}

#[test]
fn next_after_fold_and_gap() {
    let spec = timed_spec("2026-10-24T02:30:00", "Europe/Paris", Some("FREQ=DAILY"));
    let n = next_after(&spec, ts("2026-10-24T00:30:00.000Z"))
        .expect("ok")
        .expect("some");
    assert_eq!(n.key, "2026-10-25T02:30:00");
    match n.start {
        OccurrenceStart::Instant { at, nominal_local } => {
            assert_eq!(format_instant(at), "2026-10-25T00:30:00.000Z");
            assert_eq!(format_local_date_time(nominal_local), "2026-10-25T02:30:00");
        }
        OccurrenceStart::Date(_) => panic!("timed"),
    }
}

#[test]
fn expand_range_bounds() {
    let spec = timed_spec("2026-11-02T09:00:00", "Europe/Paris", Some("FREQ=DAILY"));
    let req = |to: &str, limit: usize| ExpandRequest {
        from: ts("2026-01-01T00:00:00.000Z"),
        to: ts(to),
        range_time_zone: parse_time_zone("UTC").expect("tz"),
        limit,
    };
    assert_eq!(
        expand(&spec, &req("2027-02-06T00:00:00.000Z", 10)),
        Err(TimeError::InvalidRange)
    );
    // Exactly 400 days is accepted.
    assert!(expand(&spec, &req("2027-02-05T00:00:00.000Z", 10)).is_ok());
    assert!(matches!(
        expand(&spec, &req("2027-01-01T00:00:00.000Z", 0)),
        Err(TimeError::OutOfRange { .. })
    ));
    assert!(matches!(
        expand(&spec, &req("2027-01-01T00:00:00.000Z", MAX_LIMIT + 1)),
        Err(TimeError::OutOfRange { .. })
    ));
}
