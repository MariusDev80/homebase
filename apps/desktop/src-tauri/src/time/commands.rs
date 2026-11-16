//! The two pure, stateless Tauri commands of the time module (ADR-003 section 3.8). Strings only
//! cross the IPC boundary. Input bounds are checked before any conversion or calculation.

use super::error::TimeError;
use super::formats::{
    format_instant, format_local_date, format_local_date_time, parse_instant, parse_local_date,
    parse_local_date_time, parse_time_zone,
};
use super::recurrence::{
    expand, format_rule, parse_rule, validate_spec, Anchor, AnchorKind, ExpandRequest, Expansion,
    OccurrenceStart, RecurrenceSpec, MAX_EXDATES, MAX_LIMIT,
};

const DEFAULT_LIMIT: u32 = 500;
const MAX_EXDATE_CHARS: usize = 19;

#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum AnchorDto {
    #[serde(rename_all = "camelCase")]
    DateTime {
        start_local: String,
        time_zone: String,
    },
    #[serde(rename_all = "camelCase")]
    Date { start_on: String },
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecurrenceSpecDto {
    pub anchor: AnchorDto,
    pub rrule: Option<String>,
    pub exdates: Vec<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpandRangeDto {
    pub from: String,
    pub to: String,
    pub time_zone: String,
    pub limit: Option<u32>,
}

#[derive(Debug, serde::Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum OccurrenceDto {
    #[serde(rename_all = "camelCase")]
    DateTime {
        key: String,
        start: String,
        nominal_local: String,
        time_zone: String,
    },
    #[serde(rename_all = "camelCase")]
    Date { key: String, date: String },
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpansionDto {
    pub occurrences: Vec<OccurrenceDto>,
    pub truncated: bool,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalSpecDto {
    pub rrule: Option<String>,
    pub exdates: Vec<String>,
}

/// Converts and validates a spec; `exdates` come out sorted and de-duplicated (canonical).
fn to_spec(dto: &RecurrenceSpecDto) -> Result<RecurrenceSpec, TimeError> {
    if dto.exdates.len() > MAX_EXDATES {
        return Err(TimeError::InvalidExdate {
            value: format!("{} exdates", dto.exdates.len()),
        });
    }
    // Each exception is at most a date-time (19 characters): bounded before any copy or sort.
    if let Some(long) = dto
        .exdates
        .iter()
        .find(|e| e.chars().count() > MAX_EXDATE_CHARS)
    {
        return Err(TimeError::InvalidExdate {
            value: long.chars().take(64).collect(),
        });
    }
    let (anchor, kind) = match &dto.anchor {
        AnchorDto::DateTime {
            start_local,
            time_zone,
        } => {
            let time_zone_parsed = parse_time_zone(time_zone)?;
            let anchor = Anchor::DateTime {
                start_local: parse_local_date_time(start_local)?,
                time_zone_id: time_zone_parsed
                    .iana_name()
                    .map_or_else(|| time_zone.clone(), str::to_owned),
                time_zone: time_zone_parsed,
            };
            (anchor, AnchorKind::DateTime)
        }
        AnchorDto::Date { start_on } => (
            Anchor::Date {
                start_on: parse_local_date(start_on)?,
            },
            AnchorKind::Date,
        ),
    };
    let rule = dto
        .rrule
        .as_deref()
        .map(|text| parse_rule(text, kind))
        .transpose()?;
    let mut exdates = dto.exdates.clone();
    exdates.sort_unstable();
    exdates.dedup();
    let spec = RecurrenceSpec {
        anchor,
        rule,
        exdates,
    };
    validate_spec(&spec)?;
    Ok(spec)
}

pub(crate) fn validate_dto(dto: &RecurrenceSpecDto) -> Result<CanonicalSpecDto, TimeError> {
    let spec = to_spec(dto)?;
    Ok(CanonicalSpecDto {
        rrule: spec.rule.as_ref().map(format_rule),
        exdates: spec.exdates,
    })
}

pub(crate) fn expand_dto(
    dto: &RecurrenceSpecDto,
    range: &ExpandRangeDto,
) -> Result<ExpansionDto, TimeError> {
    let limit = range.limit.unwrap_or(DEFAULT_LIMIT);
    if limit == 0 || usize::try_from(limit).map_or(true, |l| l > MAX_LIMIT) {
        return Err(TimeError::OutOfRange {
            value: limit.to_string(),
        });
    }
    let spec = to_spec(dto)?;
    let request = ExpandRequest {
        from: parse_instant(&range.from)?,
        to: parse_instant(&range.to)?,
        range_time_zone: parse_time_zone(&range.time_zone)?,
        limit: usize::try_from(limit).unwrap_or(MAX_LIMIT),
    };
    let Expansion {
        occurrences,
        truncated,
    } = expand(&spec, &request)?;
    let zone_id = match &spec.anchor {
        Anchor::DateTime { time_zone_id, .. } => time_zone_id.clone(),
        Anchor::Date { .. } => String::new(),
    };
    let occurrences = occurrences
        .into_iter()
        .map(|occurrence| match occurrence.start {
            OccurrenceStart::Instant { at, nominal_local } => OccurrenceDto::DateTime {
                key: occurrence.key,
                start: format_instant(at),
                nominal_local: format_local_date_time(nominal_local),
                time_zone: zone_id.clone(),
            },
            OccurrenceStart::Date(date) => OccurrenceDto::Date {
                key: occurrence.key,
                date: format_local_date(date),
            },
        })
        .collect();
    Ok(ExpansionDto {
        occurrences,
        truncated,
    })
}

/// Validates a spec and returns its canonical form (rule text, sorted unique exceptions).
#[tauri::command(async)]
pub fn time_validate(spec: RecurrenceSpecDto) -> Result<CanonicalSpecDto, TimeError> {
    validate_dto(&spec)
}

/// Expands a series over `[from, to)` (at most 400 days, at most 1000 occurrences).
#[tauri::command(async)]
pub fn time_expand(
    spec: RecurrenceSpecDto,
    range: ExpandRangeDto,
) -> Result<ExpansionDto, TimeError> {
    expand_dto(&spec, &range)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dto(json: &str) -> RecurrenceSpecDto {
        serde_json::from_str(json).expect("dto")
    }

    const TIMED: &str = r#"{"anchor":{"kind":"date-time","startLocal":"2027-03-27T02:30:00","timeZone":"Europe/Paris"},"rrule":"FREQ=DAILY;COUNT=3","exdates":[]}"#;

    #[test]
    fn expands_a_camel_case_dto() {
        let range: ExpandRangeDto = serde_json::from_str(
            r#"{"from":"2027-03-01T00:00:00.000Z","to":"2027-04-01T00:00:00.000Z","timeZone":"Europe/Paris","limit":10}"#,
        )
        .expect("range");
        let out = expand_dto(&dto(TIMED), &range).expect("expand");
        let json = serde_json::to_value(&out).expect("json");
        assert_eq!(json["truncated"], false);
        assert_eq!(json["occurrences"].as_array().expect("array").len(), 3);
        assert_eq!(json["occurrences"][1]["kind"], "date-time");
        assert_eq!(json["occurrences"][1]["start"], "2027-03-28T01:30:00.000Z");
        assert_eq!(
            json["occurrences"][1]["nominalLocal"],
            "2027-03-28T02:30:00"
        );
        assert_eq!(json["occurrences"][1]["timeZone"], "Europe/Paris");
    }

    #[test]
    fn dated_dto_uses_kebab_case_kind() {
        let spec =
            dto(r#"{"anchor":{"kind":"date","startOn":"2028-02-29"},"rrule":null,"exdates":[]}"#);
        let range: ExpandRangeDto = serde_json::from_str(
            r#"{"from":"2028-01-01T00:00:00.000Z","to":"2028-12-01T00:00:00.000Z","timeZone":"UTC"}"#,
        )
        .expect("range");
        let json = serde_json::to_value(expand_dto(&spec, &range).expect("expand")).expect("json");
        assert_eq!(json["occurrences"][0]["kind"], "date");
        assert_eq!(json["occurrences"][0]["date"], "2028-02-29");
    }

    #[test]
    fn validate_returns_canonical_form() {
        let spec = dto(
            r#"{"anchor":{"kind":"date-time","startLocal":"2026-11-02T09:00:00","timeZone":"Europe/Paris"},"rrule":"FREQ=WEEKLY;BYDAY=WE,MO;INTERVAL=1","exdates":["2026-11-09T09:00:00","2026-11-04T09:00:00","2026-11-09T09:00:00"]}"#,
        );
        let out = validate_dto(&spec).expect("valid");
        assert_eq!(out.rrule.as_deref(), Some("FREQ=WEEKLY;BYDAY=MO,WE"));
        assert_eq!(out.exdates, ["2026-11-04T09:00:00", "2026-11-09T09:00:00"]);
    }

    #[test]
    fn error_serialization_is_exact() {
        let spec = dto(
            r#"{"anchor":{"kind":"date-time","startLocal":"2026-11-02T09:00:00","timeZone":"Europe/Paris"},"rrule":"FREQ=DAILY;COUNT=3;UNTIL=20261231T225959Z","exdates":[]}"#,
        );
        let error = validate_dto(&spec).expect_err("rule");
        assert_eq!(
            serde_json::to_string(&error).expect("json"),
            r#"{"kind":"invalid_rule","code":"count_and_until","part":null}"#
        );
        assert_eq!(
            serde_json::to_string(&TimeError::InvalidRange).expect("json"),
            r#"{"kind":"invalid_range"}"#
        );
    }

    #[test]
    fn oversized_inputs_are_refused_before_any_calculation() {
        let mut spec = dto(TIMED);
        spec.exdates = vec!["2027-03-28T02:30:00".to_owned(); MAX_EXDATES + 1];
        assert!(matches!(
            validate_dto(&spec),
            Err(TimeError::InvalidExdate { .. })
        ));
        let mut spec = dto(TIMED);
        spec.exdates = vec!["x".repeat(20)];
        assert!(
            matches!(validate_dto(&spec), Err(TimeError::InvalidExdate { value }) if value.len() == 20)
        );
        spec.exdates = vec!["y".repeat(100_000)];
        assert!(
            matches!(validate_dto(&spec), Err(TimeError::InvalidExdate { value }) if value.len() == 64)
        );
        let mut spec = dto(TIMED);
        spec.rrule = Some(format!("FREQ={}", "X".repeat(300)));
        assert!(matches!(
            validate_dto(&spec),
            Err(TimeError::InvalidRule {
                code: crate::time::error::RuleErrorCode::TooLong,
                ..
            })
        ));
        let spec = dto(
            r#"{"anchor":{"kind":"date-time","startLocal":"2027-03-27T02:30:00","timeZone":"../../etc/passwd"},"rrule":null,"exdates":[]}"#,
        );
        assert!(matches!(
            validate_dto(&spec),
            Err(TimeError::UnknownTimeZone { .. })
        ));
        let range: ExpandRangeDto = serde_json::from_str(
            r#"{"from":"2027-03-01T00:00:00.000Z","to":"2027-03-02T00:00:00.000Z","timeZone":"UTC","limit":1001}"#,
        )
        .expect("range");
        assert!(matches!(
            expand_dto(&dto(TIMED), &range),
            Err(TimeError::OutOfRange { .. })
        ));
    }

    #[test]
    fn range_of_401_days_is_invalid() {
        let range: ExpandRangeDto = serde_json::from_str(
            r#"{"from":"2026-01-01T00:00:00.000Z","to":"2027-02-06T00:00:00.000Z","timeZone":"UTC"}"#,
        )
        .expect("range");
        assert!(matches!(
            expand_dto(&dto(TIMED), &range),
            Err(TimeError::InvalidRange)
        ));
    }
}
