//! `dashboard_delete`: removes one dashboard after a `pre-delete` backup (spec dashboards-sidebar
//! 4.8). Refusals decided in advance (absent, last, busy) never create an archive.

use super::create::create_backup;
use super::error::BackupError;
use super::names::{is_uuid_shape, BackupKind};
use super::BackupState;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, SqliteConnection};
use std::path::Path;
use std::time::Duration;

const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

fn options(db: &Path) -> SqliteConnectOptions {
    SqliteConnectOptions::new()
        .filename(db)
        .create_if_missing(false)
        .busy_timeout(BUSY_TIMEOUT)
        // Required for the cascade widgets -> notes / todo lists -> todos.
        .foreign_keys(true)
}

/// Counts `(rows with this id, all rows)` of `dashboards`.
async fn count_dashboards(db: &Path, id: &str) -> Result<(i64, i64), BackupError> {
    let mut conn = SqliteConnection::connect_with(&options(db)).await?;
    let result = sqlx::query_as::<_, (i64, i64)>(
        "SELECT (SELECT COUNT(*) FROM dashboards WHERE id = ?1), (SELECT COUNT(*) FROM dashboards)",
    )
    .bind(id)
    .fetch_one(&mut conn)
    .await;
    if let Err(e) = conn.close().await {
        eprintln!("backup: closing the dashboard count connection failed: {e}");
    }
    Ok(result?)
}

async fn delete_row(db: &Path, id: &str) -> Result<u64, BackupError> {
    let mut conn = SqliteConnection::connect_with(&options(db)).await?;
    let result = sqlx::query(
        "DELETE FROM dashboards WHERE id = ?1 AND EXISTS (SELECT 1 FROM dashboards WHERE id <> ?1)",
    )
    .bind(id)
    .execute(&mut conn)
    .await;
    // The statement is already committed or failed: a close error changes nothing.
    if let Err(e) = conn.close().await {
        eprintln!("backup: closing the dashboard delete connection failed: {e}");
    }
    Ok(result?.rows_affected())
}

/// Takes the backup lock, checks the dashboard exists and is not the last one, saves a
/// `pre-delete` backup (database only; failure cancels the deletion), then deletes.
pub async fn delete_dashboard(state: &BackupState, id: &str) -> Result<(), BackupError> {
    if !is_uuid_shape(id) {
        return Err(BackupError::InvalidId);
    }
    let _guard = state.try_acquire()?;
    let db = state.root.db();
    let (found, total) = count_dashboards(&db, id).await?;
    if found == 0 {
        return Err(BackupError::NotFound);
    }
    if total < 2 {
        return Err(BackupError::LastDashboard);
    }
    create_backup(
        &state.root,
        state.clock.as_ref(),
        BackupKind::PreDelete,
        &[],
    )
    .await?;
    if delete_row(&db, id).await? == 0 {
        return Err(BackupError::NotFound);
    }
    Ok(())
}
