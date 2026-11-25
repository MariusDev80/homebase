//! Search arguments shared by the three search commands (spec 4.4, port of `data/search.ts`).

use super::error::DataError;
use super::validate::utf16_len;
use crate::backup::names::hb_trim;

pub const SEARCH_QUERY_MAX: usize = 200;
pub const SEARCH_LIMIT_MAX: u32 = 20;

/// Query trimmed to 1..=200 UTF-16 units, limit in 1..=20 (`invalid_input` otherwise, query
/// first). Returns the trimmed query.
pub fn valid_search(query: &str, limit: u32) -> Result<&str, DataError> {
    let trimmed = hb_trim(query);
    let len = utf16_len(trimmed);
    if !(1..=SEARCH_QUERY_MAX).contains(&len) {
        return Err(DataError::invalid("query"));
    }
    if !(1..=SEARCH_LIMIT_MAX).contains(&limit) {
        return Err(DataError::invalid("limit"));
    }
    Ok(trimmed)
}

/// `%term%` LIKE pattern with `\`, `%` and `_` escaped (use with `ESCAPE '\'`). SQLite's LIKE is
/// case-insensitive for ASCII only (documented limit, no extension loaded).
pub fn like_contains(term: &str) -> String {
    let mut out = String::with_capacity(term.len() + 2);
    out.push('%');
    for c in term.chars() {
        if matches!(c, '\\' | '%' | '_') {
            out.push('\\');
        }
        out.push(c);
    }
    out.push('%');
    out
}
