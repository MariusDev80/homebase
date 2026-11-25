//! CA-TC1-4: `like_contains` and `valid_search`.

use crate::data::error::DataError;
use crate::data::search::{like_contains, valid_search};

#[test]
fn like_contains_escapes_backslash_percent_and_underscore() {
    assert_eq!(like_contains("abc"), "%abc%");
    assert_eq!(like_contains("100%"), "%100\\%%");
    assert_eq!(like_contains("a_b"), "%a\\_b%");
    assert_eq!(like_contains("a\\b"), "%a\\\\b%");
    assert_eq!(like_contains("\\%_"), "%\\\\\\%\\_%");
    assert_eq!(like_contains("\u{E9}\u{1F600}"), "%\u{E9}\u{1F600}%");
}

#[test]
fn valid_search_trims_the_query() {
    assert_eq!(valid_search("  milk \u{00A0}\u{0085}", 5), Ok("milk"));
}

#[test]
fn valid_search_query_bounds() {
    assert_eq!(valid_search("", 1), Err(DataError::invalid("query")));
    assert_eq!(
        valid_search(" \t\u{3000} ", 1),
        Err(DataError::invalid("query"))
    );
    assert!(valid_search("a", 1).is_ok());
    assert!(valid_search(&"a".repeat(200), 1).is_ok());
    assert_eq!(
        valid_search(&"a".repeat(201), 1),
        Err(DataError::invalid("query"))
    );
    // Trimmed before counting.
    assert!(valid_search(&format!("  {}  ", "a".repeat(200)), 1).is_ok());
}

#[test]
fn valid_search_counts_utf16_units() {
    // U+1F600 is two UTF-16 units.
    assert!(valid_search(&"\u{1F600}".repeat(100), 1).is_ok());
    assert_eq!(
        valid_search(&"\u{1F600}".repeat(101), 1),
        Err(DataError::invalid("query"))
    );
}

#[test]
fn valid_search_limit_bounds() {
    assert_eq!(valid_search("a", 0), Err(DataError::invalid("limit")));
    assert!(valid_search("a", 1).is_ok());
    assert!(valid_search("a", 20).is_ok());
    assert_eq!(valid_search("a", 21), Err(DataError::invalid("limit")));
}

#[test]
fn valid_search_checks_the_query_before_the_limit() {
    assert_eq!(valid_search("", 0), Err(DataError::invalid("query")));
}
