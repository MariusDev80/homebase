//! Tests of lot B3: R6, `pre-migration`, markers, external restoration source, raw safety copy
//! of a corrupted live database. No dialog, no real `%APPDATA%`.

use super::create::create_backup;
use super::error::BackupError;
use super::list::list_backups;
use super::names::{BackupKind, BackupName};
use super::paths::DataRoot;
use super::restore::{
    is_corruption, raw_copy_dir, raw_copy_live_database, stage_restore, stage_restore_external,
    swap, verify_pending, Faults,
};
use super::sqlite::read_schema_version;
use super::startup::{detect_missing_db, pre_migration_needed, startup_sequence};
use super::status::{
    acknowledge, db_missing_alert, pre_migration_failed, read_last_restore, read_status,
    write_db_missing, RestoreOutcome,
};
use super::test_support::{make_database, run};
use crate::time::clock::FixedClock;
use crate::time::formats::parse_instant;
use jiff::SignedDuration;
use std::fs;
use std::sync::Arc;
use tempfile::TempDir;

fn clock() -> FixedClock {
    FixedClock::new(parse_instant("2026-10-21T08:15:00.123Z").expect("instant"))
}

fn new_root() -> (TempDir, DataRoot) {
    let dir = TempDir::new().expect("tmp");
    let root = DataRoot::new(dir.path().join("root"));
    fs::create_dir_all(root.path()).expect("root");
    (dir, root)
}

fn kinds(root: &DataRoot) -> Vec<BackupKind> {
    list_backups(root).iter().map(|b| b.kind).collect()
}

fn count(root: &DataRoot, kind: BackupKind) -> usize {
    kinds(root).into_iter().filter(|k| *k == kind).count()
}

/// A real archive (schema `version`) made from another root.
fn archive_with_version(dir: &TempDir, version: i64) -> std::path::PathBuf {
    let source = DataRoot::new(dir.path().join(format!("source-{version}")));
    fs::create_dir_all(source.path()).expect("source");
    make_database(&source.db(), version, true);
    let info = run(create_backup(&source, &clock(), BackupKind::Manual, &[])).expect("archive");
    source.backups().join(info.id)
}

fn touch_archive(root: &DataRoot, kind: BackupKind) -> String {
    let name = BackupName::new(clock().now_for_tests(), kind).file_name();
    fs::create_dir_all(root.backups()).expect("backups");
    fs::write(root.backups().join(&name), b"x").expect("archive");
    name
}

trait NowForTests {
    fn now_for_tests(&self) -> jiff::Timestamp;
}

impl NowForTests for FixedClock {
    fn now_for_tests(&self) -> jiff::Timestamp {
        use crate::time::clock::Clock;
        self.now()
    }
}

// ---------------------------------------------------------------------------------------------
// Pure decisions
// ---------------------------------------------------------------------------------------------

#[test]
fn pre_migration_needed_table() {
    assert!(pre_migration_needed(Some(2), 3));
    assert!(pre_migration_needed(Some(1), 3));
    assert!(!pre_migration_needed(Some(3), 3));
    assert!(!pre_migration_needed(Some(4), 3));
    assert!(!pre_migration_needed(None, 3));
    assert!(!pre_migration_needed(Some(0), 3));
}

#[test]
fn detect_missing_db_cases() {
    let (_d, root) = new_root();
    assert!(!detect_missing_db(&root), "no database, no backup");
    fs::create_dir_all(root.backups()).expect("backups");
    fs::write(root.backups().join("notes.txt"), b"x").expect("foreign");
    fs::create_dir(root.backups().join(".tmp")).expect("tmp");
    fs::create_dir(
        root.backups()
            .join("homebase-20261021T090000.000Z-manual.zip"),
    )
    .expect("directory named like an archive");
    assert!(!detect_missing_db(&root), "no valid archive");
    touch_archive(&root, BackupKind::Manual);
    assert!(detect_missing_db(&root), "no database, one archive");
    fs::write(root.db(), b"db").expect("db");
    assert!(!detect_missing_db(&root), "database present");
}

// ---------------------------------------------------------------------------------------------
// startup_sequence, steps 6 and 7
// ---------------------------------------------------------------------------------------------

#[test]
fn old_database_gets_a_database_only_pre_migration() {
    let (_d, root) = new_root();
    make_database(&root.db(), 2, true);
    fs::create_dir_all(root.images()).expect("images");
    let png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2];
    fs::write(
        root.images()
            .join("3f0c2a5e-8f0b-4c55-9a43-0d2a1d6c9b11.png"),
        png,
    )
    .expect("image");
    let outcome = startup_sequence(&root, &clock()).expect("startup");
    assert!(!outcome.swapped);
    let backups = list_backups(&root);
    assert_eq!(backups.len(), 1);
    assert_eq!(backups[0].kind, BackupKind::PreMigration);
    assert_eq!(backups[0].includes_images, Some(false));
    assert_eq!(backups[0].image_count, Some(0));
    assert_eq!(backups[0].schema_version, Some(2));
    assert!(!pre_migration_failed(&root));
    assert!(!db_missing_alert(&root));
}

#[test]
fn up_to_date_or_absent_or_foreign_database_gets_nothing() {
    let (_d, root) = new_root();
    // Absent: nothing at all, not even a marker or a backups folder.
    startup_sequence(&root, &clock()).expect("startup");
    assert!(!root.backups().join("homebase-x").exists());
    assert!(list_backups(&root).is_empty());
    assert!(!pre_migration_failed(&root) && !db_missing_alert(&root));
    // Current version.
    make_database(&root.db(), 3, true);
    startup_sequence(&root, &clock()).expect("startup");
    assert!(list_backups(&root).is_empty());
    // Not a SQLite file: left alone.
    fs::write(root.db(), b"definitely not sqlite, just some text").expect("junk");
    startup_sequence(&root, &clock()).expect("startup");
    assert!(list_backups(&root).is_empty());
    assert!(!pre_migration_failed(&root));
}

#[test]
fn missing_database_with_backups_raises_r6_without_pre_migration() {
    let (_d, root) = new_root();
    touch_archive(&root, BackupKind::Manual);
    startup_sequence(&root, &clock()).expect("startup");
    assert!(db_missing_alert(&root));
    assert!(read_status(&root, None).db_missing_alert);
    assert!(!pre_migration_failed(&root));
    assert_eq!(count(&root, BackupKind::PreMigration), 0);
    assert!(!root.db().exists(), "no database is created");

    // The original marker is kept by the next startups; only an acknowledgement removes it.
    let marker = fs::read(root.db_missing_marker()).expect("marker");
    let later = clock();
    later.advance(SignedDuration::from_secs(60));
    startup_sequence(&root, &later).expect("startup");
    assert_eq!(fs::read(root.db_missing_marker()).expect("marker"), marker);
    acknowledge(&root).expect("ack");
    assert!(!db_missing_alert(&root));
    // Still absent: detected again.
    startup_sequence(&root, &later).expect("startup");
    assert!(db_missing_alert(&root));
}

#[test]
fn retention_is_suspended_while_r6_is_active() {
    let (_d, root) = new_root();
    make_database(&root.db(), 3, false);
    let c = clock();
    for _ in 0..3 {
        c.advance(SignedDuration::from_secs(60));
        run(create_backup(&root, &c, BackupKind::Manual, &[])).expect("backup");
    }
    write_db_missing(&root, c.now_for_tests()).expect("marker");
    let before = list_backups(&root).len();
    for _ in 0..12 {
        c.advance(SignedDuration::from_secs(60));
        run(create_backup(&root, &c, BackupKind::Manual, &[])).expect("backup");
    }
    assert_eq!(list_backups(&root).len(), before + 12);
}

#[test]
fn pending_restoration_of_an_older_database_is_swapped_then_pre_migrated() {
    let dir = TempDir::new().expect("tmp");
    let archive = archive_with_version(&dir, 2);
    let root = DataRoot::new(dir.path().join("root"));
    fs::create_dir_all(root.path()).expect("root");
    make_database(&root.db(), 3, true);
    let c = Arc::new(clock());
    run(stage_restore(root.clone(), c.clone(), archive, Vec::new())).expect("stage");
    c.advance(SignedDuration::from_secs(60));

    let outcome = startup_sequence(&root, c.as_ref()).expect("startup");
    assert!(outcome.swapped);
    assert_eq!(run(read_schema_version(&root.db())).expect("v"), Some(2));
    let found = list_backups(&root);
    let pre_migration: Vec<_> = found
        .iter()
        .filter(|b| b.kind == BackupKind::PreMigration)
        .collect();
    assert_eq!(pre_migration.len(), 1);
    assert_eq!(pre_migration[0].schema_version, Some(2));
    assert_eq!(count(&root, BackupKind::PreRestore), 1);
}

#[test]
fn five_startups_on_an_old_database_keep_three_pre_migrations_and_every_pre_restore() {
    let (_d, root) = new_root();
    make_database(&root.db(), 2, true);
    let c = clock();
    for _ in 0..4 {
        c.advance(SignedDuration::from_secs(60));
        run(create_backup(&root, &c, BackupKind::PreRestore, &[])).expect("pre-restore");
    }
    for _ in 0..5 {
        c.advance(SignedDuration::from_secs(60));
        startup_sequence(&root, &c).expect("startup");
    }
    assert_eq!(count(&root, BackupKind::PreMigration), 3);
    assert_eq!(count(&root, BackupKind::PreRestore), 4);
}

#[test]
fn failed_pre_migration_sets_the_marker_and_the_next_success_clears_it() {
    let (_d, root) = new_root();
    make_database(&root.db(), 2, true);
    let c = clock();
    // The same name already exists: creation fails with AlreadyExists, startup goes on.
    let taken = touch_archive(&root, BackupKind::PreMigration);
    let outcome = startup_sequence(&root, &c).expect("startup goes on");
    assert!(!outcome.swapped);
    assert!(pre_migration_failed(&root));
    assert_eq!(fs::read(root.backups().join(&taken)).expect("kept"), b"x");

    c.advance(SignedDuration::from_secs(60));
    startup_sequence(&root, &c).expect("startup");
    assert!(!pre_migration_failed(&root));
    assert_eq!(count(&root, BackupKind::PreMigration), 2);
}

#[test]
fn marker_lifecycle_acknowledge_removes_the_three_markers() {
    let (_d, root) = new_root();
    // db-missing (R6) and pre-migration-failed raised by startups, last-restore by a rollback.
    touch_archive(&root, BackupKind::Manual);
    startup_sequence(&root, &clock()).expect("startup");
    assert!(db_missing_alert(&root));
    super::status::write_pre_migration_failed(&root, clock().now_for_tests()).expect("marker");
    super::restore::write_report(
        &root,
        RestoreOutcome::Failed,
        clock().now_for_tests(),
        None,
        None,
    );
    let status = read_status(&root, None);
    assert!(status.db_missing_alert && status.pre_migration_failed);
    assert!(status.last_restore.is_some());
    acknowledge(&root).expect("ack");
    let status = read_status(&root, None);
    assert!(!status.db_missing_alert && !status.pre_migration_failed);
    assert_eq!(read_last_restore(&root), None);
}

// ---------------------------------------------------------------------------------------------
// External source
// ---------------------------------------------------------------------------------------------

#[test]
fn external_restore_without_picked_zip_is_not_found() {
    let (_d, root) = new_root();
    make_database(&root.db(), 3, true);
    let err = run(stage_restore_external(root.clone(), Arc::new(clock()))).expect_err("none");
    assert_eq!(err, BackupError::NotFound);
    assert!(!root.restore_pending().exists());
    assert_eq!(count(&root, BackupKind::PreRestore), 0);
}

#[test]
fn external_restore_stages_the_picked_archive_and_removes_it() {
    let dir = TempDir::new().expect("tmp");
    let archive = archive_with_version(&dir, 2);
    let root = DataRoot::new(dir.path().join("root"));
    fs::create_dir_all(root.incoming()).expect("incoming");
    make_database(&root.db(), 3, true);
    fs::copy(&archive, root.incoming_picked()).expect("picked");
    run(stage_restore_external(root.clone(), Arc::new(clock()))).expect("stage");
    assert!(!root.incoming_picked().exists());
    assert!(root.restore_pending().is_dir());
    assert!(!root.restore_staging().exists());
    assert_eq!(count(&root, BackupKind::PreRestore), 1);
    assert!(verify_pending(&root).is_ok());
}

// ---------------------------------------------------------------------------------------------
// Corrupted live database: raw safety copy
// ---------------------------------------------------------------------------------------------

const CORRUPT_DB: &[u8] = &[0x55; 8192];

fn corrupt_live_database(root: &DataRoot) {
    fs::write(root.db(), CORRUPT_DB).expect("db");
    let [wal, shm, _journal] = root.db_companions();
    fs::write(wal, b"WAL-BYTES").expect("wal");
    fs::write(shm, b"SHM-BYTES").expect("shm");
}

fn raw_dirs(root: &DataRoot) -> Vec<std::path::PathBuf> {
    fs::read_dir(root.backups())
        .map(|entries| {
            entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.to_string_lossy().ends_with("-pre-restore-raw"))
                .collect()
        })
        .unwrap_or_default()
}

#[test]
fn corruption_codes_are_the_primary_codes_11_and_26() {
    let db = |code: &str| BackupError::Database { code: code.into() };
    for code in ["11", "26", "523", "779", "267"] {
        assert!(is_corruption(&db(code)), "{code}");
    }
    for code in ["1", "5", "13", "14", "10", "other", ""] {
        assert!(!is_corruption(&db(code)), "{code}");
    }
    assert!(!is_corruption(&BackupError::DiskFull));
    assert!(!is_corruption(&BackupError::Io { code: "11".into() }));
    assert!(!is_corruption(&BackupError::Busy));
}

#[test]
fn corrupted_live_database_is_copied_raw_and_the_restoration_goes_on() {
    let dir = TempDir::new().expect("tmp");
    let archive = archive_with_version(&dir, 2);
    let root = DataRoot::new(dir.path().join("root"));
    fs::create_dir_all(root.path()).expect("root");
    corrupt_live_database(&root);
    let c = Arc::new(clock());

    run(stage_restore(root.clone(), c.clone(), archive, Vec::new())).expect("stage");

    assert!(root.restore_pending().is_dir());
    assert!(!root.restore_staging().exists());
    let dirs = raw_dirs(&root);
    assert_eq!(dirs.len(), 1);
    assert_eq!(
        dirs[0],
        raw_copy_dir(
            &root,
            &BackupName::new(c.now_for_tests(), BackupKind::PreRestore).stamp()
        )
    );
    assert_eq!(
        fs::read(dirs[0].join("homebase.db")).expect("db"),
        CORRUPT_DB
    );
    assert_eq!(
        fs::read(dirs[0].join("homebase.db-wal")).expect("wal"),
        b"WAL-BYTES"
    );
    // The -shm is only a cache that SQLite may have rewritten while the snapshot failed.
    assert!(dirs[0].join("homebase.db-shm").is_file());
    // The live files are untouched, and the raw copy is not a restorable backup.
    assert_eq!(fs::read(root.db()).expect("db"), CORRUPT_DB);
    assert!(list_backups(&root).is_empty());
}

#[test]
fn raw_copy_only_copies_the_companions_that_exist() {
    let dir = TempDir::new().expect("tmp");
    let archive = archive_with_version(&dir, 2);
    let root = DataRoot::new(dir.path().join("root"));
    fs::create_dir_all(root.path()).expect("root");
    fs::write(root.db(), CORRUPT_DB).expect("db");
    run(stage_restore(
        root.clone(),
        Arc::new(clock()),
        archive,
        Vec::new(),
    ))
    .expect("stage");
    let dirs = raw_dirs(&root);
    assert_eq!(dirs.len(), 1);
    let names: Vec<_> = fs::read_dir(&dirs[0])
        .expect("dir")
        .map(|e| e.expect("entry").file_name())
        .collect();
    assert_eq!(names, ["homebase.db"]);
}

#[test]
fn raw_copy_failure_cancels_the_preparation() {
    let dir = TempDir::new().expect("tmp");
    let archive = archive_with_version(&dir, 2);
    let root = DataRoot::new(dir.path().join("root"));
    fs::create_dir_all(root.path()).expect("root");
    corrupt_live_database(&root);
    let c = Arc::new(clock());
    // The target folder already exists (same stamp): the copy cannot start.
    let stamp = BackupName::new(c.now_for_tests(), BackupKind::PreRestore).stamp();
    let existing = raw_copy_dir(&root, &stamp);
    fs::create_dir_all(&existing).expect("existing");
    fs::write(existing.join("keep.txt"), b"keep").expect("keep");

    let err = run(stage_restore(root.clone(), c, archive, Vec::new())).expect_err("cancelled");
    assert_eq!(
        err,
        BackupError::Io {
            code: "AlreadyExists".into()
        }
    );
    assert!(!root.restore_pending().exists());
    assert!(!root.restore_staging().exists());
    assert_eq!(fs::read(existing.join("keep.txt")).expect("kept"), b"keep");
    assert_eq!(fs::read(root.db()).expect("db"), CORRUPT_DB);
}

#[test]
fn a_healthy_database_never_produces_a_raw_copy() {
    let dir = TempDir::new().expect("tmp");
    let archive = archive_with_version(&dir, 2);
    let root = DataRoot::new(dir.path().join("root"));
    fs::create_dir_all(root.path()).expect("root");
    make_database(&root.db(), 3, true);
    run(stage_restore(
        root.clone(),
        Arc::new(clock()),
        archive,
        Vec::new(),
    ))
    .expect("stage");
    assert!(raw_dirs(&root).is_empty());
    assert_eq!(count(&root, BackupKind::PreRestore), 1);
}

#[test]
fn raw_copy_folder_survives_retention_and_the_following_startup() {
    let dir = TempDir::new().expect("tmp");
    let archive = archive_with_version(&dir, 2);
    let root = DataRoot::new(dir.path().join("root"));
    fs::create_dir_all(root.path()).expect("root");
    corrupt_live_database(&root);
    let c = Arc::new(clock());
    run(stage_restore(root.clone(), c.clone(), archive, Vec::new())).expect("stage");
    // The restoration is applied at the next startup; raw copy is outside the retention.
    let outcome = startup_sequence(&root, c.as_ref()).expect("startup");
    assert!(outcome.swapped);
    for _ in 0..8 {
        c.advance(SignedDuration::from_secs(60));
        run(create_backup(
            &root,
            c.as_ref(),
            BackupKind::PreRestore,
            &[],
        ))
        .expect("backup");
    }
    assert_eq!(raw_dirs(&root).len(), 1);
    assert_eq!(count(&root, BackupKind::PreRestore), 5);
}

#[test]
fn swap_still_works_after_a_raw_copy_preparation() {
    // The pending folder produced with a corrupted live database is a normal pending folder.
    let dir = TempDir::new().expect("tmp");
    let archive = archive_with_version(&dir, 3);
    let root = DataRoot::new(dir.path().join("root"));
    fs::create_dir_all(root.path()).expect("root");
    corrupt_live_database(&root);
    let c = Arc::new(clock());
    run(stage_restore(root.clone(), c.clone(), archive, Vec::new())).expect("stage");
    let manifest = verify_pending(&root).expect("valid pending");
    swap(&root, c.as_ref(), &manifest, &Faults::default()).expect("swap");
    assert_eq!(run(read_schema_version(&root.db())).expect("v"), Some(3));
}

#[test]
fn raw_copy_includes_a_journal_and_cleans_up_when_it_fails() {
    let (_d, root) = new_root();
    corrupt_live_database(&root);
    let [_, _, journal] = root.db_companions();
    fs::write(&journal, b"JOURNAL-BYTES").expect("journal");
    raw_copy_live_database(&root, "20261021T081500.123Z").expect("copy");
    let dir = raw_copy_dir(&root, "20261021T081500.123Z");
    for (name, bytes) in [
        ("homebase.db", CORRUPT_DB),
        ("homebase.db-wal", &b"WAL-BYTES"[..]),
        ("homebase.db-shm", &b"SHM-BYTES"[..]),
        ("homebase.db-journal", &b"JOURNAL-BYTES"[..]),
    ] {
        assert_eq!(fs::read(dir.join(name)).expect(name), bytes, "{name}");
    }
    // A companion that cannot be copied removes the whole folder: a directory in place of the
    // journal cannot be read as a file.
    fs::remove_file(&journal).expect("remove");
    fs::create_dir(&journal).expect("directory");
    assert!(raw_copy_live_database(&root, "20261021T081600.123Z").is_err());
    assert!(!raw_copy_dir(&root, "20261021T081600.123Z").exists());
}
