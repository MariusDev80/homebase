//! Validation of user texts and identifiers (spec 4.2). Counts are in code points.

use super::error::ScheduleError;
use super::{LABEL_MAX_CHARS, TITLE_MAX_CHARS};
use crate::backup::names::is_uuid_shape;

/// C0 controls, DEL and C1 controls, plus invisible format characters that can spoof the text
/// direction or hide content in a toast: U+200B..U+200F, U+202A..U+202E, U+2066..U+2069, U+FEFF.
fn has_control(s: &str) -> bool {
    s.chars().any(|c| {
        c.is_control()
            || matches!(c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' | '\u{FEFF}')
    })
}

/// Trimmed non-empty, `1..=TITLE_MAX_CHARS` code points, no control character.
pub fn check_title(s: &str) -> Result<(), ScheduleError> {
    let count = s.chars().count();
    if s.trim().is_empty() || count > TITLE_MAX_CHARS || has_control(s) {
        return Err(ScheduleError::invalid("title"));
    }
    Ok(())
}

/// `0..=LABEL_MAX_CHARS` code points, no control character.
pub fn check_label(s: &str) -> Result<(), ScheduleError> {
    if s.chars().count() > LABEL_MAX_CHARS || has_control(s) {
        return Err(ScheduleError::invalid("label"));
    }
    Ok(())
}

pub fn check_id(s: &str) -> Result<(), ScheduleError> {
    if is_uuid_shape(s) {
        Ok(())
    } else {
        Err(ScheduleError::invalid("id"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn title_bounds_and_controls() {
        assert!(check_title("Appeler Léa").is_ok());
        assert!(check_title(&"é".repeat(200)).is_ok());
        assert_eq!(
            check_title(&"é".repeat(201)),
            Err(ScheduleError::invalid("title"))
        );
        for bad in ["", "   ", "\t", "a\u{0}b", "a\nb", "a\u{7f}", "a\u{85}b"] {
            assert_eq!(
                check_title(bad),
                Err(ScheduleError::invalid("title")),
                "{bad:?}"
            );
        }
    }

    #[test]
    fn invisible_format_characters_are_refused() {
        for c in [
            '\u{200B}', '\u{200F}', '\u{202A}', '\u{202E}', '\u{2066}', '\u{2069}', '\u{FEFF}',
        ] {
            let s = format!("a{c}b");
            assert_eq!(
                check_title(&s),
                Err(ScheduleError::invalid("title")),
                "{c:?}"
            );
            assert_eq!(
                check_label(&s),
                Err(ScheduleError::invalid("label")),
                "{c:?}"
            );
        }
        // Neighbours of the ranges stay allowed.
        for c in [
            '\u{2010}', '\u{2029}', '\u{202F}', '\u{2065}', '\u{206A}', '\u{FEFE}',
        ] {
            let s = format!("a{c}b");
            assert!(check_title(&s).is_ok(), "{c:?}");
        }
    }

    #[test]
    fn label_bounds_and_controls() {
        assert!(check_label("").is_ok());
        assert!(check_label(&"x".repeat(100)).is_ok());
        assert_eq!(
            check_label(&"x".repeat(101)),
            Err(ScheduleError::invalid("label"))
        );
        assert_eq!(check_label("a\nb"), Err(ScheduleError::invalid("label")));
    }

    #[test]
    fn id_must_be_a_lowercase_uuid() {
        assert!(check_id("3f0c2a5e-8f0b-4c55-9a43-0d2a1d6c9b11").is_ok());
        assert_eq!(
            check_id("3F0C2A5E-8F0B-4C55-9A43-0D2A1D6C9B11"),
            Err(ScheduleError::invalid("id"))
        );
        assert_eq!(check_id("x"), Err(ScheduleError::invalid("id")));
    }
}
