//! Timer, stopwatch and pomodoro sessions (spec D7, 4.2): kinds and bounds.

use super::error::ScheduleError;
use super::{DURATION_MAX_MS, DURATION_MIN_MS};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionKind {
    Stopwatch,
    Countdown,
    PomodoroWork,
    PomodoroShortBreak,
    PomodoroLongBreak,
}

impl SessionKind {
    pub fn is_pomodoro(self) -> bool {
        matches!(
            self,
            Self::PomodoroWork | Self::PomodoroShortBreak | Self::PomodoroLongBreak
        )
    }

    /// Value stored in `time_sessions.kind`.
    pub fn as_sql(self) -> &'static str {
        match self {
            Self::Stopwatch => "stopwatch",
            Self::Countdown => "countdown",
            Self::PomodoroWork => "pomodoro_work",
            Self::PomodoroShortBreak => "pomodoro_short_break",
            Self::PomodoroLongBreak => "pomodoro_long_break",
        }
    }

    pub fn from_sql(s: &str) -> Option<Self> {
        Some(match s {
            "stopwatch" => Self::Stopwatch,
            "countdown" => Self::Countdown,
            "pomodoro_work" => Self::PomodoroWork,
            "pomodoro_short_break" => Self::PomodoroShortBreak,
            "pomodoro_long_break" => Self::PomodoroLongBreak,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionRow {
    pub id: String,
    pub kind: SessionKind,
    pub label: String,
    pub started_at: String,
    pub ends_at: Option<String>,
    pub ended_at: Option<String>,
    pub end_reason: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Stopwatch if and only if no duration; otherwise `DURATION_MIN_MS..=DURATION_MAX_MS`.
pub fn check_duration(kind: SessionKind, duration_ms: Option<i64>) -> Result<(), ScheduleError> {
    let ok = match (kind, duration_ms) {
        (SessionKind::Stopwatch, None) => true,
        (SessionKind::Stopwatch, Some(_)) | (_, None) => false,
        (_, Some(ms)) => (DURATION_MIN_MS..=DURATION_MAX_MS).contains(&ms),
    };
    if ok {
        Ok(())
    } else {
        Err(ScheduleError::invalid("durationMs"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const KINDS: [SessionKind; 5] = [
        SessionKind::Stopwatch,
        SessionKind::Countdown,
        SessionKind::PomodoroWork,
        SessionKind::PomodoroShortBreak,
        SessionKind::PomodoroLongBreak,
    ];

    #[test]
    fn sql_names_round_trip_and_match_serde() {
        for kind in KINDS {
            assert_eq!(SessionKind::from_sql(kind.as_sql()), Some(kind));
            assert_eq!(
                serde_json::to_string(&kind).expect("json"),
                format!("\"{}\"", kind.as_sql())
            );
        }
        assert_eq!(SessionKind::from_sql("nope"), None);
        assert_eq!(KINDS.iter().filter(|k| k.is_pomodoro()).count(), 3);
    }

    #[test]
    fn duration_bounds() {
        let bad = Err(ScheduleError::invalid("durationMs"));
        assert!(check_duration(SessionKind::Stopwatch, None).is_ok());
        assert_eq!(check_duration(SessionKind::Stopwatch, Some(5_000)), bad);
        assert_eq!(check_duration(SessionKind::Countdown, None), bad);
        assert_eq!(check_duration(SessionKind::Countdown, Some(999)), bad);
        assert!(check_duration(SessionKind::Countdown, Some(1_000)).is_ok());
        assert!(check_duration(SessionKind::PomodoroWork, Some(86_400_000)).is_ok());
        assert_eq!(
            check_duration(SessionKind::PomodoroWork, Some(86_400_001)),
            bad
        );
    }
}
