//! Status markers under `backups\.status\` (spec 4.1, lifecycle table).

use super::error::BackupError;
use super::fsutil::{remove_with_retry, write_json_atomic};
use super::names::{is_raw_copy_dir_name, BackupKind};
use super::paths::DataRoot;
use crate::time::formats::format_instant;
use jiff::Timestamp;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RestoreOutcome {
    Applied,
    RolledBack,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreReport {
    pub outcome: RestoreOutcome,
    pub at: String,
    pub backup_created_at: Option<String>,
    pub backup_kind: Option<BackupKind>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    pub last_restore: Option<RestoreReport>,
    pub db_missing_alert: bool,
    pub pre_migration_failed: bool,
    pub last_auto_error: Option<BackupError>,
    /// Names (never paths) of the `homebase-<stamp>-pre-restore-raw` folders, newest first.
    pub raw_safety_copies: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StartupBlockedReason {
    RollbackFailed,
    RollbackInfoUnreadable,
    ConfirmMarkFailed,
}

#[derive(Serialize)]
struct AtMarker {
    at: String,
}

#[derive(Serialize)]
struct StartupBlockedMarker {
    at: String,
    reason: StartupBlockedReason,
}

pub fn read_last_restore(root: &DataRoot) -> Option<RestoreReport> {
    let bytes = fs::read(root.last_restore_marker()).ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub fn write_last_restore(root: &DataRoot, report: &RestoreReport) -> io::Result<()> {
    write_json_atomic(&root.last_restore_marker(), report)
}

pub fn db_missing_alert(root: &DataRoot) -> bool {
    root.db_missing_marker().exists()
}

pub fn write_db_missing(root: &DataRoot, at: Timestamp) -> io::Result<()> {
    let marker = AtMarker {
        at: format_instant(at),
    };
    write_json_atomic(&root.db_missing_marker(), &marker)
}

pub fn clear_db_missing(root: &DataRoot) -> io::Result<()> {
    remove_with_retry(&root.db_missing_marker())
}

pub fn pre_migration_failed(root: &DataRoot) -> bool {
    root.pre_migration_failed_marker().exists()
}

pub fn write_pre_migration_failed(root: &DataRoot, at: Timestamp) -> io::Result<()> {
    let marker = AtMarker {
        at: format_instant(at),
    };
    write_json_atomic(&root.pre_migration_failed_marker(), &marker)
}

pub fn clear_pre_migration_failed(root: &DataRoot) -> io::Result<()> {
    remove_with_retry(&root.pre_migration_failed_marker())
}

pub fn startup_blocked_exists(root: &DataRoot) -> bool {
    root.startup_blocked_marker().exists()
}

pub fn write_startup_blocked(
    root: &DataRoot,
    at: Timestamp,
    reason: StartupBlockedReason,
) -> io::Result<()> {
    let marker = StartupBlockedMarker {
        at: format_instant(at),
        reason,
    };
    write_json_atomic(&root.startup_blocked_marker(), &marker)
}

pub fn clear_startup_blocked(root: &DataRoot) -> io::Result<()> {
    remove_with_retry(&root.startup_blocked_marker())
}

/// `backup_acknowledge`: removes `last-restore`, `db-missing` and `pre-migration-failed`.
/// Every removal is attempted; the first error is returned.
pub fn acknowledge(root: &DataRoot) -> io::Result<()> {
    let results = [
        remove_with_retry(&root.last_restore_marker()),
        clear_db_missing(root),
        clear_pre_migration_failed(root),
    ];
    results.into_iter().collect()
}

pub fn read_status(root: &DataRoot, last_auto_error: Option<BackupError>) -> BackupStatus {
    BackupStatus {
        last_restore: read_last_restore(root),
        db_missing_alert: db_missing_alert(root),
        pre_migration_failed: pre_migration_failed(root),
        last_auto_error,
        raw_safety_copies: list_raw_safety_copies(root),
    }
}

/// Upper bound of the raw safety copies reported to the front.
const MAX_RAW_SAFETY_COPIES: usize = 20;

/// Names of the valid raw safety copy folders directly under `backups\`, newest first, bounded.
/// Files, symbolic links and invalid names are ignored. Blocking.
pub fn list_raw_safety_copies(root: &DataRoot) -> Vec<String> {
    let Ok(entries) = fs::read_dir(root.backups()) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_str().map(str::to_owned)?;
            if !is_raw_copy_dir_name(&name) {
                return None;
            }
            let meta = fs::symlink_metadata(entry.path()).ok()?;
            meta.is_dir().then_some(name)
        })
        .collect();
    // Fixed-width UTC stamp: the lexical order is the chronological order.
    names.sort_by(|a, b| b.cmp(a));
    names.truncate(MAX_RAW_SAFETY_COPIES);
    names
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn root() -> (TempDir, DataRoot) {
        let dir = TempDir::new().expect("tmp");
        let root = DataRoot::new(dir.path().to_path_buf());
        (dir, root)
    }

    fn at() -> Timestamp {
        crate::time::formats::parse_instant("2026-10-21T08:15:00.123Z").expect("instant")
    }

    fn report(outcome: RestoreOutcome) -> RestoreReport {
        RestoreReport {
            outcome,
            at: "2026-10-21T08:15:00.123Z".into(),
            backup_created_at: Some("2026-10-20T08:00:00.000Z".into()),
            backup_kind: Some(BackupKind::PreRestore),
        }
    }

    #[test]
    fn empty_status_when_no_markers() {
        let (_d, root) = root();
        assert_eq!(
            read_status(&root, None),
            BackupStatus {
                last_restore: None,
                db_missing_alert: false,
                pre_migration_failed: false,
                last_auto_error: None,
                raw_safety_copies: Vec::new(),
            }
        );
    }

    #[test]
    fn last_restore_is_overwritten_by_the_next_restore() {
        let (_d, root) = root();
        write_last_restore(&root, &report(RestoreOutcome::RolledBack)).expect("write");
        assert_eq!(
            read_last_restore(&root),
            Some(report(RestoreOutcome::RolledBack))
        );
        write_last_restore(&root, &report(RestoreOutcome::Applied)).expect("write");
        assert_eq!(
            read_last_restore(&root).map(|r| r.outcome),
            Some(RestoreOutcome::Applied)
        );
    }

    #[test]
    fn last_restore_unreadable_is_none() {
        let (_d, root) = root();
        fs::create_dir_all(root.status_dir()).expect("mkdir");
        fs::write(root.last_restore_marker(), b"{not json").expect("write");
        assert_eq!(read_last_restore(&root), None);
    }

    #[test]
    fn last_restore_json_shape() {
        let json = serde_json::to_value(report(RestoreOutcome::RolledBack)).expect("json");
        assert_eq!(json["outcome"], "rolled-back");
        assert_eq!(json["backupKind"], "pre-restore");
        assert_eq!(json["backupCreatedAt"], "2026-10-20T08:00:00.000Z");
    }

    #[test]
    fn db_missing_lifecycle() {
        let (_d, root) = root();
        assert!(!db_missing_alert(&root));
        write_db_missing(&root, at()).expect("write");
        assert!(db_missing_alert(&root));
        assert!(read_status(&root, None).db_missing_alert);
        clear_db_missing(&root).expect("clear");
        assert!(!db_missing_alert(&root));
        clear_db_missing(&root).expect("clear again");
    }

    #[test]
    fn pre_migration_failed_lifecycle() {
        let (_d, root) = root();
        write_pre_migration_failed(&root, at()).expect("write");
        assert!(read_status(&root, None).pre_migration_failed);
        clear_pre_migration_failed(&root).expect("clear");
        assert!(!pre_migration_failed(&root));
    }

    #[test]
    fn startup_blocked_marker_content_and_clear() {
        let (_d, root) = root();
        assert!(!startup_blocked_exists(&root));
        write_startup_blocked(&root, at(), StartupBlockedReason::ConfirmMarkFailed).expect("write");
        assert!(startup_blocked_exists(&root));
        let v: serde_json::Value =
            serde_json::from_slice(&fs::read(root.startup_blocked_marker()).expect("read"))
                .expect("json");
        assert_eq!(v["reason"], "confirm_mark_failed");
        assert_eq!(v["at"], "2026-10-21T08:15:00.123Z");
        clear_startup_blocked(&root).expect("clear");
        assert!(!startup_blocked_exists(&root));
    }

    #[test]
    fn acknowledge_removes_three_markers_but_not_startup_blocked() {
        let (_d, root) = root();
        write_last_restore(&root, &report(RestoreOutcome::Failed)).expect("write");
        write_db_missing(&root, at()).expect("write");
        write_pre_migration_failed(&root, at()).expect("write");
        write_startup_blocked(&root, at(), StartupBlockedReason::RollbackFailed).expect("write");
        acknowledge(&root).expect("ack");
        assert_eq!(read_last_restore(&root), None);
        assert!(!db_missing_alert(&root));
        assert!(!pre_migration_failed(&root));
        assert!(startup_blocked_exists(&root));
        acknowledge(&root).expect("idempotent");
    }

    #[test]
    fn raw_safety_copies_lists_valid_folders_only_newest_first() {
        let (_d, root) = root();
        assert!(list_raw_safety_copies(&root).is_empty());
        let backups = root.backups();
        fs::create_dir_all(&backups).expect("mkdir");
        let old = "homebase-20261020T081500.123Z-pre-restore-raw";
        let new = "homebase-20261021T081500.123Z-pre-restore-raw";
        for name in [old, new] {
            fs::create_dir(backups.join(name)).expect("dir");
        }
        // Ignored: a file with a valid name, invalid names, another kind, a nested folder.
        fs::write(
            backups.join("homebase-20261022T081500.123Z-pre-restore-raw"),
            b"x",
        )
        .expect("file");
        for bad in [
            "homebase-bad-pre-restore-raw",
            "homebase-20261022T081500.123Z-manual-raw",
            "homebase-20261022T081500.123Z-pre-restore-raw-x",
            "homebase-20261322T081500.123Z-pre-restore-raw",
            "x-20261022T081500.123Z-pre-restore-raw",
        ] {
            fs::create_dir(backups.join(bad)).expect("dir");
        }
        fs::create_dir_all(
            backups
                .join(new)
                .join("homebase-20261023T081500.123Z-pre-restore-raw"),
        )
        .expect("nested");
        let status = read_status(&root, None);
        assert_eq!(status.raw_safety_copies, [new, old]);
        let json = serde_json::to_value(&status).expect("json");
        assert_eq!(json["rawSafetyCopies"], serde_json::json!([new, old]));
        // Names only: no path separator anywhere in the DTO.
        assert!(!json["rawSafetyCopies"].to_string().contains(['\\', '/']));
    }

    #[test]
    fn raw_safety_copies_are_bounded() {
        let (_d, root) = root();
        for day in 1..=25 {
            fs::create_dir_all(root.backups().join(format!(
                "homebase-202610{day:02}T081500.123Z-pre-restore-raw"
            )))
            .expect("dir");
        }
        let names = list_raw_safety_copies(&root);
        assert_eq!(names.len(), 20);
        assert_eq!(names[0], "homebase-20261025T081500.123Z-pre-restore-raw");
    }

    #[test]
    fn status_serializes_camel_case_with_auto_error() {
        let (_d, root) = root();
        let status = read_status(&root, Some(BackupError::DiskFull));
        let json = serde_json::to_value(status).expect("json");
        assert_eq!(json["dbMissingAlert"], false);
        assert_eq!(json["preMigrationFailed"], false);
        assert_eq!(json["lastAutoError"]["kind"], "disk_full");
        assert!(json["lastRestore"].is_null());
    }
}
