//! CA-TC1-5: `DataCtx` (writes refused when a restoration is staged), connection, limits.

use crate::backup::paths::DataRoot;
use crate::backup::sqlite::supported_schema_version;
use crate::backup::test_support::{make_database, run};
use crate::backup::BackupState;
use crate::data::error::DataError;
use crate::data::{
    close, connect, DataCtx, BUSY_TIMEOUT, MAX_BATCH, MAX_DASHBOARDS, MAX_SETTINGS, MAX_WIDGETS,
    MAX_WIDGETS_PER_DASHBOARD,
};
use crate::time::clock::FixedClock;
use crate::time::formats::parse_instant;
use std::sync::Arc;
use tempfile::TempDir;

fn clock() -> Arc<FixedClock> {
    Arc::new(FixedClock::new(
        parse_instant("2026-11-25T10:00:00.250Z").expect("instant"),
    ))
}

fn ctx_for(dir: &TempDir, writes_allowed: bool) -> DataCtx {
    DataCtx {
        db: dir.path().join("homebase.db"),
        clock: clock(),
        busy_timeout: BUSY_TIMEOUT,
        writes_allowed,
    }
}

#[test]
fn ensure_writable_refuses_when_writes_are_not_allowed() {
    let dir = TempDir::new().expect("dir");
    assert_eq!(ctx_for(&dir, true).ensure_writable(), Ok(()));
    assert_eq!(
        ctx_for(&dir, false).ensure_writable(),
        Err(DataError::Unavailable)
    );
}

#[test]
fn from_backup_follows_the_restart_pending_flag() {
    let dir = TempDir::new().expect("dir");
    let state = BackupState::new(DataRoot::new(dir.path().to_path_buf()), clock(), None);
    assert!(!state.is_restart_pending());
    let ctx = DataCtx::from_backup(&state);
    assert!(ctx.writes_allowed);
    assert_eq!(ctx.db, state.root.db());
    assert_eq!(ctx.busy_timeout, BUSY_TIMEOUT);
    state.mark_restart_pending();
    assert!(state.is_restart_pending());
    assert_eq!(
        DataCtx::from_backup(&state).ensure_writable(),
        Err(DataError::Unavailable)
    );
}

#[test]
fn now_reads_the_injected_clock() {
    let dir = TempDir::new().expect("dir");
    assert_eq!(ctx_for(&dir, true).now(), "2026-11-25T10:00:00.250Z");
}

#[test]
fn connect_never_creates_the_file() {
    let dir = TempDir::new().expect("dir");
    let ctx = ctx_for(&dir, true);
    let result = run(connect(&ctx));
    assert_eq!(result.err(), Some(DataError::Unavailable));
    assert!(!ctx.db.exists());
}

#[test]
fn connect_enforces_foreign_keys_and_with_conn_runs_and_closes() {
    let dir = TempDir::new().expect("dir");
    let ctx = ctx_for(&dir, true);
    make_database(&ctx.db, supported_schema_version(), false);
    let enabled: Result<i64, DataError> = run(async {
        with_conn!(&ctx, conn => {
            Ok(sqlx::query_scalar::<_, i64>("PRAGMA foreign_keys")
                .fetch_one(&mut conn)
                .await?)
        })
    });
    assert_eq!(enabled, Ok(1));
    // The connection of a failing body is closed too, and the error is the body's.
    let failed: Result<(), DataError> = run(async {
        with_conn!(&ctx, conn => {
            sqlx::query("SELECT * FROM missing_table").execute(&mut conn).await?;
            Ok(())
        })
    });
    assert_eq!(failed, Err(DataError::Database));
    run(async { close(connect(&ctx).await.expect("connect")).await });
}

#[test]
fn limits_are_those_of_the_configuration_import() {
    assert_eq!(MAX_DASHBOARDS, 100);
    assert_eq!(MAX_WIDGETS_PER_DASHBOARD, 200);
    assert_eq!(MAX_WIDGETS, 1_000);
    assert_eq!(MAX_SETTINGS, 200);
    assert_eq!(MAX_BATCH, 1_000);
}
