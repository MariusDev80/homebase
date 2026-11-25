//! Shared fixture of the data tests: a temporary database built with the real migrations, a
//! fixed clock, and raw SQL helpers (test code only: production code has none of this).

use crate::backup::sqlite::supported_schema_version;
use crate::backup::test_support::{make_database, run};
use crate::data::{DataCtx, BUSY_TIMEOUT};
use crate::time::clock::FixedClock;
use crate::time::formats::parse_instant;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, SqliteConnection};
use std::sync::Arc;
use tempfile::TempDir;

pub const T0: &str = "2026-01-01T00:00:00.000Z";

pub struct Fixture {
    pub dir: TempDir,
    pub ctx: DataCtx,
    pub clock: Arc<FixedClock>,
}

impl Fixture {
    pub fn create() -> Self {
        let dir = TempDir::new().expect("dir");
        let db = dir.path().join("homebase.db");
        make_database(&db, supported_schema_version(), false);
        let clock = Arc::new(FixedClock::new(parse_instant(T0).expect("instant")));
        let ctx = DataCtx {
            db,
            clock: clock.clone(),
            busy_timeout: BUSY_TIMEOUT,
            writes_allowed: true,
        };
        Self { dir, ctx, clock }
    }

    /// Moves the fixed clock.
    pub fn at(&self, instant: &str) {
        self.clock.set(parse_instant(instant).expect("instant"));
    }

    /// Same database, writes refused (a restoration is staged, T7).
    pub fn read_only(&self) -> DataCtx {
        DataCtx {
            db: self.ctx.db.clone(),
            clock: self.clock.clone(),
            busy_timeout: BUSY_TIMEOUT,
            writes_allowed: false,
        }
    }

    /// Same clock, a database file that does not exist: any disk access is `Unavailable`.
    pub fn without_disk(&self) -> DataCtx {
        DataCtx {
            db: self.dir.path().join("missing.db"),
            clock: self.clock.clone(),
            busy_timeout: BUSY_TIMEOUT,
            writes_allowed: true,
        }
    }

    async fn open(&self) -> SqliteConnection {
        let options = SqliteConnectOptions::new()
            .filename(&self.ctx.db)
            .foreign_keys(true);
        SqliteConnection::connect_with(&options)
            .await
            .expect("open")
    }

    /// Runs raw statements (separated by `;`) with the checks on.
    pub fn exec(&self, sql: &str) {
        run(async {
            let mut conn = self.open().await;
            sqlx::raw_sql(sql).execute(&mut conn).await.expect("exec");
            conn.close().await.expect("close");
        });
    }

    /// Runs one statement that the `CHECK`s would refuse (simulates a row written outside the app).
    pub fn exec_unchecked(&self, sql: &str) {
        run(async {
            let mut conn = self.open().await;
            sqlx::query("PRAGMA ignore_check_constraints = ON")
                .execute(&mut conn)
                .await
                .expect("pragma");
            sqlx::raw_sql(sql).execute(&mut conn).await.expect("exec");
            conn.close().await.expect("close");
        });
    }

    pub fn scalar(&self, sql: &str) -> i64 {
        run(async {
            let mut conn = self.open().await;
            let value = sqlx::query_scalar::<_, i64>(sql)
                .fetch_one(&mut conn)
                .await
                .expect("scalar");
            conn.close().await.expect("close");
            value
        })
    }

    pub fn text(&self, sql: &str) -> String {
        run(async {
            let mut conn = self.open().await;
            let value = sqlx::query_scalar::<_, String>(sql)
                .fetch_one(&mut conn)
                .await
                .expect("text");
            conn.close().await.expect("close");
            value
        })
    }
}

/// Deterministic lowercase UUID of a number.
pub fn uid(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012x}")
}
