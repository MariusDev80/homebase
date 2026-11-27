//! Settings commands: port of `sqlite-settings.repository.spec.ts` plus the cases of 4.11
//! (DTO, T6, T7, timestamps).

use super::support::{Fixture, T0};
use crate::backup::test_support::run;
use crate::data::error::DataError;
use crate::data::settings::{delete_setting, get_setting, list_settings, set_setting, SettingDto};
use crate::data::MAX_SETTINGS;

fn set(f: &Fixture, key: &str, value: &str) -> Result<(), DataError> {
    run(set_setting(&f.ctx, key, value))
}

fn get(f: &Fixture, key: &str) -> Option<String> {
    run(get_setting(&f.ctx, key)).expect("get")
}

/// TS: "round-trips JSON values". The text is stored and returned byte for byte (`1.0` stays).
#[test]
fn round_trips_json_texts_byte_for_byte() {
    let f = Fixture::create();
    let values = [
        r#"{"a":[1,{"b":"c"}]}"#,
        "[1,2,3]",
        "42",
        r#""text""#,
        "true",
        "false",
        "null",
        "1.0",
        r#"{"z":1,"a":2}"#,
    ];
    for (i, value) in values.iter().enumerate() {
        set(&f, &format!("k.{i}"), value).expect("set");
        assert_eq!(get(&f, &format!("k.{i}")).as_deref(), Some(*value));
    }
    assert_eq!(
        run(list_settings(&f.ctx)).expect("list").len(),
        values.len()
    );
}

/// TS: "returns undefined for an absent key" (and L14: a malformed key matches nothing).
#[test]
fn absent_or_malformed_key_reads_none() {
    let f = Fixture::create();
    assert_eq!(get(&f, "missing"), None);
    assert_eq!(get(&f, "Bad Key"), None);
    assert_eq!(get(&f, ""), None);
}

#[test]
fn list_is_ordered_by_key() {
    let f = Fixture::create();
    for key in ["b", "a.z", "a", "c"] {
        set(&f, key, "1").expect("set");
    }
    let keys: Vec<String> = run(list_settings(&f.ctx))
        .expect("list")
        .into_iter()
        .map(|s| s.key)
        .collect();
    assert_eq!(keys, ["a", "a.z", "b", "c"]);
}

/// TS: "updates value and updated_at on a second set, keeping created_at".
#[test]
fn second_set_keeps_created_at_and_bumps_updated_at() {
    let f = Fixture::create();
    set(&f, "ui.theme", r#""dark""#).expect("set");
    f.at("2026-02-02T00:00:00.000Z");
    set(&f, "ui.theme", r#""light""#).expect("set");
    assert_eq!(get(&f, "ui.theme").as_deref(), Some(r#""light""#));
    assert_eq!(
        f.text("SELECT created_at FROM settings WHERE key = 'ui.theme'"),
        T0
    );
    assert_eq!(
        f.text("SELECT updated_at FROM settings WHERE key = 'ui.theme'"),
        "2026-02-02T00:00:00.000Z"
    );
}

/// TS: "remove returns true then false" (and a malformed key is simply `false`).
#[test]
fn delete_returns_true_then_false() {
    let f = Fixture::create();
    set(&f, "a", "1").expect("set");
    assert_eq!(run(delete_setting(&f.ctx, "a")), Ok(true));
    assert_eq!(run(delete_setting(&f.ctx, "a")), Ok(false));
    assert_eq!(run(delete_setting(&f.ctx, "Bad Key")), Ok(false));
}

/// TS: "refuses secret-like keys" (L19).
#[test]
fn secret_like_keys_are_forbidden() {
    let f = Fixture::create();
    for key in [
        "github.token",
        "bank.apiKey",
        "x.password",
        "My.SECRET",
        "a.api-key",
    ] {
        assert_eq!(set(&f, key, r#""v""#), Err(DataError::Forbidden), "{key}");
    }
    assert_eq!(f.scalar("SELECT COUNT(*) FROM settings"), 0);
}

/// TS: "refuses malformed keys"; the secret check comes first (spec 4.4).
#[test]
fn malformed_keys_are_invalid_input() {
    let f = Fixture::create();
    for key in ["Bad Key", "", "1abc", "a b", &"a".repeat(129)] {
        assert_eq!(
            set(&f, key, r#""v""#),
            Err(DataError::invalid("key")),
            "{key}"
        );
    }
    assert_eq!(set(&f, "a".repeat(128).as_str(), "1"), Ok(()));
    // Secret and malformed at once: `forbidden` wins.
    assert_eq!(set(&f, "Bad Token", "1"), Err(DataError::Forbidden));
}

/// TS: "refuses values larger than 65536 characters with constraint"; a non-JSON text too.
#[test]
fn oversized_or_invalid_json_value_is_a_constraint() {
    let f = Fixture::create();
    let big = format!("\"{}\"", "x".repeat(65_536));
    assert_eq!(set(&f, "big", &big), Err(DataError::Constraint));
    let limit = format!("\"{}\"", "x".repeat(65_534));
    assert_eq!(set(&f, "limit", &limit), Ok(()));
    assert_eq!(set(&f, "bad", "{not json"), Err(DataError::Constraint));
}

/// IPC cap of 262 144 bytes: `invalid_input`, before any disk access.
#[test]
fn value_above_the_ipc_cap_is_invalid_before_the_disk() {
    let f = Fixture::create();
    let huge = "x".repeat(262_145);
    assert_eq!(
        run(set_setting(&f.without_disk(), "k", &huge)),
        Err(DataError::invalid("valueJson"))
    );
    assert_eq!(
        run(set_setting(&f.without_disk(), "k", "1")),
        Err(DataError::Unavailable)
    );
}

/// T6: at most 200 settings; an existing key never makes the count overflow.
#[test]
fn the_201st_setting_is_refused_and_an_existing_key_is_not() {
    let f = Fixture::create();
    f.exec(&format!(
        "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < {MAX_SETTINGS})
         INSERT INTO settings (key, value, created_at, updated_at)
         SELECT 'k' || i, '1', '{T0}', '{T0}' FROM n"
    ));
    assert_eq!(f.scalar("SELECT COUNT(*) FROM settings"), MAX_SETTINGS);
    assert_eq!(set(&f, "extra", "1"), Err(DataError::LimitReached));
    assert_eq!(f.scalar("SELECT COUNT(*) FROM settings"), MAX_SETTINGS);
    assert_eq!(get(&f, "extra"), None);
    assert_eq!(set(&f, "k1", "2"), Ok(()));
    assert_eq!(get(&f, "k1").as_deref(), Some("2"));
}

/// T7: writes are refused, nothing is written; reads still work.
#[test]
fn writes_are_unavailable_when_a_restoration_is_staged() {
    let f = Fixture::create();
    set(&f, "a", "1").expect("set");
    let ro = f.read_only();
    assert_eq!(run(set_setting(&ro, "b", "1")), Err(DataError::Unavailable));
    assert_eq!(run(delete_setting(&ro, "a")), Err(DataError::Unavailable));
    assert_eq!(get(&f, "b"), None);
    assert_eq!(run(get_setting(&ro, "a")), Ok(Some("1".to_owned())));
    assert_eq!(run(list_settings(&ro)).expect("list").len(), 1);
}

#[test]
fn timestamps_come_from_the_injected_clock() {
    let f = Fixture::create();
    f.at("2030-05-06T07:08:09.123Z");
    set(&f, "a", "1").expect("set");
    assert_eq!(
        f.text("SELECT created_at || '|' || updated_at FROM settings"),
        "2030-05-06T07:08:09.123Z|2030-05-06T07:08:09.123Z"
    );
}

/// DTO: camelCase exact.
#[test]
fn setting_dto_is_camel_case() {
    let dto = SettingDto {
        key: "a".to_owned(),
        value_json: "1".to_owned(),
    };
    assert_eq!(
        serde_json::to_string(&dto).expect("json"),
        r#"{"key":"a","valueJson":"1"}"#
    );
}
