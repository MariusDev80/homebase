//! CA-TC1-2: every rule of the table of 4.4 (bounds included and excluded, UTF-16 with an emoji,
//! `hb_trim`).

use crate::data::error::DataError;
use crate::data::validate::*;

fn invalid(field: &str) -> Result<(), DataError> {
    Err(DataError::invalid(field))
}

/// Two UTF-16 units, one code point, four bytes.
const EMOJI: &str = "\u{1F600}";

#[test]
fn utf16_length_counts_units() {
    assert_eq!(utf16_len("abc"), 3);
    assert_eq!(utf16_len(EMOJI), 2);
    assert_eq!(utf16_len("\u{E9}"), 1);
}

#[test]
fn creation_ids_must_be_lowercase_uuids() {
    assert_eq!(new_id("3f0c2a5e-8f0b-4c55-9a43-0d2a1d6c9b11"), Ok(()));
    assert_eq!(
        new_id("3F0C2A5E-8F0B-4C55-9A43-0D2A1D6C9B11"),
        invalid("id")
    );
    assert_eq!(new_id(""), invalid("id"));
    assert_eq!(new_id("not-a-uuid"), invalid("id"));
}

#[test]
fn trimmed_names_are_1_to_max_utf16_units() {
    assert_eq!(dashboard_name("  Home \u{00A0}\u{0085}"), Ok("Home"));
    assert_eq!(
        dashboard_name("\u{FEFF} \u{3000}"),
        Err(DataError::invalid("name"))
    );
    assert_eq!(dashboard_name(""), Err(DataError::invalid("name")));
    assert!(dashboard_name(&"a".repeat(100)).is_ok());
    assert!(dashboard_name(&"a".repeat(101)).is_err());
    // Counted after the trim.
    assert!(dashboard_name(&format!(" {} ", "a".repeat(100))).is_ok());
    // 50 emoji = 100 units; 51 = 102.
    assert!(dashboard_name(&EMOJI.repeat(50)).is_ok());
    assert!(dashboard_name(&EMOJI.repeat(51)).is_err());
    assert_eq!(list_name("x"), Ok("x"));
    assert!(list_name(&"a".repeat(80)).is_ok());
    assert!(list_name(&"a".repeat(81)).is_err());
    assert_eq!(list_name(" "), Err(DataError::invalid("name")));
    assert!(shortcut_label(&"a".repeat(80)).is_ok());
    assert_eq!(
        shortcut_label(&"a".repeat(81)),
        Err(DataError::invalid("label"))
    );
    assert_eq!(shortcut_label(""), Err(DataError::invalid("label")));
    assert!(todo_title(&"a".repeat(500)).is_ok());
    assert_eq!(
        todo_title(&"a".repeat(501)),
        Err(DataError::invalid("title"))
    );
    assert!(todo_title(&EMOJI.repeat(250)).is_ok());
    assert!(todo_title(&EMOJI.repeat(251)).is_err());
    assert_eq!(todo_title(" \n"), Err(DataError::invalid("title")));
}

#[test]
fn icon_shape() {
    assert_eq!(icon("th-large"), Ok(()));
    assert_eq!(icon(DEFAULT_ICON), Ok(()));
    assert_eq!(icon("a"), Ok(()));
    assert_eq!(icon(&format!("a{}", "b".repeat(31))), Ok(()));
    assert_eq!(icon(&format!("a{}", "b".repeat(32))), invalid("icon"));
    for bad in ["", "1a", "-a", "A", "a_b", "a b", "\u{E9}", "a\0"] {
        assert_eq!(icon(bad), invalid("icon"), "{bad:?}");
    }
}

#[test]
fn theme_defaults_and_bounds() {
    assert_eq!(theme(None, None), Ok(("{}", 1)));
    assert_eq!(theme(Some("{\"a\":1}"), Some(2)), Ok(("{\"a\":1}", 2)));
    assert_eq!(
        theme(None, Some(0)),
        Err(DataError::invalid("themeVersion"))
    );
    assert_eq!(
        theme(None, Some(-1)),
        Err(DataError::invalid("themeVersion"))
    );
    assert!(theme(None, Some(10_000)).is_ok());
    assert_eq!(
        theme(None, Some(10_001)),
        Err(DataError::invalid("themeVersion"))
    );
    // The version is checked before the text.
    assert_eq!(
        theme(Some("[]"), Some(0)),
        Err(DataError::invalid("themeVersion"))
    );
    assert_eq!(theme(Some("[]"), None), Err(DataError::invalid("theme")));
    assert_eq!(theme(Some(" {}"), None), Err(DataError::invalid("theme")));
    assert_eq!(theme(Some(""), None), Err(DataError::invalid("theme")));
}

#[test]
fn theme_depth_and_size() {
    // `{"a":{"a":...{}...}}` with `depth` levels.
    let nested = |depth: usize| {
        format!(
            "{}{{}}{}",
            "{\"a\":".repeat(depth - 1),
            "}".repeat(depth - 1)
        )
    };
    assert_eq!(json_depth("{}"), 1);
    assert_eq!(json_depth(&nested(100)), 100);
    assert_eq!(json_depth("{\"a\":[{\"b\":\"}}]]\"}]}"), 3);
    assert_eq!(json_depth("{\"a\":\"\\\"{\"}"), 1);
    assert_eq!(json_depth("}}"), 0);
    assert!(theme(Some(&nested(100)), None).is_ok());
    assert_eq!(
        theme(Some(&nested(101)), None),
        Err(DataError::invalid("theme"))
    );
    // 4 096 code points, not bytes: an emoji is one. `{"a":""}` is 8 characters.
    let text = |n: usize| format!("{{\"a\":\"{}\"}}", EMOJI.repeat(n));
    assert!(theme(Some(&text(4_096 - 8)), None).is_ok());
    assert_eq!(
        theme(Some(&text(4_096 - 7)), None),
        Err(DataError::invalid("theme"))
    );
    // IPC cap.
    let huge = format!("{{{}", " ".repeat(MAX_JSON_BYTES));
    assert_eq!(theme(Some(&huge), None), Err(DataError::invalid("theme")));
}

#[test]
fn grid_rectangle() {
    assert_eq!(grid(0, 0, 1, 1), Ok(()));
    assert_eq!(grid(10_000, 10_000, 10_000, 10_000), Ok(()));
    assert_eq!(grid(-1, 0, 1, 1), invalid("grid"));
    assert_eq!(grid(0, -1, 1, 1), invalid("grid"));
    assert_eq!(grid(10_001, 0, 1, 1), invalid("grid"));
    assert_eq!(grid(0, 10_001, 1, 1), invalid("grid"));
    assert_eq!(grid(0, 0, 0, 1), invalid("grid"));
    assert_eq!(grid(0, 0, 1, 0), invalid("grid"));
    assert_eq!(grid(0, 0, 10_001, 1), invalid("grid"));
    assert_eq!(grid(0, 0, 1, 10_001), invalid("grid"));
}

#[test]
fn batches_are_bounded_and_distinct() {
    assert_eq!(batch_len(0, "items"), Ok(()));
    assert_eq!(batch_len(1_000, "items"), Ok(()));
    assert_eq!(batch_len(1_001, "items"), invalid("items"));
    assert_eq!(batch_len(1_001, "ids"), invalid("ids"));
    assert_eq!(distinct(["a", "b", "c"], "ids"), Ok(()));
    assert_eq!(distinct([], "ids"), Ok(()));
    assert_eq!(distinct(["a", "b", "a"], "ids"), invalid("ids"));
}

#[test]
fn ids_of_a_batch_are_bounded_in_bytes() {
    assert_eq!(id_sizes([], "ids"), Ok(()));
    assert_eq!(id_sizes(["a".repeat(36).as_str()], "ids"), Ok(()));
    assert_eq!(id_sizes(["a".repeat(64).as_str()], "ids"), Ok(()));
    assert_eq!(id_sizes(["a".repeat(65).as_str()], "ids"), invalid("ids"));
    assert_eq!(
        id_sizes(["a", "é".repeat(33).as_str()], "ids"),
        invalid("ids")
    );
}

#[test]
fn json_texts_are_capped_in_bytes() {
    assert_eq!(json_text(&"a".repeat(262_144), "configJson"), Ok(()));
    assert_eq!(
        json_text(&"a".repeat(262_145), "configJson"),
        invalid("configJson")
    );
    // Bytes, not characters.
    assert_eq!(
        json_text(&"\u{E9}".repeat(131_073), "valueJson"),
        invalid("valueJson")
    );
}

#[test]
fn setting_keys() {
    assert_eq!(setting_key_for_write("dashboard.last"), Ok(()));
    assert_eq!(
        setting_key_for_write("github.token"),
        Err(DataError::Forbidden)
    );
    // Secret wins over a bad shape.
    assert_eq!(setting_key_for_write("TOKEN"), Err(DataError::Forbidden));
    assert_eq!(setting_key_for_write("Theme"), invalid("key"));
    assert_eq!(setting_key_for_write(""), invalid("key"));
    assert_eq!(
        setting_key_for_write(&format!("a{}", "b".repeat(127))),
        Ok(())
    );
    assert_eq!(
        setting_key_for_write(&format!("a{}", "b".repeat(128))),
        invalid("key")
    );
    for key in [
        "API_KEY",
        "my.api-key",
        "Password",
        "x.credential",
        "apikey",
    ] {
        assert!(is_secret_setting_key(key), "{key}");
    }
    assert!(!is_secret_setting_key("theme"));
    assert!(is_setting_key_shape("a.b_c-d9"));
    assert!(!is_setting_key_shape("9a"));
    assert!(is_dashboard_icon_shape("a-1"));
}

#[test]
fn note_fields() {
    assert_eq!(note_title(&"a".repeat(200)), Ok(()));
    assert_eq!(note_title(&"a".repeat(201)), invalid("title"));
    assert_eq!(note_title(&EMOJI.repeat(100)), Ok(()));
    assert_eq!(note_title(&EMOJI.repeat(101)), invalid("title"));
    assert_eq!(note_title(""), Ok(()));
    assert_eq!(note_body(&"a".repeat(100_000)), Ok(()));
    assert_eq!(note_body(&"a".repeat(100_001)), invalid("body"));
    assert_eq!(note_body(&EMOJI.repeat(50_000)), Ok(()));
    assert_eq!(note_body(&EMOJI.repeat(50_001)), invalid("body"));
    // IPC cap: 100 000 units of 4 bytes would be 400 000 only with 100 000 emoji (200 000 units,
    // already refused); 3-byte characters reach 300 000 bytes, under the cap.
    assert_eq!(note_body(&"\u{20AC}".repeat(100_000)), Ok(()));
    assert_eq!(MAX_NOTE_BODY_BYTES, 400_000);
}

#[test]
fn shortcut_url_rules() {
    assert_eq!(shortcut_url("http://a"), Ok(()));
    assert_eq!(shortcut_url("https://a"), Ok(()));
    assert_eq!(shortcut_url("HTTP://a"), invalid("url"));
    assert_eq!(shortcut_url("ftp://a"), invalid("url"));
    assert_eq!(shortcut_url("javascript:alert(1)"), invalid("url"));
    assert_eq!(shortcut_url(""), invalid("url"));
    let url = |n: usize| format!("https://{}", "a".repeat(n - 8));
    assert_eq!(shortcut_url(&url(2_048)), Ok(()));
    assert_eq!(shortcut_url(&url(2_049)), invalid("url"));
}

#[test]
fn dates_have_the_iso_shape_and_the_supported_range() {
    assert_eq!(date("2026-11-25", "dueOn"), Ok(()));
    // Well-formed but impossible: left to the CHECK.
    assert_eq!(date("2026-02-30", "dueOn"), Ok(()));
    assert_eq!(date("1900-01-01", "dueOn"), Ok(()));
    assert_eq!(date("2199-12-31", "dueOn"), Ok(()));
    assert_eq!(date("1899-12-31", "dueOn"), invalid("dueOn"));
    assert_eq!(date("2200-01-01", "dueOn"), invalid("dueOn"));
    for bad in [
        "",
        "2026-1-25",
        "2026/11/25",
        "2026-11-2",
        "2026-11-255",
        "26-11-2026",
        "2026-11-2a",
        " 2026-11-25",
    ] {
        assert_eq!(date(bad, "fromOn"), invalid("fromOn"), "{bad:?}");
    }
    // Ten bytes but not ten ASCII characters.
    assert_eq!(date("2026-11-\u{E9}", "toOn"), invalid("toOn"));
}

#[test]
fn description_and_rrule() {
    assert_eq!(description(&"a".repeat(10_000)), Ok(()));
    assert_eq!(description(&"a".repeat(10_001)), invalid("description"));
    assert_eq!(description(&EMOJI.repeat(5_000)), Ok(()));
    assert_eq!(description(&EMOJI.repeat(5_001)), invalid("description"));
    assert_eq!(description("  kept  "), Ok(()));
    assert_eq!(rrule("FREQ=DAILY"), Ok(()));
    assert_eq!(rrule("FREQ=DAIL"), invalid("rrule")); // 9 units
    assert_eq!(rrule("FREQ=DAILY;INTERVAL=1"), Ok(()));
    assert_eq!(rrule("freq=DAILY"), invalid("rrule"));
    assert_eq!(rrule("RRULE:DAILY"), invalid("rrule"));
    assert_eq!(rrule(&format!("FREQ={}", "A".repeat(251))), Ok(())); // 256
    assert_eq!(
        rrule(&format!("FREQ={}", "A".repeat(252))),
        invalid("rrule")
    );
}

#[test]
fn due_limits() {
    assert_eq!(due_limit(0), invalid("limit"));
    assert_eq!(due_limit(1), Ok(()));
    assert_eq!(due_limit(1_000), Ok(()));
    assert_eq!(due_limit(1_001), invalid("limit"));
}

#[test]
fn widget_type_name_and_version_bounds_match_the_import() {
    assert_eq!(widget_type("a"), Ok(()));
    assert_eq!(widget_type(&"x".repeat(64)), Ok(()));
    assert_eq!(widget_type(&"x".repeat(65)), invalid("widgetType"));
    assert_eq!(widget_type(""), invalid("widgetType"));
    assert_eq!(widget_type("a\0"), invalid("widgetType"));
    assert_eq!(config_version(1), Ok(()));
    assert_eq!(config_version(10_000), Ok(()));
    assert_eq!(config_version(0), invalid("configVersion"));
    assert_eq!(config_version(10_001), invalid("configVersion"));
    assert_eq!(dashboard_name("a\0b"), Err(DataError::invalid("name")));
}
