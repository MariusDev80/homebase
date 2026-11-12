//! Tests of the restoration (spec 4.8, lot B2b). Faults are injected through `Faults` hooks:
//! a hook returning `Err` is an I/O failure, a hook that unwinds (`crash()`) is a process death
//! (nothing after it runs, no cleanup). No sleeps, no real `%APPDATA%`.

use super::create::create_backup;
use super::error::{ArchiveProblem, BackupError};
use super::list::list_backups;
use super::manifest::{
    Manifest, ManifestFile, DB_ENTRY, MANIFEST_ENTRY, MANIFEST_FORMAT, MANIFEST_VERSION,
};
use super::names::{BackupKind, BackupName};
use super::paths::DataRoot;
use super::restore::{
    confirm_restore, confirm_restore_with, read_restore_info, rollback, stage_restore, swap,
    verify_pending, write_report, ConfirmError, ConfirmStep, Faults, Item, RestoreInfo,
    RollbackError, RollbackStep, StartupStep, SwapStep,
};
use super::sqlite::read_schema_version;
use super::startup::{
    report_blocked, startup_sequence, startup_sequence_with, StartupBlocked, StartupOutcome,
};
use super::status::{
    read_last_restore, startup_blocked_exists, write_db_missing, write_startup_blocked,
    RestoreOutcome, StartupBlockedReason,
};
use super::test_support::{make_database, run};
use super::BackupState;
use crate::time::clock::{Clock, FixedClock};
use crate::time::formats::{format_instant, parse_instant};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::panic::{catch_unwind, resume_unwind, AssertUnwindSafe};
use std::sync::{Arc, Mutex};
use tempfile::TempDir;

const UUID_ORIG: &str = "3f0c2a5e-8f0b-4c55-9a43-0d2a1d6c9b11";
const UUID_NEW: &str = "4a1d3b6f-9a1c-4d66-8b54-1e3b2e7d0c22";
const PNG_ORIG: &[u8] = &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 1, 1];
const PNG_NEW: &[u8] = &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 2, 2, 2];
const RESTORED_DB: &[u8] = b"RESTORED-DATABASE";

type Snap = BTreeMap<String, Vec<u8>>;

fn clock() -> FixedClock {
    FixedClock::new(parse_instant("2026-10-21T08:15:00.123Z").expect("instant"))
}

fn new_root() -> (TempDir, DataRoot) {
    let dir = TempDir::new().expect("tmp");
    let root = DataRoot::new(dir.path().to_path_buf());
    (dir, root)
}

#[derive(Clone, Copy)]
struct Flags {
    db: bool,
    wal: bool,
    shm: bool,
    journal: bool,
    images: bool,
}

const FULL: Flags = Flags {
    db: true,
    wal: true,
    shm: true,
    journal: true,
    images: true,
};

const NOTHING: Flags = Flags {
    db: false,
    wal: false,
    shm: false,
    journal: false,
    images: false,
};

fn seed_original(root: &DataRoot, f: Flags) {
    fs::create_dir_all(root.path()).expect("root");
    let [wal, shm, journal] = root.db_companions();
    for (present, path, bytes) in [
        (f.db, root.db(), &b"ORIGINAL-DB"[..]),
        (f.wal, wal, &b"ORIGINAL-WAL"[..]),
        (f.shm, shm, &b"ORIGINAL-SHM"[..]),
        (f.journal, journal, &b"ORIGINAL-JOURNAL"[..]),
    ] {
        if present {
            fs::write(path, bytes).expect("seed");
        }
    }
    if f.images {
        fs::create_dir_all(root.images()).expect("images");
        fs::write(root.images().join(format!("{UUID_ORIG}.png")), PNG_ORIG).expect("image");
    }
}

/// Database, companions and images of the root, byte for byte.
fn snapshot(root: &DataRoot) -> Snap {
    let mut snap = Snap::new();
    let [wal, shm, journal] = root.db_companions();
    for (key, path) in [
        ("db", root.db()),
        ("wal", wal),
        ("shm", shm),
        ("journal", journal),
    ] {
        if let Ok(bytes) = fs::read(&path) {
            snap.insert(key.to_owned(), bytes);
        }
    }
    if let Ok(entries) = fs::read_dir(root.images()) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            snap.insert(
                format!("images/{name}"),
                fs::read(entry.path()).expect("read image"),
            );
        }
    }
    snap
}

fn restored_snapshot(original: &Snap, includes_images: bool, pending_images: bool) -> Snap {
    let mut snap = Snap::new();
    snap.insert("db".into(), RESTORED_DB.to_vec());
    if includes_images {
        if pending_images {
            snap.insert(format!("images/{UUID_NEW}.png"), PNG_NEW.to_vec());
        }
    } else {
        snap.extend(
            original
                .iter()
                .filter(|(k, _)| k.starts_with("images/"))
                .map(|(k, v)| (k.clone(), v.clone())),
        );
    }
    snap
}

fn hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Writes a valid `restore-pending\` by hand.
fn make_pending(root: &DataRoot, includes_images: bool, with_images: bool) -> Manifest {
    let dir = root.restore_pending();
    fs::create_dir_all(&dir).expect("pending");
    fs::write(dir.join(DB_ENTRY), RESTORED_DB).expect("db");
    let mut files = vec![ManifestFile {
        path: DB_ENTRY.into(),
        size: RESTORED_DB.len() as u64,
        sha256: hex(RESTORED_DB),
    }];
    if with_images {
        fs::create_dir_all(dir.join("images")).expect("images");
        fs::write(dir.join("images").join(format!("{UUID_NEW}.png")), PNG_NEW).expect("image");
        files.push(ManifestFile {
            path: format!("images/{UUID_NEW}.png"),
            size: PNG_NEW.len() as u64,
            sha256: hex(PNG_NEW),
        });
    }
    let manifest = Manifest {
        format: MANIFEST_FORMAT.into(),
        format_version: MANIFEST_VERSION,
        created_at: "2026-10-20T08:00:00.000Z".into(),
        kind: BackupKind::Manual,
        app_version: "0.0.0".into(),
        schema_version: 1,
        includes_images,
        files,
    };
    fs::write(
        dir.join(MANIFEST_ENTRY),
        serde_json::to_vec_pretty(&manifest).expect("json"),
    )
    .expect("manifest");
    manifest
}

fn fixture(flags: Flags, includes_images: bool, pending_images: bool) -> (TempDir, DataRoot, Snap) {
    let (dir, root) = new_root();
    seed_original(&root, flags);
    make_pending(&root, includes_images, pending_images);
    let original = snapshot(&root);
    (dir, root, original)
}

fn start(root: &DataRoot) -> Result<StartupOutcome, StartupBlocked> {
    startup_sequence(root, &clock())
}

/// The `restore-info.json` of the swap just done (what the process keeps in memory).
fn disk_info(root: &DataRoot) -> RestoreInfo {
    read_restore_info(&root.restore_info()).expect("info")
}

fn rollback_leftovers(root: &DataRoot) -> Vec<String> {
    fs::read_dir(root.path())
        .expect("root")
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.starts_with("restore-rollback"))
        .collect()
}

fn last_outcome(root: &DataRoot) -> Option<RestoreOutcome> {
    read_last_restore(root).map(|r| r.outcome)
}

struct Crash;

/// Simulates a process death: unwinds without running the panic hook, nothing after it executes.
fn crash() -> ! {
    resume_unwind(Box::new(Crash))
}

fn crashes<T>(f: impl FnOnce() -> T) -> bool {
    catch_unwind(AssertUnwindSafe(f)).is_err()
}

fn injected() -> io::Error {
    io::Error::other("injected")
}

const SWAP_STEPS: [SwapStep; 8] = [
    SwapStep::RollbackDirCreated,
    SwapStep::InfoWritten,
    SwapStep::DbMoved,
    SwapStep::CompanionsMoved,
    SwapStep::ImagesMoved,
    SwapStep::DbInstalled,
    SwapStep::ImagesInstalled,
    SwapStep::PendingRemoved,
];

fn rollback_points() -> Vec<RollbackStep> {
    let mut points = Vec::new();
    for item in [Item::Db, Item::Wal, Item::Shm, Item::Journal, Item::Images] {
        points.push(RollbackStep::ForeignRemoved(item));
        points.push(RollbackStep::Done(item));
    }
    points.push(RollbackStep::BeforeCleanup);
    points.push(RollbackStep::InfoRemoved);
    points
}

// ---------------------------------------------------------------------------------------------
// Nominal path and confirmation
// ---------------------------------------------------------------------------------------------

#[test]
fn nominal_swap_then_confirmation_applies_the_restoration() {
    let (_d, root, original) = fixture(FULL, true, true);
    write_db_missing(&root, clock().now()).expect("db-missing");
    let outcome = start(&root).expect("start");
    assert!(outcome.swapped);
    assert_eq!(
        snapshot(&root),
        restored_snapshot(&original, true, true),
        "restored state, no companion"
    );
    assert!(!root.restore_pending().exists());
    let info = read_restore_info(&root.restore_info()).expect("info");
    assert!(info.original_had_db && info.original_had_wal && info.original_had_images);

    confirm_restore(&root, &clock(), Some(&disk_info(&root))).expect("confirm");
    assert!(rollback_leftovers(&root).is_empty());
    let report = read_last_restore(&root).expect("report");
    assert_eq!(report.outcome, RestoreOutcome::Applied);
    assert_eq!(report.at, info.started_at);
    assert_eq!(
        report.backup_created_at.as_deref(),
        Some("2026-10-20T08:00:00.000Z")
    );
    assert!(!root.db_missing_marker().exists());
    assert_eq!(snapshot(&root), restored_snapshot(&original, true, true));

    // Next start: nothing left to do, and the restored state stays.
    assert!(!start(&root).expect("restart").swapped);
    assert_eq!(snapshot(&root), restored_snapshot(&original, true, true));
}

#[test]
fn confirm_without_swap_deletes_nothing() {
    let (_d, root, original) = fixture(FULL, true, true);
    start(&root).expect("swap");
    confirm_restore(&root, &clock(), None).expect("no-op");
    assert!(root.restore_rollback().is_dir());
    assert!(root.restore_info().is_file());
    assert_eq!(
        fs::read(root.restore_rollback().join(DB_ENTRY)).expect("db"),
        original["db"]
    );
    assert!(last_outcome(&root).is_none());
}

#[test]
fn confirmation_renames_before_any_deletion() {
    let (_d, root, original) = fixture(FULL, true, true);
    start(&root).expect("swap");
    let seen = Mutex::new(Vec::new());
    let inspect = |step: ConfirmStep| -> io::Result<()> {
        let confirmed: Vec<_> = rollback_leftovers(&root);
        let state = (
            step,
            root.restore_rollback().exists(),
            confirmed.len(),
            confirmed
                .first()
                .map(|n| root.path().join(n).join(DB_ENTRY).exists()),
        );
        seen.lock().expect("lock").push(state);
        Ok(())
    };
    let faults = Faults {
        confirm: Some(&inspect),
        ..Faults::default()
    };
    confirm_restore_with(&root, &clock(), Some(&disk_info(&root)), &faults).expect("confirm");
    let seen = seen.into_inner().expect("seen");
    // After the mark: the original name is gone and the confirmed folder is still complete.
    assert_eq!(seen[0], (ConfirmStep::AfterMark, false, 1, Some(true)));
    assert_eq!(seen[1].0, ConfirmStep::AfterMarkers);
    assert!(seen[1].3 == Some(true));
    assert!(
        seen.iter().all(|s| !s.1),
        "restore-rollback never reappears"
    );
    assert!(
        seen.iter()
            .filter(|s| s.0 == ConfirmStep::DuringDelete)
            .count()
            >= 2
    );
    assert!(rollback_leftovers(&root).is_empty());
    assert_eq!(original["db"], b"ORIGINAL-DB");
}

#[test]
fn crash_after_the_mark_then_restart_finishes_without_restoring() {
    for point in [ConfirmStep::AfterMark, ConfirmStep::AfterMarkers] {
        let (_d, root, original) = fixture(FULL, true, true);
        start(&root).expect("swap");
        // Session writes on the restored database.
        fs::write(root.db_companions()[0].clone(), b"SESSION-WAL").expect("session wal");
        let hook = |step: ConfirmStep| -> io::Result<()> {
            if step == point {
                crash();
            }
            Ok(())
        };
        let faults = Faults {
            confirm: Some(&hook),
            ..Faults::default()
        };
        assert!(crashes(|| confirm_restore_with(
            &root,
            &clock(),
            Some(&disk_info(&root)),
            &faults
        )));
        assert_eq!(rollback_leftovers(&root).len(), 1, "{point:?}");

        let outcome = start(&root).expect("next start");
        assert!(!outcome.swapped);
        assert!(rollback_leftovers(&root).is_empty(), "{point:?}");
        assert_eq!(
            last_outcome(&root),
            Some(RestoreOutcome::Applied),
            "{point:?}"
        );
        let mut expected = restored_snapshot(&original, true, true);
        expected.insert("wal".into(), b"SESSION-WAL".to_vec());
        assert_eq!(snapshot(&root), expected, "{point:?}");
    }
}

#[test]
fn failure_or_crash_while_deleting_a_confirmed_folder_never_restores() {
    // Fail (Err) or crash after the n-th deleted entry, for every n: the folder is half deleted,
    // possibly without its restore-info.json.
    for crash_mode in [false, true] {
        for after in 1..=6usize {
            let (_d, root, original) = fixture(FULL, true, true);
            start(&root).expect("swap");
            fs::write(root.db_companions()[0].clone(), b"SESSION-WAL").expect("session wal");
            let count = Mutex::new(0usize);
            let hook = |step: ConfirmStep| -> io::Result<()> {
                if step == ConfirmStep::DuringDelete {
                    let mut n = count.lock().expect("lock");
                    *n += 1;
                    if *n == after {
                        if crash_mode {
                            crash();
                        }
                        return Err(injected());
                    }
                }
                Ok(())
            };
            let faults = Faults {
                confirm: Some(&hook),
                ..Faults::default()
            };
            if crash_mode {
                assert!(crashes(|| confirm_restore_with(
                    &root,
                    &clock(),
                    Some(&disk_info(&root)),
                    &faults
                )));
            } else {
                confirm_restore_with(&root, &clock(), Some(&disk_info(&root)), &faults)
                    .expect("logged only");
            }
            let leftovers = rollback_leftovers(&root);
            assert_eq!(leftovers.len(), 1, "half-deleted folder stays: {after}");
            assert_eq!(
                last_outcome(&root),
                Some(RestoreOutcome::Applied),
                "applied is written before the deletion"
            );

            let outcome = start(&root).expect("next start");
            assert!(!outcome.swapped);
            assert!(rollback_leftovers(&root).is_empty(), "{after}");
            assert_eq!(last_outcome(&root), Some(RestoreOutcome::Applied));
            let mut expected = restored_snapshot(&original, true, true);
            expected.insert("wal".into(), b"SESSION-WAL".to_vec());
            assert_eq!(
                snapshot(&root),
                expected,
                "restored db and session wal intact"
            );
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Crashes during the swap
// ---------------------------------------------------------------------------------------------

#[test]
fn crash_after_each_swap_step_then_rollback_restores_the_original_byte_for_byte() {
    for step in SWAP_STEPS {
        let (_d, root, original) = fixture(FULL, true, true);
        let hook = |s: SwapStep| -> io::Result<()> {
            if s == step {
                crash();
            }
            Ok(())
        };
        let faults = Faults {
            swap: Some(&hook),
            ..Faults::default()
        };
        assert!(
            crashes(|| startup_sequence_with(&root, &clock(), &faults)),
            "{step:?}"
        );
        rollback(&root, &Faults::default()).expect("rollback");
        assert_eq!(snapshot(&root), original, "{step:?}");
        assert!(rollback_leftovers(&root).is_empty(), "{step:?}");
    }
}

#[test]
fn crash_after_each_swap_step_then_next_startup() {
    for step in SWAP_STEPS {
        let (_d, root, original) = fixture(FULL, true, true);
        let hook = |s: SwapStep| -> io::Result<()> {
            if s == step {
                crash();
            }
            Ok(())
        };
        let faults = Faults {
            swap: Some(&hook),
            ..Faults::default()
        };
        assert!(
            crashes(|| startup_sequence_with(&root, &clock(), &faults)),
            "{step:?}"
        );

        let outcome = start(&root).expect("next start");
        let resumable = matches!(
            step,
            SwapStep::RollbackDirCreated
                | SwapStep::InfoWritten
                | SwapStep::DbMoved
                | SwapStep::CompanionsMoved
                | SwapStep::ImagesMoved
        );
        if resumable {
            // Rolled back, then the still valid restore-pending is applied again.
            assert!(outcome.swapped, "{step:?}");
            assert_eq!(
                snapshot(&root),
                restored_snapshot(&original, true, true),
                "{step:?}"
            );
            // No confirmation: the next start is back to the original.
            assert!(!start(&root).expect("again").swapped);
            assert_eq!(
                last_outcome(&root),
                Some(RestoreOutcome::RolledBack),
                "{step:?}"
            );
        } else {
            assert!(!outcome.swapped, "{step:?}");
            let expected = if step == SwapStep::PendingRemoved {
                RestoreOutcome::RolledBack
            } else {
                // restore-pending lost its database: unusable, the original state is kept.
                RestoreOutcome::Failed
            };
            assert_eq!(last_outcome(&root), Some(expected), "{step:?}");
        }
        assert_eq!(snapshot(&root), original, "{step:?}");
        assert!(rollback_leftovers(&root).is_empty(), "{step:?}");
        assert!(!root.restore_pending().exists(), "{step:?}");
    }
}

#[test]
fn crash_between_steps_3_and_4_keeps_the_original_wal() {
    let (_d, root, original) = fixture(FULL, true, true);
    let hook = |s: SwapStep| -> io::Result<()> {
        if s == SwapStep::DbMoved {
            crash();
        }
        Ok(())
    };
    let faults = Faults {
        swap: Some(&hook),
        ..Faults::default()
    };
    assert!(crashes(|| startup_sequence_with(&root, &clock(), &faults)));
    // The database is in restore-rollback, the companions are still the original ones.
    assert!(!root.db().exists());
    let [wal, shm, journal] = root.db_companions();
    assert_eq!(fs::read(&wal).expect("wal"), original["wal"]);
    assert_eq!(fs::read(&shm).expect("shm"), original["shm"]);
    assert_eq!(fs::read(&journal).expect("journal"), original["journal"]);
    assert_eq!(
        fs::read(root.restore_rollback().join(DB_ENTRY)).expect("saved db"),
        original["db"]
    );

    rollback(&root, &Faults::default()).expect("rollback");
    assert_eq!(snapshot(&root), original);
}

#[test]
fn failing_swap_step_rolls_back_and_records_failed() {
    for step in SWAP_STEPS {
        let (_d, root, original) = fixture(FULL, true, true);
        let hook = |s: SwapStep| -> io::Result<()> {
            if s == step {
                return Err(injected());
            }
            Ok(())
        };
        let faults = Faults {
            swap: Some(&hook),
            ..Faults::default()
        };
        let outcome = startup_sequence_with(&root, &clock(), &faults).expect("not blocked");
        assert!(!outcome.swapped, "{step:?}");
        assert_eq!(snapshot(&root), original, "{step:?}");
        assert_eq!(
            last_outcome(&root),
            Some(RestoreOutcome::Failed),
            "{step:?}"
        );
        assert!(rollback_leftovers(&root).is_empty(), "{step:?}");
        assert!(!root.restore_pending().exists(), "{step:?}");
    }
}

// ---------------------------------------------------------------------------------------------
// Crashes and failures during rollback()
// ---------------------------------------------------------------------------------------------

#[test]
fn crash_during_rollback_then_next_startup_is_idempotent() {
    for point in rollback_points() {
        let (_d, root, original) = fixture(FULL, true, true);
        assert!(start(&root).expect("swap").swapped);
        let hook = |s: RollbackStep| -> io::Result<()> {
            if s == point {
                crash();
            }
            Ok(())
        };
        let faults = Faults {
            rollback: Some(&hook),
            ..Faults::default()
        };
        assert!(
            crashes(|| startup_sequence_with(&root, &clock(), &faults)),
            "{point:?}"
        );

        let outcome = start(&root).expect("relaunch");
        assert!(!outcome.swapped, "{point:?}");
        assert_eq!(snapshot(&root), original, "{point:?}");
        assert!(rollback_leftovers(&root).is_empty(), "{point:?}");
        assert_eq!(
            last_outcome(&root),
            Some(RestoreOutcome::RolledBack),
            "{point:?}"
        );
    }
}

#[test]
fn failure_during_rollback_blocks_then_relaunch_finishes() {
    for point in rollback_points() {
        let (_d, root, original) = fixture(FULL, true, true);
        assert!(start(&root).expect("swap").swapped);
        let hook = |s: RollbackStep| -> io::Result<()> {
            if s == point {
                return Err(injected());
            }
            Ok(())
        };
        let faults = Faults {
            rollback: Some(&hook),
            ..Faults::default()
        };
        let blocked = startup_sequence_with(&root, &clock(), &faults).expect_err("blocked");
        assert_eq!(
            blocked.reason,
            StartupBlockedReason::RollbackFailed,
            "{point:?}"
        );
        report_blocked(&root, &clock(), &blocked);
        assert!(startup_blocked_exists(&root));

        let outcome = start(&root).expect("relaunch");
        assert!(!outcome.swapped, "{point:?}");
        assert_eq!(snapshot(&root), original, "{point:?}");
        assert!(rollback_leftovers(&root).is_empty(), "{point:?}");
        assert!(
            !startup_blocked_exists(&root),
            "marker removed once unblocked"
        );
        assert_eq!(
            last_outcome(&root),
            Some(RestoreOutcome::RolledBack),
            "{point:?}"
        );
    }
}

#[test]
fn failed_swap_then_failed_rollback_is_blocked() {
    let (_d, root, original) = fixture(FULL, true, true);
    let swap_hook = |s: SwapStep| -> io::Result<()> {
        if s == SwapStep::DbInstalled {
            return Err(injected());
        }
        Ok(())
    };
    let rollback_hook = |s: RollbackStep| -> io::Result<()> {
        if s == RollbackStep::Done(Item::Db) {
            return Err(injected());
        }
        Ok(())
    };
    let faults = Faults {
        swap: Some(&swap_hook),
        rollback: Some(&rollback_hook),
        ..Faults::default()
    };
    let blocked = startup_sequence_with(&root, &clock(), &faults).expect_err("blocked");
    assert_eq!(blocked.reason, StartupBlockedReason::RollbackFailed);
    assert!(root.restore_rollback().is_dir(), "nothing else deleted");
    // Relaunch: restore-pending is unusable (database moved), the original comes back.
    assert!(!start(&root).expect("relaunch").swapped);
    assert_eq!(snapshot(&root), original);
}

// ---------------------------------------------------------------------------------------------
// restore-info.json problems
// ---------------------------------------------------------------------------------------------

#[test]
fn missing_info_with_a_non_empty_rollback_folder_is_blocked_and_nothing_is_deleted() {
    for garbage in [None, Some(&b"{not json"[..])] {
        let (_d, root) = new_root();
        seed_original(&root, FULL);
        make_pending(&root, true, true);
        fs::create_dir_all(root.restore_rollback()).expect("dir");
        fs::write(root.restore_rollback().join(DB_ENTRY), b"PRECIOUS-ORIGINAL").expect("saved");
        if let Some(bytes) = garbage {
            fs::write(root.restore_info(), bytes).expect("info");
        }
        let blocked = start(&root).expect_err("blocked");
        assert_eq!(blocked.reason, StartupBlockedReason::RollbackInfoUnreadable);
        report_blocked(&root, &clock(), &blocked);
        assert_eq!(
            fs::read(root.restore_rollback().join(DB_ENTRY)).expect("kept"),
            b"PRECIOUS-ORIGINAL"
        );
        assert!(root.restore_pending().is_dir(), "pending untouched too");
        let marker: serde_json::Value =
            serde_json::from_slice(&fs::read(root.startup_blocked_marker()).expect("marker"))
                .expect("json");
        assert_eq!(marker["reason"], "rollback_info_unreadable");
        assert!(marker["at"].is_string());
        assert_eq!(snapshot(&root)["db"], b"ORIGINAL-DB");
    }
}

#[test]
fn missing_info_with_an_empty_or_tmp_only_rollback_folder_is_fine() {
    for tmp_file in [false, true] {
        let (_d, root) = new_root();
        seed_original(&root, FULL);
        fs::create_dir_all(root.restore_rollback()).expect("dir");
        if tmp_file {
            fs::write(root.restore_rollback().join("restore-info.json.tmp"), b"{").expect("tmp");
        }
        let outcome = start(&root).expect("ok");
        assert!(!outcome.swapped);
        assert!(!root.restore_rollback().exists());
        // No pending: the folder was only a leftover of an interrupted swap start.
        assert_eq!(last_outcome(&root), Some(RestoreOutcome::RolledBack));
        assert_eq!(snapshot(&root)["db"], b"ORIGINAL-DB");
    }
}

#[test]
fn rollback_error_reasons() {
    let (_d, root) = new_root();
    fs::create_dir_all(root.restore_rollback()).expect("dir");
    fs::write(root.restore_rollback().join("x"), b"x").expect("x");
    let err = rollback(&root, &Faults::default()).expect_err("blocked");
    assert!(matches!(err, RollbackError::InfoUnreadable));
    assert_eq!(err.reason(), StartupBlockedReason::RollbackInfoUnreadable);
}

// ---------------------------------------------------------------------------------------------
// Variants of the original / restored state
// ---------------------------------------------------------------------------------------------

#[test]
fn swap_then_unconfirmed_restart_returns_to_the_original_in_every_variant() {
    let flag_sets = [
        FULL,
        NOTHING,
        Flags {
            db: true,
            ..NOTHING
        },
        Flags {
            db: true,
            images: true,
            ..NOTHING
        },
        Flags {
            db: true,
            wal: true,
            ..NOTHING
        },
        Flags {
            db: true,
            journal: true,
            ..NOTHING
        },
        // Companions without a database (a previous interrupted state).
        Flags {
            wal: true,
            shm: true,
            ..NOTHING
        },
    ];
    for (n, flags) in flag_sets.into_iter().enumerate() {
        for (includes_images, pending_images) in [(true, true), (true, false), (false, false)] {
            let label = format!("{n} images={includes_images}/{pending_images}");
            let (_d, root, original) = fixture(flags, includes_images, pending_images);
            let outcome = start(&root).expect("swap");
            assert!(outcome.swapped, "{label}");
            assert_eq!(
                snapshot(&root),
                restored_snapshot(&original, includes_images, pending_images),
                "{label}"
            );
            let info = read_restore_info(&root.restore_info()).expect("info");
            assert_eq!(info.original_had_db, flags.db, "{label}");
            assert_eq!(info.original_had_wal, flags.wal, "{label}");
            assert_eq!(info.original_had_images, flags.images, "{label}");
            assert_eq!(info.includes_images, includes_images, "{label}");

            assert!(!start(&root).expect("restart").swapped, "{label}");
            assert_eq!(snapshot(&root), original, "{label}");
            assert_eq!(
                last_outcome(&root),
                Some(RestoreOutcome::RolledBack),
                "{label}"
            );
            assert!(rollback_leftovers(&root).is_empty(), "{label}");
        }
    }
}

#[test]
fn a_foreign_hot_journal_is_never_replayed_on_the_original() {
    // The original has no journal: the journal left by the restored database is removed.
    let (_d, root, original) = fixture(
        Flags {
            db: true,
            wal: true,
            ..NOTHING
        },
        true,
        false,
    );
    start(&root).expect("swap");
    let journal = root.db_companions()[2].clone();
    fs::write(&journal, b"HOT-JOURNAL-OF-THE-RESTORED-DB").expect("journal");
    fs::write(root.db_companions()[0].clone(), b"SESSION-WAL").expect("wal");
    start(&root).expect("restart");
    assert!(!journal.exists());
    assert_eq!(snapshot(&root), original);
    assert_eq!(last_outcome(&root), Some(RestoreOutcome::RolledBack));

    // The original had a journal: it is replaced by the original one.
    let (_d, root, original) = fixture(FULL, true, false);
    start(&root).expect("swap");
    fs::write(
        root.db_companions()[2].clone(),
        b"HOT-JOURNAL-OF-THE-RESTORED-DB",
    )
    .expect("journal");
    start(&root).expect("restart");
    assert_eq!(snapshot(&root), original);
    assert_eq!(snapshot(&root)["journal"], b"ORIGINAL-JOURNAL");
}

// ---------------------------------------------------------------------------------------------
// restore-pending verification
// ---------------------------------------------------------------------------------------------

const TAMPER_CASES: [&str; 8] = [
    "extra file",
    "extra companion",
    "missing image",
    "extra image",
    "altered database",
    "truncated database",
    "missing manifest",
    "garbage manifest",
];

fn tamper(label: &str, root: &DataRoot) {
    let pending = root.restore_pending();
    let image = |uuid: &str| pending.join("images").join(format!("{uuid}.png"));
    match label {
        "extra file" => fs::write(pending.join("extra.txt"), b"x").expect("extra"),
        "extra companion" => fs::write(pending.join("homebase.db-wal"), b"x").expect("wal"),
        "missing image" => fs::remove_file(image(UUID_NEW)).expect("remove"),
        "extra image" => fs::write(image(UUID_ORIG), PNG_ORIG).expect("image"),
        "altered database" => fs::write(pending.join(DB_ENTRY), b"RESTORED-DATABASX").expect("db"),
        "truncated database" => fs::write(pending.join(DB_ENTRY), b"RESTORED").expect("db"),
        "missing manifest" => fs::remove_file(pending.join(MANIFEST_ENTRY)).expect("manifest"),
        "garbage manifest" => fs::write(pending.join(MANIFEST_ENTRY), b"{").expect("manifest"),
        other => panic!("unknown case {other}"),
    }
}

#[test]
fn tampered_pending_is_discarded_with_failed() {
    for label in TAMPER_CASES {
        let (_d, root, original) = fixture(FULL, true, true);
        tamper(label, &root);
        let outcome = start(&root).expect(label);
        assert!(!outcome.swapped, "{label}");
        assert!(!root.restore_pending().exists(), "{label}");
        assert_eq!(snapshot(&root), original, "{label}");
        assert_eq!(last_outcome(&root), Some(RestoreOutcome::Failed), "{label}");
        assert!(rollback_leftovers(&root).is_empty(), "{label}");
    }
}

#[test]
fn a_file_absent_from_the_manifest_refuses_the_swap() {
    let (_d, root, original) = fixture(FULL, true, true);
    // The manifest no longer lists the image that is on disk.
    let manifest_path = root.restore_pending().join(MANIFEST_ENTRY);
    let mut manifest: Manifest =
        serde_json::from_slice(&fs::read(&manifest_path).expect("read")).expect("json");
    manifest.files.retain(|f| f.path == DB_ENTRY);
    fs::write(&manifest_path, serde_json::to_vec(&manifest).expect("json")).expect("write");
    assert!(verify_pending(&root).is_err());
    assert!(!start(&root).expect("start").swapped);
    assert_eq!(snapshot(&root), original);
    assert_eq!(last_outcome(&root), Some(RestoreOutcome::Failed));
}

#[test]
fn valid_pending_is_accepted() {
    let (_d, root, _original) = fixture(FULL, true, true);
    let manifest = verify_pending(&root).expect("valid");
    assert_eq!(manifest.files.len(), 2);
    let (_d2, root2, _) = fixture(FULL, false, false);
    assert!(verify_pending(&root2).is_ok());
}

// ---------------------------------------------------------------------------------------------
// Startup cleanup and markers
// ---------------------------------------------------------------------------------------------

#[test]
fn startup_cleans_temporary_folders_and_clears_the_blocked_marker() {
    let (_d, root) = new_root();
    seed_original(&root, FULL);
    for dir in [root.backups_tmp(), root.incoming_check()] {
        fs::create_dir_all(&dir).expect("dir");
        fs::write(dir.join("leftover"), b"x").expect("leftover");
    }
    fs::write(root.incoming_picked(), b"zip").expect("picked");
    fs::create_dir_all(root.restore_staging().join("images")).expect("staging");
    write_startup_blocked(&root, clock().now(), StartupBlockedReason::RollbackFailed)
        .expect("marker");
    start(&root).expect("start");
    assert_eq!(fs::read_dir(root.backups_tmp()).expect("tmp").count(), 0);
    assert_eq!(fs::read_dir(root.incoming()).expect("incoming").count(), 0);
    assert!(!root.restore_staging().exists());
    assert!(!startup_blocked_exists(&root));
    assert_eq!(snapshot(&root)["db"], b"ORIGINAL-DB");
}

#[test]
fn a_blocked_startup_keeps_its_marker() {
    let (_d, root) = new_root();
    fs::create_dir_all(root.restore_rollback()).expect("dir");
    fs::write(root.restore_rollback().join("x"), b"x").expect("x");
    let blocked = start(&root).expect_err("blocked");
    report_blocked(&root, &clock(), &blocked);
    start(&root).expect_err("still blocked");
    assert!(startup_blocked_exists(&root));
}

// ---------------------------------------------------------------------------------------------
// Staging (real archives)
// ---------------------------------------------------------------------------------------------

fn real_root() -> (TempDir, DataRoot, Arc<FixedClock>) {
    let (dir, root) = new_root();
    make_database(&root.db(), 3, true);
    (dir, root, Arc::new(clock()))
}

fn stage(
    root: &DataRoot,
    clock: &Arc<FixedClock>,
    archive: &str,
    protect: &[&str],
) -> Result<(), BackupError> {
    let clock: Arc<dyn Clock> = clock.clone();
    run(stage_restore(
        root.clone(),
        clock,
        root.backups().join(archive),
        protect.iter().map(|p| (*p).to_owned()).collect(),
    ))
}

#[test]
fn staging_publishes_a_verified_pending_folder_and_a_pre_restore_backup() {
    let (_d, root, clock) = real_root();
    fs::create_dir_all(root.images()).expect("images");
    fs::write(root.images().join(format!("{UUID_ORIG}.png")), PNG_ORIG).expect("image");
    let source = run(create_backup(
        &root,
        clock.as_ref(),
        BackupKind::Manual,
        &[],
    ))
    .expect("src");
    clock.advance(jiff::SignedDuration::from_secs(60));
    let before = list_backups(&root).len();

    stage(&root, &clock, &source.id, &[&source.id]).expect("stage");

    let mut names: Vec<String> = fs::read_dir(root.restore_pending())
        .expect("pending")
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    assert_eq!(names, ["homebase.db", "images", "manifest.json"]);
    assert!(!root.restore_staging().exists());
    let manifest = verify_pending(&root).expect("verified");
    assert_eq!(manifest.created_at, source.created_at);
    assert_eq!(manifest.image_count(), 1);
    let backups = list_backups(&root);
    assert_eq!(backups.len(), before + 1);
    assert!(backups.iter().any(|b| b.kind == BackupKind::PreRestore
        && !b.damaged
        && b.includes_images == Some(true)));
    // The live database is untouched until the next startup.
    assert_eq!(run(read_schema_version(&root.db())).expect("v"), Some(3));
}

#[test]
fn staging_then_startup_installs_the_archive_database() {
    let (_d, root, clock) = real_root();
    let source = run(create_backup(
        &root,
        clock.as_ref(),
        BackupKind::Manual,
        &[],
    ))
    .expect("src");
    clock.advance(jiff::SignedDuration::from_secs(60));
    stage(&root, &clock, &source.id, &[&source.id]).expect("stage");

    let outcome = startup_sequence(&root, clock.as_ref()).expect("start");
    assert!(outcome.swapped);
    assert_eq!(run(read_schema_version(&root.db())).expect("v"), Some(3));
    confirm_restore(&root, clock.as_ref(), Some(&disk_info(&root))).expect("confirm");
    assert_eq!(last_outcome(&root), Some(RestoreOutcome::Applied));
    assert!(rollback_leftovers(&root).is_empty());
}

#[test]
fn staging_replaces_an_older_pending_folder() {
    let (_d, root, clock) = real_root();
    let source = run(create_backup(
        &root,
        clock.as_ref(),
        BackupKind::Manual,
        &[],
    ))
    .expect("src");
    clock.advance(jiff::SignedDuration::from_secs(60));
    fs::create_dir_all(root.restore_pending()).expect("old");
    fs::write(root.restore_pending().join("old.txt"), b"old").expect("old");
    stage(&root, &clock, &source.id, &[&source.id]).expect("stage");
    assert!(!root.restore_pending().join("old.txt").exists());
    verify_pending(&root).expect("verified");
}

#[test]
fn staging_an_invalid_archive_leaves_no_pending_and_no_pre_restore() {
    let (_d, root, clock) = real_root();
    fs::create_dir_all(root.backups()).expect("backups");
    fs::write(
        root.backups()
            .join("homebase-20261020T080000.000Z-manual.zip"),
        b"this is not a zip",
    )
    .expect("fake");
    let before: Vec<_> = fs::read_dir(root.backups())
        .expect("dir")
        .flatten()
        .map(|e| e.file_name())
        .collect();
    let err = stage(
        &root,
        &clock,
        "homebase-20261020T080000.000Z-manual.zip",
        &[],
    )
    .expect_err("invalid");
    assert_eq!(
        err,
        BackupError::InvalidArchive {
            problem: ArchiveProblem::NotZip
        }
    );
    assert!(!root.restore_pending().exists());
    assert!(!root.restore_staging().exists());
    let after: Vec<_> = fs::read_dir(root.backups())
        .expect("dir")
        .flatten()
        .map(|e| e.file_name())
        .collect();
    assert_eq!(before, after, "no pre-restore archive");
}

#[test]
fn staging_without_a_live_database_skips_the_pre_restore_backup() {
    let (_d, root, clock) = real_root();
    let source = run(create_backup(
        &root,
        clock.as_ref(),
        BackupKind::Manual,
        &[],
    ))
    .expect("src");
    clock.advance(jiff::SignedDuration::from_secs(60));
    fs::remove_file(root.db()).expect("db gone (R6)");
    stage(&root, &clock, &source.id, &[&source.id]).expect("stage");
    verify_pending(&root).expect("verified");
    assert!(list_backups(&root)
        .iter()
        .all(|b| b.kind != BackupKind::PreRestore));
    // Original had no database.
    assert!(
        startup_sequence(&root, clock.as_ref())
            .expect("start")
            .swapped
    );
    assert!(read_restore_info(&root.restore_info())
        .map(|i| !i.original_had_db)
        .unwrap_or(false));
    assert!(root.db().is_file());
}

#[test]
fn the_source_archive_is_protected_from_retention() {
    for protect in [true, false] {
        let (_d, root, clock) = real_root();
        let mut ids = Vec::new();
        for _ in 0..5 {
            clock.advance(jiff::SignedDuration::from_secs(60));
            ids.push(
                run(create_backup(
                    &root,
                    clock.as_ref(),
                    BackupKind::PreImport,
                    &[],
                ))
                .expect("pre-import")
                .id,
            );
        }
        clock.advance(jiff::SignedDuration::from_secs(60));
        let protected: Vec<&str> = if protect {
            vec![ids[0].as_str()]
        } else {
            vec![]
        };
        stage(&root, &clock, &ids[0], &protected).expect("stage");
        // The safety reserve now holds 6 archives for 5 slots: the oldest one is the source.
        assert_eq!(
            root.backups().join(&ids[0]).exists(),
            protect,
            "protect={protect}"
        );
        assert!(root.backups().join(&ids[4]).exists());
    }
}

#[test]
fn restart_pending_refuses_any_further_backup_operation() {
    let state = BackupState::new(
        DataRoot::new(std::path::PathBuf::from("unused")),
        Arc::new(clock()),
        None,
    );
    drop(state.try_acquire().expect("free"));
    // What backup_restore does once the restoration is staged.
    state.mark_restart_pending();
    assert_eq!(state.try_acquire().err(), Some(BackupError::RestartPending));
    assert_eq!(state.try_acquire().err(), Some(BackupError::RestartPending));
}

#[test]
fn swap_can_be_called_directly_on_a_verified_pending() {
    let (_d, root, original) = fixture(FULL, true, true);
    let manifest = verify_pending(&root).expect("valid");
    swap(&root, &clock(), &manifest, &Faults::default()).expect("swap");
    assert_eq!(snapshot(&root), restored_snapshot(&original, true, true));
}

// ---------------------------------------------------------------------------------------------
// Locked files (Windows sharing violations: the 2 s retry window is really elapsed)
// ---------------------------------------------------------------------------------------------

#[cfg(windows)]
mod windows_locks {
    use super::*;
    use std::os::windows::fs::OpenOptionsExt;
    use std::path::Path;

    fn lock(path: &Path) -> fs::File {
        fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(path)
            .expect("open without sharing")
    }

    #[test]
    fn locked_file_during_the_mark_fails_confirmation_then_next_start_rolls_back() {
        let (_d, root, original) = fixture(FULL, true, true);
        assert!(start(&root).expect("swap").swapped);
        let handle = lock(&root.restore_rollback().join(DB_ENTRY));

        let err =
            confirm_restore(&root, &clock(), Some(&disk_info(&root))).expect_err("mark must fail");
        assert!(matches!(err, ConfirmError::MarkFailed(_)));
        let marker: serde_json::Value =
            serde_json::from_slice(&fs::read(root.startup_blocked_marker()).expect("marker"))
                .expect("json");
        assert_eq!(marker["reason"], "confirm_mark_failed");
        assert!(root.restore_rollback().is_dir(), "nothing was deleted");
        assert!(root.restore_info().is_file());
        drop(handle);

        let outcome = start(&root).expect("next start");
        assert!(!outcome.swapped);
        assert_eq!(snapshot(&root), original);
        assert_eq!(last_outcome(&root), Some(RestoreOutcome::RolledBack));
        assert!(!startup_blocked_exists(&root));
        assert!(rollback_leftovers(&root).is_empty());
    }

    #[test]
    fn locked_file_during_the_deletion_keeps_the_folder_then_next_start_deletes_it() {
        let (_d, root, original) = fixture(FULL, true, true);
        start(&root).expect("swap");
        fs::write(root.db_companions()[0].clone(), b"SESSION-WAL").expect("session wal");
        let held = Mutex::new(None);
        let hook = |step: ConfirmStep| -> io::Result<()> {
            if step == ConfirmStep::AfterMark {
                let confirmed = rollback_leftovers(&root);
                let dir = root.path().join(&confirmed[0]);
                *held.lock().expect("lock") = Some(lock(&dir.join(DB_ENTRY)));
            }
            Ok(())
        };
        let faults = Faults {
            confirm: Some(&hook),
            ..Faults::default()
        };
        confirm_restore_with(&root, &clock(), Some(&disk_info(&root)), &faults)
            .expect("Ok despite the lock");
        assert_eq!(rollback_leftovers(&root).len(), 1, "the folder remains");
        assert_eq!(last_outcome(&root), Some(RestoreOutcome::Applied));
        drop(held.lock().expect("lock").take());

        assert!(!start(&root).expect("next start").swapped);
        assert!(rollback_leftovers(&root).is_empty());
        let mut expected = restored_snapshot(&original, true, true);
        expected.insert("wal".into(), b"SESSION-WAL".to_vec());
        assert_eq!(snapshot(&root), expected, "no original was put back");
        assert_eq!(last_outcome(&root), Some(RestoreOutcome::Applied));
    }

    #[test]
    fn impossible_rollback_is_blocked_and_deletes_no_original() {
        let (_d, root, original) = fixture(FULL, true, true);
        assert!(start(&root).expect("swap").swapped);
        let saved_db = root.restore_rollback().join(DB_ENTRY);
        let handle = lock(&saved_db);

        let blocked = start(&root).expect_err("rollback impossible");
        assert_eq!(blocked.reason, StartupBlockedReason::RollbackFailed);
        report_blocked(&root, &clock(), &blocked);
        assert!(startup_blocked_exists(&root));
        drop(handle);
        // Every original is still in restore-rollback.
        assert_eq!(fs::read(&saved_db).expect("db"), original["db"]);
        for (name, key) in [
            ("homebase.db-wal", "wal"),
            ("homebase.db-shm", "shm"),
            ("homebase.db-journal", "journal"),
        ] {
            assert_eq!(
                fs::read(root.restore_rollback().join(name)).expect(name),
                original[key]
            );
        }
        assert!(root
            .restore_rollback()
            .join("images")
            .join(format!("{UUID_ORIG}.png"))
            .is_file());

        // Lock released: the next launch completes the rollback.
        assert!(!start(&root).expect("relaunch").swapped);
        assert_eq!(snapshot(&root), original);
        assert!(!startup_blocked_exists(&root));
    }

    #[test]
    fn locked_database_at_step_3_gives_failed() {
        let (_d, root, original) = fixture(FULL, true, true);
        let handle = lock(&root.db());
        let outcome = start(&root).expect("not blocked");
        assert!(!outcome.swapped);
        drop(handle);
        assert_eq!(snapshot(&root), original);
        assert_eq!(last_outcome(&root), Some(RestoreOutcome::Failed));
        assert!(!root.restore_pending().exists());
        assert!(rollback_leftovers(&root).is_empty());
    }
}

// ---------------------------------------------------------------------------------------------
// Hardening after the security review
// ---------------------------------------------------------------------------------------------

/// Two instances starting together: the second one runs `rollback()` in the middle of the first
/// one's exchange. With the process lock this cannot happen (see `lock::tests`); should it happen
/// anyway, step 6 refuses to replace the original database and nothing is lost.
#[test]
fn a_concurrent_rollback_never_loses_the_original_database() {
    let (_d, root, original) = fixture(FULL, true, true);
    let p2_pause = |s: RollbackStep| -> io::Result<()> {
        if s == RollbackStep::Done(Item::Db) {
            crash();
        }
        Ok(())
    };
    let p1_hook = |s: SwapStep| -> io::Result<()> {
        if s == SwapStep::DbMoved {
            let faults = Faults {
                rollback: Some(&p2_pause),
                ..Faults::default()
            };
            assert!(crashes(|| rollback(&root, &faults)));
        }
        Ok(())
    };
    let faults = Faults {
        swap: Some(&p1_hook),
        ..Faults::default()
    };
    let outcome = startup_sequence_with(&root, &clock(), &faults).expect("P1 not blocked");
    assert!(
        !outcome.swapped,
        "step 6 must refuse to replace the database"
    );
    assert_eq!(snapshot(&root), original);
    // P2 resumes its rollback.
    rollback(&root, &Faults::default()).expect("P2 rollback");
    assert_eq!(snapshot(&root), original);
    assert!(!root.restore_pending().exists());
    assert!(rollback_leftovers(&root).is_empty());
}

#[test]
fn a_failing_pre_restore_backup_cancels_the_preparation() {
    let (_d, root, clock) = real_root();
    let source = run(create_backup(
        &root,
        clock.as_ref(),
        BackupKind::Manual,
        &[],
    ))
    .expect("src");
    // Same instant: the pre-restore archive name is already taken.
    let taken = BackupName::new(clock.now(), BackupKind::PreRestore).file_name();
    fs::write(root.backups().join(&taken), b"occupied").expect("occupied");

    stage(&root, &clock, &source.id, &[&source.id]).expect_err("pre-restore must fail");

    assert!(!root.restore_pending().exists());
    assert!(!root.restore_staging().exists());
    assert_eq!(
        fs::read(root.backups().join(&taken)).expect("untouched"),
        b"occupied"
    );
}

#[test]
fn unexpected_content_in_the_rollback_folder_is_set_aside_not_blocking() {
    let (_d, root, original) = fixture(FULL, true, true);
    assert!(start(&root).expect("swap").swapped);
    fs::write(root.restore_rollback().join("desktop.ini"), b"[x]").expect("ini");

    // Restart without confirmation: rollback, then the leftover is set aside.
    let outcome = start(&root).expect("not blocked");
    assert!(!outcome.swapped);
    assert_eq!(snapshot(&root), original);
    assert!(!root.restore_rollback().exists());
    let leftovers = rollback_leftovers(&root);
    assert_eq!(leftovers.len(), 1, "{leftovers:?}");
    assert!(leftovers[0].starts_with("restore-rollback.leftover-"));
    let kept = root.path().join(&leftovers[0]);
    assert_eq!(fs::read(kept.join("desktop.ini")).expect("ini"), b"[x]");
    assert_eq!(last_outcome(&root), Some(RestoreOutcome::RolledBack));

    // Never deleted nor restored afterwards.
    assert!(!start(&root).expect("again").swapped);
    assert_eq!(rollback_leftovers(&root), leftovers);
    assert_eq!(snapshot(&root), original);
}

#[test]
fn confirmation_uses_the_info_kept_in_memory() {
    let (_d, root, _original) = fixture(FULL, true, true);
    let outcome = start(&root).expect("swap");
    let info = outcome.swap_info.expect("info of the swap");
    assert_eq!(info, disk_info(&root));
    // The file becoming unreadable after the exchange does not matter any more.
    fs::write(root.restore_info(), b"{garbage").expect("garble");

    confirm_restore(&root, &clock(), Some(&info)).expect("confirm");

    assert!(rollback_leftovers(&root).is_empty());
    let report = read_last_restore(&root).expect("report");
    assert_eq!(report.outcome, RestoreOutcome::Applied);
    assert_eq!(report.at, info.started_at);
    assert!(!startup_blocked_exists(&root));
}

#[test]
fn startup_without_a_swap_has_no_info_to_confirm() {
    let (_d, root) = new_root();
    seed_original(&root, FULL);
    assert_eq!(start(&root).expect("start").swap_info, None);
}

/// The info is readable as soon as `restore-rollback\` holds anything else, at every point of the
/// exchange, and a hook exists right before each rename (so that a reordering is caught).
#[test]
fn the_info_is_readable_before_anything_is_moved() {
    let (_d, root, _original) = fixture(FULL, true, true);
    let seen = Mutex::new(Vec::new());
    let hook = |step: SwapStep| -> io::Result<()> {
        seen.lock().expect("seen").push(step);
        let dir = root.restore_rollback();
        let holds_other = fs::read_dir(&dir).is_ok_and(|entries| {
            entries.flatten().any(|e| {
                let n = e.file_name();
                n != "restore-info.json" && n != "restore-info.json.tmp"
            })
        });
        let before_move = matches!(
            step,
            SwapStep::BeforeDbMove
                | SwapStep::BeforeCompanionMove
                | SwapStep::BeforeImagesMove
                | SwapStep::BeforeDbInstall
                | SwapStep::BeforeImagesInstall
        );
        if holds_other || before_move {
            assert!(
                read_restore_info(&root.restore_info()).is_some(),
                "info unreadable at {step:?}"
            );
        }
        Ok(())
    };
    let faults = Faults {
        swap: Some(&hook),
        ..Faults::default()
    };
    assert!(
        startup_sequence_with(&root, &clock(), &faults)
            .expect("start")
            .swapped
    );
    let seen = seen.into_inner().expect("seen");
    for step in [
        SwapStep::BeforeDbMove,
        SwapStep::BeforeCompanionMove,
        SwapStep::BeforeImagesMove,
        SwapStep::BeforeDbInstall,
        SwapStep::BeforeImagesInstall,
    ] {
        assert!(seen.contains(&step), "{step:?}");
    }
    // Each "before" point comes right before the matching "after" point.
    let pos = |s| seen.iter().position(|x| *x == s).expect("step");
    assert!(pos(SwapStep::InfoWritten) < pos(SwapStep::BeforeDbMove));
    assert!(pos(SwapStep::BeforeDbMove) < pos(SwapStep::DbMoved));
    assert!(pos(SwapStep::BeforeImagesMove) < pos(SwapStep::ImagesMoved));
    assert!(pos(SwapStep::BeforeDbInstall) < pos(SwapStep::DbInstalled));
    assert!(pos(SwapStep::BeforeImagesInstall) < pos(SwapStep::ImagesInstalled));
}

fn confirmed_with_info(root: &DataRoot, started_at: &str) {
    let info = RestoreInfo {
        backup_created_at: "2026-10-20T08:00:00.000Z".into(),
        backup_kind: BackupKind::Manual,
        includes_images: true,
        original_had_db: true,
        original_had_wal: false,
        original_had_shm: false,
        original_had_journal: false,
        original_had_images: false,
        started_at: started_at.into(),
    };
    let dir = root.restore_rollback_confirmed("20261021T081500.123Z");
    fs::create_dir_all(&dir).expect("confirmed");
    fs::write(
        dir.join("restore-info.json"),
        serde_json::to_vec(&info).expect("json"),
    )
    .expect("info");
}

#[test]
fn an_old_confirmed_folder_never_overwrites_a_more_recent_report() {
    let swap_started = "2026-10-21T08:15:00.123Z";
    let later = parse_instant("2026-10-21T09:15:00.000Z").expect("later");
    let earlier = parse_instant("2026-10-21T07:15:00.000Z").expect("earlier");
    for (existing, expect_applied) in [
        (Some((later, RestoreOutcome::RolledBack)), false),
        (Some((later, RestoreOutcome::Failed)), false),
        (Some((earlier, RestoreOutcome::Failed)), true),
        (None, true),
    ] {
        let (_d, root) = new_root();
        seed_original(&root, FULL);
        write_db_missing(&root, clock().now()).expect("db-missing");
        if let Some((at, kind)) = existing {
            write_report(&root, kind, at, None, None);
        }
        confirmed_with_info(&root, swap_started);
        start(&root).expect("start");
        let report = read_last_restore(&root).expect("report");
        let applied = report.outcome == RestoreOutcome::Applied;
        assert_eq!(applied, expect_applied, "{existing:?}");
        if expect_applied {
            assert_eq!(report.at, swap_started);
            assert!(!root.db_missing_marker().exists());
        } else {
            assert_eq!(report.at, format_instant(existing.expect("existing").0));
            assert!(root.db_missing_marker().exists(), "{existing:?}");
        }
        assert!(
            rollback_leftovers(&root).is_empty(),
            "folder deleted anyway"
        );
    }
}

#[test]
fn a_pending_folder_that_cannot_be_removed_is_set_aside_and_never_applied_later() {
    let (_d, root, original) = fixture(FULL, true, true);
    let fail_swap = |s: SwapStep| -> io::Result<()> {
        if s == SwapStep::DbMoved {
            return Err(injected());
        }
        Ok(())
    };
    let fail_remove = |_: StartupStep| -> io::Result<()> { Err(injected()) };
    let faults = Faults {
        swap: Some(&fail_swap),
        startup: Some(&fail_remove),
        ..Faults::default()
    };
    let outcome = startup_sequence_with(&root, &clock(), &faults).expect("not blocked");
    assert!(!outcome.swapped);
    assert_eq!(snapshot(&root), original);
    assert!(!root.restore_pending().exists());
    assert_eq!(last_outcome(&root), Some(RestoreOutcome::Failed));
    let discarded: Vec<_> = fs::read_dir(root.path())
        .expect("root")
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.starts_with("restore-pending.discarded-"))
        .collect();
    assert_eq!(discarded.len(), 1, "{discarded:?}");
    assert!(root.path().join(&discarded[0]).join(DB_ENTRY).is_file());

    // The next startup does not apply it.
    assert!(!start(&root).expect("next").swapped);
    assert_eq!(snapshot(&root), original);
}
