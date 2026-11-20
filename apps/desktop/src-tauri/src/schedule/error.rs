//! Errors of the schedule module, serialisable for the front (lot R3).

use crate::time::error::TimeError;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ScheduleError {
    /// `field` is the DTO field name, in camelCase.
    InvalidInput {
        field: String,
    },
    Time {
        error: TimeError,
    },
    NotFound,
    /// Identifier already used.
    Conflict,
    /// A pomodoro is already running.
    AlreadyRunning,
    /// `MAX_REMINDERS` or `MAX_RUNNING_SESSIONS` reached.
    LimitReached,
    /// SQLITE_BUSY after the busy timeout.
    Busy,
    /// Any other database error (logged without parameter values).
    Database,
}

impl ScheduleError {
    pub fn invalid(field: &str) -> Self {
        Self::InvalidInput {
            field: field.to_owned(),
        }
    }
}

impl From<TimeError> for ScheduleError {
    fn from(error: TimeError) -> Self {
        Self::Time { error }
    }
}

impl From<sqlx::Error> for ScheduleError {
    fn from(e: sqlx::Error) -> Self {
        let code = e
            .as_database_error()
            .and_then(|d| d.code())
            .and_then(|c| c.parse::<i64>().ok());
        match code {
            // SQLITE_BUSY (5), extended codes included.
            Some(c) if c & 0xFF == 5 => Self::Busy,
            // SQLITE_CONSTRAINT_PRIMARYKEY (1555) and SQLITE_CONSTRAINT_UNIQUE (2067).
            Some(1555 | 2067) => Self::Conflict,
            _ => {
                // Only the kind of error: the message could echo bound values.
                match code {
                    Some(c) => eprintln!("schedule: database error (code {c})"),
                    None => eprintln!("schedule: database error (no code)"),
                }
                Self::Database
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_with_a_snake_case_kind() {
        let json = |e: &ScheduleError| serde_json::to_string(e).expect("json");
        assert_eq!(
            json(&ScheduleError::invalid("title")),
            r#"{"kind":"invalid_input","field":"title"}"#
        );
        assert_eq!(
            json(&ScheduleError::AlreadyRunning),
            r#"{"kind":"already_running"}"#
        );
        assert_eq!(
            json(&ScheduleError::from(TimeError::InvalidRange)),
            r#"{"kind":"time","error":{"kind":"invalid_range"}}"#
        );
    }
}
