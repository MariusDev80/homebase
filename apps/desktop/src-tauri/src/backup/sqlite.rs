//! Dedicated sqlx connections for the backup subsystem (spec D1): one connection per operation.

use super::error::BackupError;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, SqliteConnection};
use std::path::Path;

/// Highest schema version known by this binary.
pub fn supported_schema_version() -> i64 {
    crate::db::migrations()
        .iter()
        .map(|m| m.version)
        .max()
        .unwrap_or(0)
}

/// Consistent snapshot of the live database through `VACUUM INTO` on a read-only connection (S1).
/// `target` must not exist. The connection is closed before returning.
pub async fn snapshot_into(db: &Path, target: &Path) -> Result<(), BackupError> {
    let options = SqliteConnectOptions::new().filename(db).read_only(true);
    let mut conn = SqliteConnection::connect_with(&options).await?;
    let target = target.to_string_lossy().into_owned();
    let result = sqlx::query("VACUUM INTO ?1")
        .bind(target)
        .execute(&mut conn)
        .await;
    let closed = conn.close().await;
    result?;
    closed?;
    Ok(())
}

/// Highest applied migration version; `None` when the file or the table is absent.
/// Never creates a file.
pub async fn read_schema_version(db: &Path) -> Result<Option<i64>, BackupError> {
    if !db.is_file() {
        return Ok(None);
    }
    let options = SqliteConnectOptions::new()
        .filename(db)
        .read_only(true)
        .create_if_missing(false);
    let mut conn = SqliteConnection::connect_with(&options).await?;
    let table: Option<(String,)> = sqlx::query_as(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = '_sqlx_migrations'",
    )
    .fetch_optional(&mut conn)
    .await?;
    let version = if table.is_some() {
        let row: (Option<i64>,) = sqlx::query_as("SELECT MAX(version) FROM _sqlx_migrations")
            .fetch_one(&mut conn)
            .await?;
        row.0
    } else {
        None
    };
    conn.close().await?;
    Ok(version)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backup::test_support::{make_database, run};
    use sqlx::Row;
    use tempfile::TempDir;

    #[test]
    fn supported_version_is_latest_migration() {
        assert_eq!(supported_schema_version(), 3);
    }

    #[test]
    fn snapshot_contains_rows_still_in_the_wal() {
        let dir = TempDir::new().expect("tmp");
        let db = dir.path().join("homebase.db");
        make_database(&db, 3, true);
        // Keep a writer open so the rows stay in the -wal file (no checkpoint on close).
        let options = SqliteConnectOptions::new().filename(&db);
        let mut writer = run(SqliteConnection::connect_with(&options)).expect("writer");
        run(sqlx::query(
            "INSERT INTO settings (key, value, created_at, updated_at) VALUES ('wal.row', '1', '2026-10-21T08:15:00.123Z', '2026-10-21T08:15:00.123Z')",
        )
        .execute(&mut writer))
        .expect("insert");
        assert!(
            dir.path()
                .join("homebase.db-wal")
                .metadata()
                .expect("wal")
                .len()
                > 0
        );

        let target = dir.path().join("snap.db");
        run(snapshot_into(&db, &target)).expect("snapshot");
        run(writer.close()).expect("close");

        let options = SqliteConnectOptions::new()
            .filename(&target)
            .read_only(true);
        let mut conn = run(SqliteConnection::connect_with(&options)).expect("open snapshot");
        let row = run(
            sqlx::query("SELECT value FROM settings WHERE key = 'wal.row'").fetch_one(&mut conn),
        )
        .expect("row");
        assert_eq!(row.get::<String, _>(0), "1");
        run(conn.close()).expect("close");
    }

    #[test]
    fn existing_target_is_an_error() {
        let dir = TempDir::new().expect("tmp");
        let db = dir.path().join("homebase.db");
        make_database(&db, 3, false);
        let target = dir.path().join("snap.db");
        std::fs::write(&target, b"x").expect("write");
        let err = run(snapshot_into(&db, &target)).expect_err("must fail");
        assert!(matches!(err, BackupError::Database { .. }), "{err:?}");
        assert_eq!(std::fs::read(&target).expect("read"), b"x");
    }

    #[test]
    fn absent_database_gives_none_and_creates_nothing() {
        let dir = TempDir::new().expect("tmp");
        let db = dir.path().join("homebase.db");
        assert_eq!(run(read_schema_version(&db)).expect("ok"), None);
        assert_eq!(std::fs::read_dir(dir.path()).expect("dir").count(), 0);
    }

    #[test]
    fn reads_the_applied_version() {
        let dir = TempDir::new().expect("tmp");
        let db = dir.path().join("homebase.db");
        make_database(&db, 2, false);
        assert_eq!(run(read_schema_version(&db)).expect("ok"), Some(2));
    }

    #[test]
    fn database_without_migrations_table_gives_none() {
        let dir = TempDir::new().expect("tmp");
        let db = dir.path().join("plain.db");
        let options = SqliteConnectOptions::new()
            .filename(&db)
            .create_if_missing(true);
        let mut conn = run(SqliteConnection::connect_with(&options)).expect("open");
        run(sqlx::query("CREATE TABLE t (a)").execute(&mut conn)).expect("create");
        run(conn.close()).expect("close");
        assert_eq!(run(read_schema_version(&db)).expect("ok"), None);
    }
}
