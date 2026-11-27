//! CA-TC1-1: serialisation and mapping of every row of the table of 4.3, on real SQLite errors
//! (a database at the latest schema made by `make_database`).

use crate::backup::sqlite::supported_schema_version;
use crate::backup::test_support::{make_database, run};
use crate::data::error::DataError;
use crate::data::{close, connect, DataCtx, BUSY_TIMEOUT};
use crate::time::clock::FixedClock;
use crate::time::formats::parse_instant;
use sqlx::{Row, SqliteConnection};
use std::sync::Arc;
use std::time::Duration;
use tempfile::TempDir;

const AT: &str = "2026-11-25T10:00:00.000Z";
const ID: &str = "3f0c2a5e-8f0b-4c55-9a43-0d2a1d6c9b11";

fn ctx(dir: &TempDir, busy_timeout: Duration) -> DataCtx {
    let db = dir.path().join("homebase.db");
    if !db.exists() {
        make_database(&db, supported_schema_version(), false);
    }
    DataCtx {
        db,
        clock: Arc::new(FixedClock::new(parse_instant(AT).expect("instant"))),
        busy_timeout,
        writes_allowed: true,
    }
}

/// Runs statements on a fresh connection and maps the error of the last one.
fn error_of(sql: &str) -> DataError {
    let dir = TempDir::new().expect("dir");
    let ctx = ctx(&dir, BUSY_TIMEOUT);
    run(async {
        let mut conn = connect(&ctx).await.expect("connect");
        sqlx::raw_sql("CREATE TABLE u (a TEXT UNIQUE); CREATE TABLE s (n INTEGER) STRICT;")
            .execute(&mut conn)
            .await
            .expect("tables");
        let result = sqlx::raw_sql(sql).execute(&mut conn).await;
        close(conn).await;
        DataError::from(result.expect_err("the statement must fail"))
    })
}

fn json(e: &DataError) -> String {
    serde_json::to_string(e).expect("json")
}

#[test]
fn serializes_with_a_snake_case_kind() {
    assert_eq!(
        json(&DataError::invalid("grid.w")),
        r#"{"kind":"invalid_input","field":"grid.w"}"#
    );
    for (error, kind) in [
        (DataError::NotFound, "not_found"),
        (DataError::Conflict, "conflict"),
        (DataError::Constraint, "constraint"),
        (DataError::Forbidden, "forbidden"),
        (DataError::LimitReached, "limit_reached"),
        (DataError::Busy, "busy"),
        (DataError::CorruptData, "corrupt_data"),
        (DataError::Unavailable, "unavailable"),
        (DataError::Database, "database"),
    ] {
        assert_eq!(json(&error), format!(r#"{{"kind":"{kind}"}}"#));
    }
}

#[test]
fn primary_key_and_unique_violations_are_conflicts() {
    let setting = format!(
        "INSERT INTO settings (key, value, created_at, updated_at) VALUES ('k', '1', '{AT}', '{AT}')"
    );
    assert_eq!(
        error_of(&format!("{setting}; {setting}")),
        DataError::Conflict
    );
    assert_eq!(
        error_of("INSERT INTO u VALUES ('x'); INSERT INTO u VALUES ('x')"),
        DataError::Conflict
    );
}

#[test]
fn other_constraint_violations_are_constraints() {
    let dashboard = |name: &str| {
        format!(
            "INSERT INTO dashboards (id, name, sort_order, created_at, updated_at) VALUES ('{ID}', {name}, 0, '{AT}', '{AT}')"
        )
    };
    // CHECK (empty name).
    assert_eq!(error_of(&dashboard("''")), DataError::Constraint);
    // NOT NULL.
    assert_eq!(error_of(&dashboard("NULL")), DataError::Constraint);
    // Foreign key (no such dashboard).
    assert_eq!(
        error_of(&format!(
            "INSERT INTO widget_instances (id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h, config, config_version, created_at, updated_at) VALUES ('{ID}', '{ID}', 'note', 0, 0, 1, 1, '{{}}', 1, '{AT}', '{AT}')"
        )),
        DataError::Constraint
    );
    // STRICT table type (SQLITE_CONSTRAINT_DATATYPE).
    assert_eq!(
        error_of("INSERT INTO s VALUES ('abc')"),
        DataError::Constraint
    );
}

#[test]
fn a_busy_database_is_busy() {
    let dir = TempDir::new().expect("dir");
    let ctx = ctx(&dir, Duration::from_millis(50));
    let error = run(async {
        let mut holder = connect(&ctx).await.expect("holder");
        sqlx::query("BEGIN IMMEDIATE")
            .execute(&mut holder)
            .await
            .expect("begin");
        let mut other = connect(&ctx).await.expect("other");
        let result = sqlx::query("BEGIN IMMEDIATE").execute(&mut other).await;
        close(other).await;
        close(holder).await;
        DataError::from(result.expect_err("busy"))
    });
    assert_eq!(error, DataError::Busy);
}

#[test]
fn a_missing_file_is_unavailable() {
    let dir = TempDir::new().expect("dir");
    let ctx = DataCtx {
        db: dir.path().join("absent.db"),
        clock: Arc::new(FixedClock::new(parse_instant(AT).expect("instant"))),
        busy_timeout: BUSY_TIMEOUT,
        writes_allowed: true,
    };
    assert_eq!(run(connect(&ctx)).err(), Some(DataError::Unavailable));
}

#[test]
fn undecodable_rows_are_corrupt_data() {
    let dir = TempDir::new().expect("dir");
    let ctx = ctx(&dir, BUSY_TIMEOUT);
    let (decode, missing) = run(async {
        let mut conn: SqliteConnection = connect(&ctx).await.expect("connect");
        let decode = sqlx::query_scalar::<_, i64>("SELECT 'abc'")
            .fetch_one(&mut conn)
            .await
            .expect_err("type mismatch");
        let row = sqlx::query("SELECT 1 AS a")
            .fetch_one(&mut conn)
            .await
            .expect("row");
        let missing = row.try_get::<i64, _>("nope").expect_err("no column");
        close(conn).await;
        (decode, missing)
    });
    assert_eq!(DataError::from(decode), DataError::CorruptData);
    assert_eq!(DataError::from(missing), DataError::CorruptData);
    assert_eq!(
        DataError::from(sqlx::Error::Decode("x".into())),
        DataError::CorruptData
    );
}

#[test]
fn any_other_error_is_a_database_error() {
    assert_eq!(error_of("SELECT * FROM missing_table"), DataError::Database);
    assert_eq!(
        DataError::from(sqlx::Error::PoolTimedOut),
        DataError::Database
    );
}

#[test]
fn result_codes_map_with_their_extended_variants() {
    use DataError::*;
    for (code, expected) in [
        (5, Busy),
        (6, Busy),
        (261, Busy), // SQLITE_BUSY_RECOVERY
        (262, Busy), // SQLITE_LOCKED_SHAREDCACHE
        (1555, Conflict),
        (2067, Conflict),
        (19, Constraint),
        (275, Constraint),
        (787, Constraint),
        (1299, Constraint),
        (3091, Constraint),
        (14, Unavailable),
        (1038, Unavailable), // SQLITE_CANTOPEN_ISDIR
        (1, Database),
        (11, Database),
    ] {
        assert_eq!(DataError::from_sqlite_code(Some(code)), expected, "{code}");
    }
    assert_eq!(DataError::from_sqlite_code(None), Database);
}
