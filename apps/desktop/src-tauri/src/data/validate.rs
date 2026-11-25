//! Bounds and shapes shared by the data commands (spec 4.4) and by the configuration import.
//! Lengths count UTF-16 units wherever the TypeScript repositories counted `.length`; IPC caps
//! count bytes. `trim` is [`hb_trim`].

use super::error::DataError;
use super::MAX_BATCH;
use crate::backup::names::{hb_trim, is_uuid_shape};
use std::collections::HashSet;

/// IPC cap of `configJson`, `themeJson` and `valueJson`.
pub const MAX_JSON_BYTES: usize = 262_144;
/// IPC cap of a note body.
#[cfg_attr(not(test), expect(dead_code, reason = "used by lot TC3"))]
pub const MAX_NOTE_BODY_BYTES: usize = 400_000;
pub const DEFAULT_ICON: &str = "th-large";
pub const DEFAULT_THEME: &str = "{}";
pub const DEFAULT_THEME_VERSION: i64 = 1;
/// Deepest nesting accepted in a theme.
pub const MAX_THEME_DEPTH: usize = 100;
/// Code points, like the `CHECK` of V5.
pub const MAX_THEME_CHARS: usize = 4_096;
pub const MAX_GRID: i64 = 10_000;
pub const MAX_NAME_CHARS: usize = 100;
#[cfg_attr(not(test), expect(dead_code, reason = "used by lot TC3"))]
pub const MAX_LABEL_CHARS: usize = 80;
#[cfg_attr(not(test), expect(dead_code, reason = "used by lot TC3"))]
pub const MAX_LIST_NAME_CHARS: usize = 80;
#[cfg_attr(not(test), expect(dead_code, reason = "used by lot TC3"))]
pub const MAX_TODO_TITLE_CHARS: usize = 500;
#[cfg_attr(not(test), expect(dead_code, reason = "used by lot TC3"))]
pub const MAX_NOTE_TITLE_CHARS: usize = 200;
#[cfg_attr(not(test), expect(dead_code, reason = "used by lot TC3"))]
pub const MAX_NOTE_BODY_CHARS: usize = 100_000;
#[cfg_attr(not(test), expect(dead_code, reason = "used by lot TC3"))]
pub const MAX_URL_CHARS: usize = 2_048;
#[cfg_attr(not(test), expect(dead_code, reason = "used by lot TC3"))]
pub const MAX_DESCRIPTION_CHARS: usize = 10_000;
#[cfg_attr(not(test), expect(dead_code, reason = "used by lot TC3"))]
pub const RRULE_MIN_CHARS: usize = 10;
#[cfg_attr(not(test), expect(dead_code, reason = "used by lot TC3"))]
pub const RRULE_MAX_CHARS: usize = 256;
#[cfg_attr(not(test), expect(dead_code, reason = "used by lot TC3"))]
pub const MAX_DUE_LIMIT: u32 = 1_000;
/// Bounds of a local date (`MIN_LOCAL_DATE`, `MAX_LOCAL_DATE` of the front; years of `time::formats`).
#[cfg_attr(not(test), expect(dead_code, reason = "used by lot TC3"))]
pub const MIN_DATE: &str = "1900-01-01";
#[cfg_attr(not(test), expect(dead_code, reason = "used by lot TC3"))]
pub const MAX_DATE: &str = "2199-12-31";
const MAX_SETTING_KEY_CHARS: usize = 128;
const MAX_ICON_CHARS: usize = 32;
/// `Number.MAX_SAFE_INTEGER` of JavaScript.
const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

/// UTF-16 code units, what JavaScript's `.length` counts.
pub fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// Same as the front's `SECRET_KEY_PATTERN`, written by hand (no `regex`): a key is secret when it
/// contains one of the markers, case-insensitively.
pub fn is_secret_setting_key(key: &str) -> bool {
    const MARKERS: [&str; 9] = [
        "secret",
        "token",
        "password",
        "passwd",
        "credential",
        "apikey",
        "api_key",
        "api-key",
        "api.key",
    ];
    let lower = key.to_lowercase();
    MARKERS.iter().any(|m| lower.contains(m))
}

/// `^[a-z][a-z0-9-]{0,31}$`, checked on bytes (a NUL or any non-ASCII byte is refused).
pub fn is_dashboard_icon_shape(icon: &str) -> bool {
    let bytes = icon.as_bytes();
    let Some((first, rest)) = bytes.split_first() else {
        return false;
    };
    first.is_ascii_lowercase()
        && bytes.len() <= MAX_ICON_CHARS
        && rest
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
}

/// `^[a-z][a-z0-9._-]{0,127}$`
pub fn is_setting_key_shape(key: &str) -> bool {
    let mut chars = key.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    first.is_ascii_lowercase()
        && key.len() <= MAX_SETTING_KEY_CHARS
        && chars
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-'))
}

/// Id of a creation: lowercase UUID shape.
pub fn new_id(id: &str) -> Result<(), DataError> {
    if is_uuid_shape(id) {
        Ok(())
    } else {
        Err(DataError::invalid("id"))
    }
}

/// Trimmed text of 1..=`max` UTF-16 units. Returns the trimmed text.
pub fn trimmed_text<'a>(raw: &'a str, max: usize, field: &str) -> Result<&'a str, DataError> {
    let trimmed = hb_trim(raw);
    if (1..=max).contains(&utf16_len(trimmed)) {
        Ok(trimmed)
    } else {
        Err(DataError::invalid(field))
    }
}

pub fn dashboard_name(raw: &str) -> Result<&str, DataError> {
    trimmed_text(raw, MAX_NAME_CHARS, "name")
}

#[cfg_attr(not(test), expect(dead_code, reason = "used by lot TC3"))]
pub fn list_name(raw: &str) -> Result<&str, DataError> {
    trimmed_text(raw, MAX_LIST_NAME_CHARS, "name")
}

#[cfg_attr(not(test), expect(dead_code, reason = "used by lot TC3"))]
pub fn shortcut_label(raw: &str) -> Result<&str, DataError> {
    trimmed_text(raw, MAX_LABEL_CHARS, "label")
}

#[cfg_attr(not(test), expect(dead_code, reason = "used by lot TC3"))]
pub fn todo_title(raw: &str) -> Result<&str, DataError> {
    trimmed_text(raw, MAX_TODO_TITLE_CHARS, "title")
}

/// Icon of a dashboard.
pub fn icon(icon: &str) -> Result<(), DataError> {
    if is_dashboard_icon_shape(icon) {
        Ok(())
    } else {
        Err(DataError::invalid("icon"))
    }
}

/// Nesting depth of a serialized JSON text (`{}` = 1), brackets inside strings ignored.
pub fn json_depth(text: &str) -> usize {
    let mut depth: i64 = 0;
    let mut max: i64 = 0;
    let (mut in_string, mut escaped) = (false, false);
    for c in text.chars() {
        if in_string {
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_string = false;
            }
        } else if c == '"' {
            in_string = true;
        } else if c == '{' || c == '[' {
            depth += 1;
            max = max.max(depth);
        } else if c == '}' || c == ']' {
            depth -= 1;
        }
    }
    usize::try_from(max).unwrap_or(0)
}

/// Theme of a dashboard (`themeJson`, `themeVersion`): version 1..=2^53-1 (absent: 1), text
/// starting with `{`, nesting <= 100, <= 4 096 code points (absent: `{}`). The version is checked
/// first. Returns the values to store.
pub fn theme(theme_json: Option<&str>, version: Option<i64>) -> Result<(&str, i64), DataError> {
    let version = version.unwrap_or(DEFAULT_THEME_VERSION);
    if !(1..=MAX_SAFE_INTEGER).contains(&version) {
        return Err(DataError::invalid("themeVersion"));
    }
    let text = theme_json.unwrap_or(DEFAULT_THEME);
    if text.len() > MAX_JSON_BYTES
        || !text.starts_with('{')
        || json_depth(text) > MAX_THEME_DEPTH
        || text.chars().count() > MAX_THEME_CHARS
    {
        return Err(DataError::invalid("theme"));
    }
    Ok((text, version))
}

/// Rectangle of the grid: `x`, `y` in 0..=10 000, `w`, `h` in 1..=10 000.
pub fn grid(x: i64, y: i64, w: i64, h: i64) -> Result<(), DataError> {
    let origin = (0..=MAX_GRID).contains(&x) && (0..=MAX_GRID).contains(&y);
    let size = (1..=MAX_GRID).contains(&w) && (1..=MAX_GRID).contains(&h);
    if origin && size {
        Ok(())
    } else {
        Err(DataError::invalid("grid"))
    }
}

/// A batch of at most 1 000 elements (an empty one is the caller's business: no disk access).
#[cfg_attr(not(test), expect(dead_code, reason = "used by lot TC3"))]
pub fn batch_len(len: usize, field: &str) -> Result<(), DataError> {
    if len > MAX_BATCH {
        Err(DataError::invalid(field))
    } else {
        Ok(())
    }
}

/// Distinct ids.
pub fn distinct<'a>(ids: impl IntoIterator<Item = &'a str>, field: &str) -> Result<(), DataError> {
    let mut seen = HashSet::new();
    if ids.into_iter().all(|id| seen.insert(id)) {
        Ok(())
    } else {
        Err(DataError::invalid(field))
    }
}

/// IPC cap of a JSON text (`configJson`, `valueJson`); the rest is the `CHECK`.
pub fn json_text(text: &str, field: &str) -> Result<(), DataError> {
    if text.len() > MAX_JSON_BYTES {
        Err(DataError::invalid(field))
    } else {
        Ok(())
    }
}

/// Key of `setting_set`: secret first (`forbidden`), then shape (`invalid_input`).
pub fn setting_key_for_write(key: &str) -> Result<(), DataError> {
    if is_secret_setting_key(key) {
        return Err(DataError::Forbidden);
    }
    if !is_setting_key_shape(key) {
        return Err(DataError::invalid("key"));
    }
    Ok(())
}

#[cfg_attr(not(test), expect(dead_code, reason = "used by lot TC3"))]
pub fn note_title(title: &str) -> Result<(), DataError> {
    if utf16_len(title) > MAX_NOTE_TITLE_CHARS {
        Err(DataError::invalid("title"))
    } else {
        Ok(())
    }
}

/// UTF-16 length <= 100 000 and IPC cap of 400 000 bytes.
#[cfg_attr(not(test), expect(dead_code, reason = "used by lot TC3"))]
pub fn note_body(body: &str) -> Result<(), DataError> {
    if body.len() > MAX_NOTE_BODY_BYTES || utf16_len(body) > MAX_NOTE_BODY_CHARS {
        Err(DataError::invalid("body"))
    } else {
        Ok(())
    }
}

/// <= 2 048 UTF-16 units, starts with `http://` or `https://` (case-sensitive).
#[cfg_attr(not(test), expect(dead_code, reason = "used by lot TC3"))]
pub fn shortcut_url(url: &str) -> Result<(), DataError> {
    let scheme_ok = url.starts_with("http://") || url.starts_with("https://");
    if utf16_len(url) > MAX_URL_CHARS || !scheme_ok {
        Err(DataError::invalid("url"))
    } else {
        Ok(())
    }
}

/// Shape `YYYY-MM-DD` within 1900-01-01..=2199-12-31 (like `hasLocalDateShape`); an impossible
/// date such as 2026-02-30 is the `CHECK`'s business.
#[cfg_attr(not(test), expect(dead_code, reason = "used by lot TC3"))]
pub fn date(value: &str, field: &str) -> Result<(), DataError> {
    let b = value.as_bytes();
    let ok = b.len() == 10
        && b.iter().enumerate().all(|(i, c)| match i {
            4 | 7 => *c == b'-',
            _ => c.is_ascii_digit(),
        });
    if ok && (MIN_DATE..=MAX_DATE).contains(&value) {
        Ok(())
    } else {
        Err(DataError::invalid(field))
    }
}

/// <= 10 000 UTF-16 units, kept as is (no trim).
#[cfg_attr(not(test), expect(dead_code, reason = "used by lot TC3"))]
pub fn description(text: &str) -> Result<(), DataError> {
    if utf16_len(text) > MAX_DESCRIPTION_CHARS {
        Err(DataError::invalid("description"))
    } else {
        Ok(())
    }
}

/// 10..=256 UTF-16 units and starts with `FREQ=`.
#[cfg_attr(not(test), expect(dead_code, reason = "used by lot TC3"))]
pub fn rrule(rule: &str) -> Result<(), DataError> {
    let len_ok = (RRULE_MIN_CHARS..=RRULE_MAX_CHARS).contains(&utf16_len(rule));
    if len_ok && rule.starts_with("FREQ=") {
        Ok(())
    } else {
        Err(DataError::invalid("rrule"))
    }
}

/// `limit` of the due-date queries: 1..=1 000.
#[cfg_attr(not(test), expect(dead_code, reason = "used by lot TC3"))]
pub fn due_limit(limit: u32) -> Result<(), DataError> {
    if (1..=MAX_DUE_LIMIT).contains(&limit) {
        Ok(())
    } else {
        Err(DataError::invalid("limit"))
    }
}
