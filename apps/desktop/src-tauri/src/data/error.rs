//! Errors of the data commands, serialisable for the front (spec typed-data-commands 4.3).

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DataError {
    /// `field` is the DTO field name, in camelCase (dotted path for nested fields).
    InvalidInput {
        field: String,
    },
    NotFound,
    /// Identifier already used, unique index, failed compare-and-write.
    Conflict,
    /// Missing foreign key, `CHECK`, `NOT NULL`, `STRICT` type.
    Constraint,
    /// "Secret" setting key.
    Forbidden,
    /// One of the `MAX_*` counts of the configuration import is reached.
    LimitReached,
    /// SQLITE_BUSY / SQLITE_LOCKED after the busy timeout.
    Busy,
    /// A stored row cannot be decoded.
    CorruptData,
    /// Restoration staged (writes refused) or database file missing.
    Unavailable,
    /// Any other database error (logged by code only).
    Database,
}

impl DataError {
    pub fn invalid(field: &str) -> Self {
        Self::InvalidInput {
            field: field.to_owned(),
        }
    }

    /// Maps a SQLite result code (extended codes included), spec 4.3. `None` = no code.
    pub fn from_sqlite_code(code: Option<i64>) -> Self {
        match code {
            Some(c) if matches!(c & 0xFF, 5 | 6) => Self::Busy,
            // SQLITE_CONSTRAINT_PRIMARYKEY and SQLITE_CONSTRAINT_UNIQUE.
            Some(1555 | 2067) => Self::Conflict,
            Some(c) if c & 0xFF == 19 => Self::Constraint,
            Some(c) if c & 0xFF == 14 => Self::Unavailable,
            _ => Self::Database,
        }
    }
}

impl From<sqlx::Error> for DataError {
    fn from(e: sqlx::Error) -> Self {
        if matches!(
            e,
            sqlx::Error::ColumnDecode { .. }
                | sqlx::Error::Decode(_)
                | sqlx::Error::ColumnNotFound(_)
        ) {
            eprintln!("data: row decoding failed");
            return Self::CorruptData;
        }
        let code = e
            .as_database_error()
            .and_then(|d| d.code())
            .and_then(|c| c.parse::<i64>().ok());
        let mapped = Self::from_sqlite_code(code);
        if mapped == Self::Database {
            // Only the kind of error: the message could echo bound values.
            match code {
                Some(c) => eprintln!("data: database error (code {c})"),
                None => eprintln!("data: database error (no code)"),
            }
        }
        mapped
    }
}
