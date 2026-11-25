//! Typed data commands (docs/specs/typed-data-commands.md). Lot TC1: the foundations only
//! (errors, validation, connection, WAL, search arguments); no command is exposed yet.

use crate::backup::BackupState;
use crate::time::clock::Clock;
use crate::time::formats::format_instant;
use error::DataError;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, SqliteConnection};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

/// Opens a dedicated connection (no application lock, T4), runs the body, closes it. The body
/// returns a `Result<_, DataError>`; `?` works inside it. Defined before the submodules so that
/// their code sees it (textual scope); the paths are absolute.
#[cfg_attr(
    not(test),
    expect(
        unused_macros,
        reason = "lot TC1: the commands arrive with TC2 and TC3"
    )
)]
macro_rules! with_conn {
    ($ctx:expr, $conn:ident => $body:expr) => {{
        let mut $conn = $crate::data::connect($ctx).await?;
        let result: Result<_, $crate::data::error::DataError> = async { $body }.await;
        $crate::data::close($conn).await;
        result
    }};
}

pub mod bootstrap;
pub mod error;
pub mod search;
pub mod validate;

/// Wait for another writer (the scheduler, an import, a backup).
pub const BUSY_TIMEOUT: Duration = Duration::from_secs(5);
/// Same limits as the configuration import (T6).
pub const MAX_DASHBOARDS: i64 = 100;
pub const MAX_WIDGETS_PER_DASHBOARD: i64 = 200;
pub const MAX_WIDGETS: i64 = 1_000;
pub const MAX_SETTINGS: i64 = 200;
/// Largest batch (`updateLayout`, `reorder`).
pub const MAX_BATCH: usize = 1_000;

/// Everything a data command needs. Built per command from the managed [`BackupState`].
pub struct DataCtx {
    pub db: PathBuf,
    pub clock: Arc<dyn Clock>,
    pub busy_timeout: Duration,
    /// False once a restoration is staged (T7): every write returns `Unavailable` before any
    /// disk access.
    pub writes_allowed: bool,
}

impl DataCtx {
    pub fn from_backup(state: &BackupState) -> Self {
        Self {
            db: state.root.db(),
            clock: state.clock.clone(),
            busy_timeout: BUSY_TIMEOUT,
            writes_allowed: !state.is_restart_pending(),
        }
    }

    /// Current instant in the stored text form (the only clock is the injected one).
    pub fn now(&self) -> String {
        format_instant(self.clock.now())
    }

    /// First call of every write function.
    pub fn ensure_writable(&self) -> Result<(), DataError> {
        if self.writes_allowed {
            Ok(())
        } else {
            Err(DataError::Unavailable)
        }
    }
}

/// Same options as `schedule::store::connect_with_timeout`: never creates the file, waits for a
/// busy database, enforces foreign keys (cascades). Never sets the journal mode (see
/// `bootstrap`).
pub async fn connect(ctx: &DataCtx) -> Result<SqliteConnection, DataError> {
    let options = SqliteConnectOptions::new()
        .filename(&ctx.db)
        .create_if_missing(false)
        .busy_timeout(ctx.busy_timeout)
        .foreign_keys(true);
    Ok(SqliteConnection::connect_with(&options).await?)
}

pub async fn close(conn: SqliteConnection) {
    // The statements are already committed or failed: a close error changes nothing.
    if conn.close().await.is_err() {
        eprintln!("data: closing a database connection failed");
    }
}

#[cfg(test)]
mod tests {
    mod bootstrap_tests;
    mod ctx_tests;
    mod error_tests;
    mod search_tests;
    mod validate_tests;
}
