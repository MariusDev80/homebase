//! Pure Open-Meteo logic (no I/O): input validation, query building, response parsing.

use serde::{Deserialize, Serialize};

use crate::net::NetError;

pub const FORECAST_DAYS: u8 = 7;
pub const GEOCODE_COUNT: u8 = 10;
pub const QUERY_MIN_CHARS: usize = 2;
pub const QUERY_MAX_CHARS: usize = 100;
pub const TEXT_MAX_CHARS: usize = 200;
pub const LANGUAGES: [&str; 2] = ["fr", "en"];
pub const CURRENT_VARIABLES: &str =
    "temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code,wind_speed_10m";
pub const DAILY_VARIABLES: &str =
    "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max";

const MAX_DAYS: usize = 16;
const MAX_PLACES: usize = 10;
const TIME_ZONE_MAX_CHARS: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WeatherError {
    InvalidInput { field: &'static str },
    ClientUnavailable,
    Forbidden,
    Network,
    Timeout,
    UpstreamStatus { status: u16 },
    TooLarge,
    InvalidResponse,
}

impl From<NetError> for WeatherError {
    fn from(error: NetError) -> Self {
        match error {
            NetError::Unavailable => WeatherError::ClientUnavailable,
            NetError::Forbidden => WeatherError::Forbidden,
            NetError::Timeout => WeatherError::Timeout,
            NetError::Network => WeatherError::Network,
            NetError::Status(status) => WeatherError::UpstreamStatus { status },
            NetError::TooLarge => WeatherError::TooLarge,
            NetError::UnexpectedContentType => WeatherError::InvalidResponse,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Place {
    pub id: u64,
    pub name: String,
    pub region: Option<String>,
    pub country: Option<String>,
    pub latitude: f64,
    pub longitude: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Forecast {
    pub time_zone: String,
    pub current: Current,
    pub daily: Vec<Day>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Current {
    pub temperature_c: f64,
    pub apparent_temperature_c: Option<f64>,
    pub relative_humidity_pct: Option<f64>,
    pub wind_speed_kmh: Option<f64>,
    pub weather_code: u8,
    pub is_day: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Day {
    pub date: String,
    pub weather_code: Option<u8>,
    pub temperature_max_c: Option<f64>,
    pub temperature_min_c: Option<f64>,
    pub precipitation_probability_pct: Option<f64>,
}

/// Bidi formatting characters (U+202A..U+202E, U+2066..U+2069) and control characters.
fn is_forbidden_char(c: char) -> bool {
    c.is_control()
        || ('\u{202A}'..='\u{202E}').contains(&c)
        || ('\u{2066}'..='\u{2069}').contains(&c)
}

pub fn validate_coordinates(latitude: f64, longitude: f64) -> Result<(f64, f64), WeatherError> {
    if !(latitude.is_finite() && (-90.0..=90.0).contains(&latitude)) {
        return Err(WeatherError::InvalidInput { field: "latitude" });
    }
    if !(longitude.is_finite() && (-180.0..=180.0).contains(&longitude)) {
        return Err(WeatherError::InvalidInput { field: "longitude" });
    }
    Ok((latitude, longitude))
}

/// `{:.4}`, with negative zero normalised to `0.0000`.
pub fn format_coordinate(value: f64) -> String {
    let text = format!("{value:.4}");
    if text == "-0.0000" {
        "0.0000".to_string()
    } else {
        text
    }
}

pub fn forecast_query(latitude: f64, longitude: f64) -> Vec<(&'static str, String)> {
    vec![
        ("latitude", format_coordinate(latitude)),
        ("longitude", format_coordinate(longitude)),
        ("current", CURRENT_VARIABLES.to_string()),
        ("daily", DAILY_VARIABLES.to_string()),
        ("timezone", "auto".to_string()),
        ("forecast_days", FORECAST_DAYS.to_string()),
        ("temperature_unit", "celsius".to_string()),
        ("wind_speed_unit", "kmh".to_string()),
        ("precipitation_unit", "mm".to_string()),
        ("timeformat", "iso8601".to_string()),
    ]
}

pub fn validate_query(query: &str) -> Result<String, WeatherError> {
    let invalid = WeatherError::InvalidInput { field: "query" };
    let trimmed = query.trim();
    let count = trimmed.chars().count();
    if !(QUERY_MIN_CHARS..=QUERY_MAX_CHARS).contains(&count)
        || trimmed.chars().any(is_forbidden_char)
    {
        return Err(invalid);
    }
    Ok(trimmed.to_string())
}

pub fn validate_language(language: &str) -> Result<&'static str, WeatherError> {
    LANGUAGES
        .iter()
        .copied()
        .find(|candidate| *candidate == language)
        .ok_or(WeatherError::InvalidInput { field: "language" })
}

pub fn geocode_query(query: &str, language: &str) -> Vec<(&'static str, String)> {
    vec![
        ("name", query.to_string()),
        ("count", GEOCODE_COUNT.to_string()),
        ("language", language.to_string()),
        ("format", "json".to_string()),
    ]
}

#[derive(Deserialize)]
struct RawForecast {
    timezone: String,
    current_units: RawCurrentUnits,
    current: RawCurrent,
    daily_units: RawDailyUnits,
    daily: RawDaily,
}

#[derive(Deserialize)]
struct RawCurrentUnits {
    temperature_2m: String,
    wind_speed_10m: String,
}

#[derive(Deserialize)]
struct RawCurrent {
    temperature_2m: Option<f64>,
    apparent_temperature: Option<f64>,
    relative_humidity_2m: Option<f64>,
    is_day: Option<f64>,
    weather_code: Option<f64>,
    wind_speed_10m: Option<f64>,
}

#[derive(Deserialize)]
struct RawDailyUnits {
    temperature_2m_max: String,
}

#[derive(Deserialize)]
struct RawDaily {
    time: Vec<String>,
    weather_code: Vec<Option<f64>>,
    temperature_2m_max: Vec<Option<f64>>,
    temperature_2m_min: Vec<Option<f64>>,
    precipitation_probability_max: Vec<Option<f64>>,
}

#[derive(Deserialize)]
struct RawGeocode {
    results: Option<Vec<RawPlace>>,
}

#[derive(Deserialize)]
struct RawPlace {
    id: Option<u64>,
    name: Option<String>,
    latitude: Option<f64>,
    longitude: Option<f64>,
    admin1: Option<String>,
    country: Option<String>,
}

fn bounded(value: Option<f64>, min: f64, max: f64) -> Option<f64> {
    value.filter(|v| v.is_finite() && (min..=max).contains(v))
}

fn weather_code(value: Option<f64>) -> Option<u8> {
    value
        .filter(|v| v.is_finite() && v.fract() == 0.0 && (0.0..=99.0).contains(v))
        .map(|v| v as u8)
}

fn is_valid_time_zone(zone: &str) -> bool {
    if zone.is_empty() || zone.chars().count() > TIME_ZONE_MAX_CHARS {
        return false;
    }
    let tail_char = |c: char| c.is_ascii_alphanumeric() || matches!(c, '_' | '+' | '-');
    zone.split('/').enumerate().all(|(index, segment)| {
        let mut chars = segment.chars();
        match chars.next() {
            None => false,
            Some(first) if index == 0 => first.is_ascii_alphabetic() && chars.all(tail_char),
            Some(first) => tail_char(first) && chars.all(tail_char),
        }
    })
}

/// Shape `NNNN-NN-NN` (calendar validity is checked by the front).
fn is_date_shape(date: &str) -> bool {
    let bytes = date.as_bytes();
    bytes.len() == 10
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            4 | 7 => *byte == b'-',
            _ => byte.is_ascii_digit(),
        })
}

pub fn parse_forecast(body: &[u8]) -> Result<Forecast, WeatherError> {
    let invalid = WeatherError::InvalidResponse;
    let raw: RawForecast = serde_json::from_slice(body).map_err(|_| invalid.clone())?;

    if !is_valid_time_zone(&raw.timezone)
        || raw.current_units.temperature_2m != "°C"
        || raw.current_units.wind_speed_10m != "km/h"
        || raw.daily_units.temperature_2m_max != "°C"
    {
        return Err(invalid);
    }

    let current = &raw.current;
    let temperature_c = bounded(current.temperature_2m, -100.0, 100.0).ok_or(invalid.clone())?;
    let weather_code_now = weather_code(current.weather_code).ok_or(invalid.clone())?;

    let daily = &raw.daily;
    let length = daily.time.len();
    if !(1..=MAX_DAYS).contains(&length)
        || daily.weather_code.len() != length
        || daily.temperature_2m_max.len() != length
        || daily.temperature_2m_min.len() != length
        || daily.precipitation_probability_max.len() != length
        || !daily.time.iter().all(|date| is_date_shape(date))
        || !daily.time.windows(2).all(|pair| pair[0] < pair[1])
    {
        return Err(invalid);
    }

    let days = (0..length)
        .map(|i| Day {
            date: daily.time[i].clone(),
            weather_code: weather_code(daily.weather_code[i]),
            temperature_max_c: bounded(daily.temperature_2m_max[i], -100.0, 100.0),
            temperature_min_c: bounded(daily.temperature_2m_min[i], -100.0, 100.0),
            precipitation_probability_pct: bounded(
                daily.precipitation_probability_max[i],
                0.0,
                100.0,
            ),
        })
        .collect();

    Ok(Forecast {
        time_zone: raw.timezone.clone(),
        current: Current {
            temperature_c,
            apparent_temperature_c: bounded(current.apparent_temperature, -100.0, 100.0),
            relative_humidity_pct: bounded(current.relative_humidity_2m, 0.0, 100.0),
            wind_speed_kmh: bounded(current.wind_speed_10m, 0.0, 500.0),
            weather_code: weather_code_now,
            is_day: current.is_day != Some(0.0),
        },
        daily: days,
    })
}

/// Trimmed optional text: `None` if empty, too long or containing a dangerous character.
fn clean_text(value: Option<String>) -> Option<String> {
    let text = value?;
    let text = text.trim();
    let valid = !text.is_empty()
        && text.chars().count() <= TEXT_MAX_CHARS
        && !text.chars().any(is_forbidden_char);
    valid.then(|| text.to_string())
}

pub fn parse_places(body: &[u8]) -> Result<Vec<Place>, WeatherError> {
    let raw: RawGeocode =
        serde_json::from_slice(body).map_err(|_| WeatherError::InvalidResponse)?;
    let mut places: Vec<Place> = Vec::new();
    for entry in raw.results.unwrap_or_default() {
        if places.len() >= MAX_PLACES {
            break;
        }
        let (Some(id), Some(name), Some(latitude), Some(longitude)) =
            (entry.id, entry.name, entry.latitude, entry.longitude)
        else {
            continue;
        };
        if validate_coordinates(latitude, longitude).is_err() {
            continue;
        }
        let Some(name) = clean_text(Some(name)) else {
            continue;
        };
        if places.iter().any(|place| place.id == id) {
            continue;
        }
        places.push(Place {
            id,
            name,
            region: clean_text(entry.admin1),
            country: clean_text(entry.country),
            latitude,
            longitude,
        });
    }
    Ok(places)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    const PARIS: &str = include_str!("fixtures/forecast_paris.json");
    const NULLS: &str = include_str!("fixtures/forecast_nulls.json");
    const BAD_UNITS: &str = include_str!("fixtures/forecast_bad_units.json");
    const MISMATCHED: &str = include_str!("fixtures/forecast_mismatched_lengths.json");
    const AMIENS: &str = include_str!("fixtures/geocode_amiens.json");
    const EMPTY: &str = include_str!("fixtures/geocode_empty.json");
    const PARTIAL: &str = include_str!("fixtures/geocode_partial.json");

    const LAT: WeatherError = WeatherError::InvalidInput { field: "latitude" };
    const LON: WeatherError = WeatherError::InvalidInput { field: "longitude" };

    fn paris_with(change: impl FnOnce(&mut Value)) -> Vec<u8> {
        let mut value: Value = serde_json::from_str(PARIS).unwrap();
        change(&mut value);
        serde_json::to_vec(&value).unwrap()
    }

    #[test]
    fn coordinates_validation() {
        for (a, b) in [(0.0, 0.0), (90.0, 180.0), (-90.0, -180.0)] {
            assert_eq!(validate_coordinates(a, b), Ok((a, b)));
        }
        for v in [
            90.0001,
            -90.0001,
            f64::NAN,
            f64::INFINITY,
            f64::NEG_INFINITY,
        ] {
            assert_eq!(validate_coordinates(v, 0.0), Err(LAT), "{v}");
        }
        for v in [180.1, -180.1, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert_eq!(validate_coordinates(0.0, v), Err(LON), "{v}");
        }
    }

    #[test]
    fn coordinate_formatting() {
        assert_eq!(format_coordinate(49.9), "49.9000");
        assert_eq!(format_coordinate(2.35208), "2.3521");
        assert_eq!(format_coordinate(-0.0), "0.0000");
        assert_eq!(format_coordinate(-107.25119), "-107.2512");
    }

    #[test]
    fn forecast_query_is_exact() {
        let expected: Vec<(&str, String)> = vec![
            ("latitude", "49.9000".into()),
            ("longitude", "2.3000".into()),
            ("current", CURRENT_VARIABLES.into()),
            ("daily", DAILY_VARIABLES.into()),
            ("timezone", "auto".into()),
            ("forecast_days", "7".into()),
            ("temperature_unit", "celsius".into()),
            ("wind_speed_unit", "kmh".into()),
            ("precipitation_unit", "mm".into()),
            ("timeformat", "iso8601".into()),
        ];
        assert_eq!(forecast_query(49.9, 2.3), expected);
    }

    #[test]
    fn query_validation() {
        assert_eq!(validate_query("  Amiens ").as_deref(), Ok("Amiens"));
        assert!(validate_query("Pa").is_ok());
        for bad in ["", " ", "A"] {
            assert!(validate_query(bad).is_err(), "{bad:?}");
        }
        assert!(validate_query(&"é".repeat(100)).is_ok());
        assert!(validate_query(&"é".repeat(101)).is_err());
        for bad in ["Pa\u{7}ris", "Pa\u{202E}ris", "Pa\u{2066}ris"] {
            assert_eq!(
                validate_query(bad),
                Err(WeatherError::InvalidInput { field: "query" })
            );
        }
    }

    #[test]
    fn language_validation() {
        assert_eq!(validate_language("fr"), Ok("fr"));
        assert_eq!(validate_language("en"), Ok("en"));
        for bad in ["de", "FR", "fra", ""] {
            assert_eq!(
                validate_language(bad),
                Err(WeatherError::InvalidInput { field: "language" })
            );
        }
    }

    #[test]
    fn geocode_query_is_exact() {
        let expected: Vec<(&str, String)> = vec![
            ("name", "Amiens".into()),
            ("count", "10".into()),
            ("language", "fr".into()),
            ("format", "json".into()),
        ];
        assert_eq!(geocode_query("Amiens", "fr"), expected);
    }

    #[test]
    fn parses_the_paris_forecast() {
        let day = |date: &str, code, max, min, prob| Day {
            date: date.into(),
            weather_code: Some(code),
            temperature_max_c: Some(max),
            temperature_min_c: Some(min),
            precipitation_probability_pct: Some(prob),
        };
        assert_eq!(
            parse_forecast(PARIS.as_bytes()),
            Ok(Forecast {
                time_zone: "Europe/Paris".into(),
                current: Current {
                    temperature_c: 12.8,
                    apparent_temperature_c: Some(9.7),
                    relative_humidity_pct: Some(74.0),
                    wind_speed_kmh: Some(18.1),
                    weather_code: 3,
                    is_day: true,
                },
                daily: vec![
                    day("2026-10-21", 80, 14.9, 8.4, 35.0),
                    day("2026-10-22", 80, 15.5, 9.0, 25.0),
                    day("2026-10-23", 61, 13.7, 9.9, 91.0),
                ],
            })
        );
    }

    #[test]
    fn nulls_and_out_of_range_values_become_none() {
        let forecast = parse_forecast(NULLS.as_bytes()).unwrap();
        assert_eq!(forecast.current.apparent_temperature_c, None);
        assert_eq!(forecast.current.relative_humidity_pct, None);
        assert_eq!(forecast.daily[0].temperature_max_c, None);
        assert_eq!(forecast.daily[0].weather_code, None);
        assert!(forecast.current.is_day);
    }

    #[test]
    fn invalid_variants_are_refused() {
        let cases: Vec<(&str, Vec<u8>)> = vec![
            (
                "null temp",
                paris_with(|v| v["current"]["temperature_2m"] = Value::Null),
            ),
            (
                "code 3.5",
                paris_with(|v| v["current"]["weather_code"] = json!(3.5)),
            ),
            (
                "code 100",
                paris_with(|v| v["current"]["weather_code"] = json!(100)),
            ),
            (
                "code -1",
                paris_with(|v| v["current"]["weather_code"] = json!(-1)),
            ),
            ("tz empty", paris_with(|v| v["timezone"] = json!(""))),
            ("tz dots", paris_with(|v| v["timezone"] = json!("../etc"))),
            ("tz offset", paris_with(|v| v["timezone"] = json!("+02:00"))),
            (
                "date shape",
                paris_with(|v| v["daily"]["time"][0] = json!("2026-1-01")),
            ),
            (
                "not increasing",
                paris_with(|v| v["daily"]["time"][1] = json!("2026-10-21")),
            ),
            (
                "17 days",
                paris_with(|v| {
                    let n = 17;
                    let times: Vec<String> = (1..=n).map(|d| format!("2026-11-{d:02}")).collect();
                    v["daily"]["time"] = json!(times);
                    for key in [
                        "weather_code",
                        "temperature_2m_max",
                        "temperature_2m_min",
                        "precipitation_probability_max",
                    ] {
                        v["daily"][key] = json!(vec![1; n]);
                    }
                }),
            ),
            ("truncated", PARIS.as_bytes()[..100].to_vec()),
            ("error body", br#"{"error":true,"reason":"x"}"#.to_vec()),
            ("bad units", BAD_UNITS.as_bytes().to_vec()),
            ("mismatched", MISMATCHED.as_bytes().to_vec()),
        ];
        for (label, body) in cases {
            assert_eq!(
                parse_forecast(&body),
                Err(WeatherError::InvalidResponse),
                "{label}"
            );
        }
    }

    #[test]
    fn is_day_zero_means_night() {
        let body = paris_with(|v| v["current"]["is_day"] = json!(0));
        assert!(!parse_forecast(&body).unwrap().current.is_day);
    }

    #[test]
    fn each_wrong_unit_is_refused() {
        let cases = [
            paris_with(|v| v["current_units"]["wind_speed_10m"] = json!("mph")),
            paris_with(|v| v["current_units"]["temperature_2m"] = json!("°F")),
            paris_with(|v| v["daily_units"]["temperature_2m_max"] = json!("°F")),
        ];
        for body in cases {
            assert_eq!(parse_forecast(&body), Err(WeatherError::InvalidResponse));
        }
    }

    #[test]
    fn out_of_range_optional_values_become_none() {
        let body = paris_with(|v| {
            v["current"]["wind_speed_10m"] = json!(501);
            v["current"]["apparent_temperature"] = json!(-101);
            v["daily"]["weather_code"][0] = json!(3.5);
            v["daily"]["weather_code"][1] = json!(100);
            v["daily"]["precipitation_probability_max"][0] = json!(101);
            v["daily"]["temperature_2m_min"][0] = json!(-101);
        });
        let forecast = parse_forecast(&body).unwrap();
        assert_eq!(forecast.current.wind_speed_kmh, None);
        assert_eq!(forecast.current.apparent_temperature_c, None);
        assert_eq!(forecast.daily[0].weather_code, None);
        assert_eq!(forecast.daily[1].weather_code, None);
        assert_eq!(forecast.daily[0].precipitation_probability_pct, None);
        assert_eq!(forecast.daily[0].temperature_min_c, None);
        assert_eq!(forecast.daily[2].weather_code, Some(61));
    }

    #[test]
    fn time_zone_length_is_capped_at_64() {
        let ok = format!("A{}", "b".repeat(63));
        let too_long = format!("A{}", "b".repeat(64));
        let body = paris_with(|v| v["timezone"] = json!(ok));
        assert!(parse_forecast(&body).is_ok());
        let body = paris_with(|v| v["timezone"] = json!(too_long));
        assert_eq!(parse_forecast(&body), Err(WeatherError::InvalidResponse));
    }

    #[test]
    fn place_name_of_200_chars_is_accepted() {
        let results = json!([
            {"id": 1, "name": "x".repeat(200), "latitude": 1.0, "longitude": 2.0},
            {"id": 2, "name": "x".repeat(201), "latitude": 1.0, "longitude": 2.0},
        ]);
        let body = serde_json::to_vec(&json!({ "results": results })).unwrap();
        let places = parse_places(&body).unwrap();
        assert_eq!(places.len(), 1);
        assert_eq!(places[0].id, 1);
    }

    #[test]
    fn unusual_time_zones_are_accepted() {
        for zone in ["GMT", "Etc/GMT", "Etc/GMT+11", "Antarctica/McMurdo"] {
            let body = paris_with(|v| v["timezone"] = json!(zone));
            assert_eq!(parse_forecast(&body).unwrap().time_zone, zone);
        }
    }

    #[test]
    fn parses_places() {
        let places = parse_places(AMIENS.as_bytes()).unwrap();
        let summary: Vec<_> = places
            .iter()
            .map(|p| {
                (
                    p.id,
                    p.name.as_str(),
                    p.region.as_deref(),
                    p.country.as_deref(),
                    p.latitude,
                    p.longitude,
                )
            })
            .collect();
        assert_eq!(
            summary,
            vec![
                (
                    3037854,
                    "Amiens",
                    Some("Hauts-de-France"),
                    Some("France"),
                    49.9,
                    2.3
                ),
                (
                    2177944,
                    "Amiens",
                    Some("Queensland"),
                    Some("Australie"),
                    -28.58803,
                    151.80737
                ),
                (
                    5884494,
                    "Amiens",
                    Some("Saskatchewan"),
                    Some("Canada"),
                    53.31681,
                    -107.25119
                ),
            ]
        );
        assert_eq!(parse_places(EMPTY.as_bytes()), Ok(vec![]));
        assert_eq!(parse_places(b"{"), Err(WeatherError::InvalidResponse));
    }

    #[test]
    fn partial_places_are_filtered() {
        let places = parse_places(PARTIAL.as_bytes()).unwrap();
        assert_eq!(places.len(), 2);
        assert_eq!((places[0].id, places[0].name.as_str()), (100, "Kept"));
        assert_eq!(
            (places[0].region.clone(), places[0].country.clone()),
            (None, None)
        );
        assert_eq!((places[1].id, places[1].name.as_str()), (101, "Valid"));
    }

    #[test]
    fn places_are_capped_at_ten() {
        let results: Vec<Value> = (0..12)
            .map(|i| json!({"id": i, "name": format!("P{i}"), "latitude": 1.0, "longitude": 2.0}))
            .collect();
        let body = serde_json::to_vec(&json!({ "results": results })).unwrap();
        let places = parse_places(&body).unwrap();
        assert_eq!(places.len(), 10);
        assert_eq!(places[9].id, 9);
    }

    #[test]
    fn errors_serialize_as_specified() {
        let cases = [
            (
                WeatherError::InvalidInput { field: "latitude" },
                r#"{"kind":"invalid_input","field":"latitude"}"#,
            ),
            (
                WeatherError::ClientUnavailable,
                r#"{"kind":"client_unavailable"}"#,
            ),
            (WeatherError::Forbidden, r#"{"kind":"forbidden"}"#),
            (WeatherError::Network, r#"{"kind":"network"}"#),
            (WeatherError::Timeout, r#"{"kind":"timeout"}"#),
            (
                WeatherError::UpstreamStatus { status: 429 },
                r#"{"kind":"upstream_status","status":429}"#,
            ),
            (WeatherError::TooLarge, r#"{"kind":"too_large"}"#),
            (
                WeatherError::InvalidResponse,
                r#"{"kind":"invalid_response"}"#,
            ),
        ];
        for (error, expected) in cases {
            assert_eq!(serde_json::to_string(&error).unwrap(), expected);
        }
    }

    #[test]
    fn payload_keys_are_camel_case() {
        let forecast = serde_json::to_value(parse_forecast(PARIS.as_bytes()).unwrap()).unwrap();
        let keys = |v: &Value| {
            let mut keys: Vec<String> = v.as_object().unwrap().keys().cloned().collect();
            keys.sort();
            keys
        };
        assert_eq!(keys(&forecast), ["current", "daily", "timeZone"]);
        assert_eq!(
            keys(&forecast["current"]),
            [
                "apparentTemperatureC",
                "isDay",
                "relativeHumidityPct",
                "temperatureC",
                "weatherCode",
                "windSpeedKmh"
            ]
        );
        assert_eq!(
            keys(&forecast["daily"][0]),
            [
                "date",
                "precipitationProbabilityPct",
                "temperatureMaxC",
                "temperatureMinC",
                "weatherCode"
            ]
        );
        let place = serde_json::to_value(&parse_places(AMIENS.as_bytes()).unwrap()[0]).unwrap();
        assert_eq!(
            keys(&place),
            ["country", "id", "latitude", "longitude", "name", "region"]
        );
    }

    #[test]
    fn net_errors_convert() {
        assert_eq!(
            WeatherError::from(NetError::Unavailable),
            WeatherError::ClientUnavailable
        );
        assert_eq!(
            WeatherError::from(NetError::Forbidden),
            WeatherError::Forbidden
        );
        assert_eq!(WeatherError::from(NetError::Timeout), WeatherError::Timeout);
        assert_eq!(WeatherError::from(NetError::Network), WeatherError::Network);
        assert_eq!(
            WeatherError::from(NetError::Status(503)),
            WeatherError::UpstreamStatus { status: 503 }
        );
        assert_eq!(
            WeatherError::from(NetError::TooLarge),
            WeatherError::TooLarge
        );
        assert_eq!(
            WeatherError::from(NetError::UnexpectedContentType),
            WeatherError::InvalidResponse
        );
    }
}
