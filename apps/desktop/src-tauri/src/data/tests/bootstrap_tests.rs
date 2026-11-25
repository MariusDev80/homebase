//! CA-TC1-3: `ensure_wal` on a real database.

use crate::backup::sqlite::supported_schema_version;
use crate::backup::test_support::{make_database, run};
use crate::data::bootstrap::ensure_wal;
use crate::data::error::DataError;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, SqliteConnection};
use std::path::Path;
use tempfile::TempDir;

fn journal_mode(db: &Path) -> String {
    run(async {
        let options = SqliteConnectOptions::new().filename(db);
        let mut conn = SqliteConnection::connect_with(&options)
            .await
            .expect("open");
        let mode = sqlx::query_scalar::<_, String>("PRAGMA journal_mode")
            .fetch_one(&mut conn)
            .await
            .expect("mode");
        conn.close().await.expect("close");
        mode
    })
}

fn set_delete_mode(db: &Path) {
    run(async {
        let options = SqliteConnectOptions::new().filename(db);
        let mut conn = SqliteConnection::connect_with(&options)
            .await
            .expect("open");
        let mode = sqlx::query_scalar::<_, String>("PRAGMA journal_mode = DELETE")
            .fetch_one(&mut conn)
            .await
            .expect("mode");
        assert_eq!(mode, "delete");
        conn.close().await.expect("close");
    });
}

#[test]
fn a_delete_mode_database_goes_to_wal_and_the_call_is_idempotent() {
    let dir = TempDir::new().expect("dir");
    let db = dir.path().join("homebase.db");
    make_database(&db, supported_schema_version(), true);
    set_delete_mode(&db);
    assert_eq!(journal_mode(&db), "delete");
    assert_eq!(run(ensure_wal(&db)), Ok("wal".to_owned()));
    assert_eq!(journal_mode(&db), "wal");
    assert_eq!(run(ensure_wal(&db)), Ok("wal".to_owned()));
    assert_eq!(journal_mode(&db), "wal");
}

#[test]
fn a_missing_database_is_unavailable_and_is_not_created() {
    let dir = TempDir::new().expect("dir");
    let db = dir.path().join("homebase.db");
    assert_eq!(run(ensure_wal(&db)), Err(DataError::Unavailable));
    assert!(!db.exists());
}
