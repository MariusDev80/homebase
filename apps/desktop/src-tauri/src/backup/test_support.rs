//! Test helpers shared by the backup modules (`#[cfg(test)]` only).

use sha2::{Digest, Sha384};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode};
use sqlx::{Connection, SqliteConnection};
use std::future::Future;
use std::path::Path;

/// Runs a future to completion on the Tauri async runtime (S3).
pub fn run<F: Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
}

/// Exact DDL of `_sqlx_migrations` as created by sqlx-sqlite 0.8.6 (`migrate.rs`).
pub const SQLX_MIGRATIONS_DDL: &str = "
CREATE TABLE IF NOT EXISTS _sqlx_migrations (
    version BIGINT PRIMARY KEY,
    description TEXT NOT NULL,
    installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    success BOOLEAN NOT NULL,
    checksum BLOB NOT NULL,
    execution_time BIGINT NOT NULL
);
";

/// `(name, type, notnull, pk, hidden)` of `pragma_table_xinfo('_sqlx_migrations')`, in `cid` order (V25).
pub const V25_COLUMNS: [(&str, &str, i64, i64, i64); 6] = [
    ("version", "BIGINT", 0, 1, 0),
    ("description", "TEXT", 1, 0, 0),
    ("installed_on", "TIMESTAMP", 1, 0, 0),
    ("success", "BOOLEAN", 1, 0, 0),
    ("checksum", "BLOB", 1, 0, 0),
    ("execution_time", "BIGINT", 1, 0, 0),
];

/// Creates a WAL database at `path` with migrations `1..=up_to` applied the way sqlx does
/// (SHA-384 checksums, `raw_sql`). With `with_sample_rows`, one setting and one dashboard.
pub fn make_database(path: &Path, up_to: i64, with_sample_rows: bool) {
    run(async {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal);
        let mut conn = SqliteConnection::connect_with(&options)
            .await
            .expect("open");
        sqlx::raw_sql(SQLX_MIGRATIONS_DDL)
            .execute(&mut conn)
            .await
            .expect("ddl");
        for m in crate::db::migrations()
            .into_iter()
            .filter(|m| m.version <= up_to)
        {
            sqlx::raw_sql(m.sql).execute(&mut conn).await.expect("sql");
            let checksum = Sha384::digest(m.sql.as_bytes()).to_vec();
            sqlx::query(
                "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) VALUES (?1, ?2, 1, ?3, 0)",
            )
            .bind(m.version)
            .bind(m.description)
            .bind(checksum)
            .execute(&mut conn)
            .await
            .expect("record");
        }
        if with_sample_rows {
            let at = "2026-10-21T08:15:00.123Z";
            sqlx::query("INSERT INTO settings (key, value, created_at, updated_at) VALUES ('theme', '\"dark\"', ?1, ?1)")
                .bind(at)
                .execute(&mut conn)
                .await
                .expect("setting");
            sqlx::query("INSERT INTO dashboards (id, name, sort_order, created_at, updated_at) VALUES ('3f0c2a5e-8f0b-4c55-9a43-0d2a1d6c9b11', 'Home', 0, ?1, ?1)")
                .bind(at)
                .execute(&mut conn)
                .await
                .expect("dashboard");
        }
        conn.close().await.expect("close");
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Row;
    use tempfile::TempDir;

    #[test]
    fn migrations_table_matches_v25() {
        let dir = TempDir::new().expect("tmp");
        let db = dir.path().join("homebase.db");
        make_database(&db, 3, true);
        let rows = run(async {
            let options = SqliteConnectOptions::new().filename(&db).read_only(true);
            let mut conn = SqliteConnection::connect_with(&options)
                .await
                .expect("open");
            let rows = sqlx::query(
                "SELECT name, type, \"notnull\", pk, hidden FROM pragma_table_xinfo('_sqlx_migrations') ORDER BY cid",
            )
            .fetch_all(&mut conn)
            .await
            .expect("xinfo");
            conn.close().await.expect("close");
            rows
        });
        let actual: Vec<(String, String, i64, i64, i64)> = rows
            .iter()
            .map(|r| (r.get(0), r.get(1), r.get(2), r.get(3), r.get(4)))
            .collect();
        let expected: Vec<(String, String, i64, i64, i64)> = V25_COLUMNS
            .iter()
            .map(|(a, b, c, d, e)| ((*a).to_owned(), (*b).to_owned(), *c, *d, *e))
            .collect();
        assert_eq!(actual, expected);
    }
}
