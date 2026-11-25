//! Startup of the data layer: the WAL journal mode, once per process (spec 4.6, T8). Migrations
//! stay with the SQL plugin (`preload`).

use super::error::DataError;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, SqliteConnection};
use std::path::Path;
use tauri::{AppHandle, Manager, Runtime};

/// Sets `PRAGMA journal_mode = WAL` on a dedicated connection and returns the mode the database
/// reports (lowercase, `wal` on success). Never creates the file. Idempotent.
pub async fn ensure_wal(db: &Path) -> Result<String, DataError> {
    let options = SqliteConnectOptions::new()
        .filename(db)
        .create_if_missing(false)
        .busy_timeout(super::BUSY_TIMEOUT);
    let mut conn = SqliteConnection::connect_with(&options).await?;
    let result = sqlx::query_scalar::<_, String>("PRAGMA journal_mode = WAL")
        .fetch_one(&mut conn)
        .await;
    #[cfg(debug_assertions)]
    if let Ok(mode) = &result {
        log_development_info(&mut conn, mode).await;
    }
    if conn.close().await.is_err() {
        eprintln!("data: closing a database connection failed");
    }
    Ok(result?.to_lowercase())
}

/// Development journal (build debug only): journal mode, SQLite version, last migration.
#[cfg(debug_assertions)]
async fn log_development_info(conn: &mut SqliteConnection, mode: &str) {
    let version = sqlx::query_scalar::<_, String>("SELECT sqlite_version()")
        .fetch_one(&mut *conn)
        .await
        .unwrap_or_else(|_| "?".to_owned());
    let migration =
        sqlx::query_scalar::<_, Option<i64>>("SELECT MAX(version) FROM _sqlx_migrations")
            .fetch_one(&mut *conn)
            .await
            .ok()
            .flatten();
    eprintln!("data: journal_mode={mode} sqlite={version} migration={migration:?}");
}

/// Called in `.setup()` right after `backup::startup::on_app_ready`, before any command can run.
/// Never fails (T8): a failure or a mode other than `wal` is logged and the application goes on.
pub fn at_startup<R: Runtime>(app: &AppHandle<R>) {
    let Some(state) = app.try_state::<crate::backup::BackupState>() else {
        eprintln!("data: the backup state is not managed, WAL not applied");
        return;
    };
    let db = state.root.db();
    match tauri::async_runtime::block_on(ensure_wal(&db)) {
        Ok(mode) if mode == "wal" => {}
        Ok(mode) => eprintln!("data: the journal mode is {mode}, not wal"),
        Err(error) => eprintln!("data: cannot set the WAL journal mode ({error:?})"),
    }
}
