//! Restoration (spec 4.8): staging, swap at startup, rollback and confirmation.
//!
//! Everything here that touches files is synchronous and may sleep (`rename_with_retry`,
//! `remove_with_retry`): it runs in the startup sequence or in `spawn_blocking`.
//!
//! Failure points (`Faults`) are test seams: a hook returning `Err` behaves like a real I/O
//! failure at that point; a hook that unwinds simulates a process crash (no cleanup runs).

use super::create::{blocking, create_backup};
use super::error::BackupError;
use super::fsutil::{remove_with_retry, rename_with_retry, write_json_atomic};
use super::manifest::{Manifest, DB_ENTRY, IMAGES_PREFIX, MANIFEST_ENTRY, MANIFEST_FORMAT};
use super::names::{is_image_file_name, BackupKind, BackupName};
use super::paths::DataRoot;
use super::status::{
    clear_db_missing, write_last_restore, write_startup_blocked, RestoreOutcome, RestoreReport,
    StartupBlockedReason,
};
use super::validate::extract_validated;
use super::MAX_MANIFEST_BYTES;
use crate::db::DB_FILE_NAME;
use crate::time::clock::Clock;
use crate::time::formats::{format_instant, parse_instant};
use jiff::Timestamp;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fmt;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::Arc;

const INFO_FILE: &str = "restore-info.json";
const INFO_TMP_FILE: &str = "restore-info.json.tmp";
const ROLLBACK_IMAGES: &str = "images";
const CONFIRMED_PREFIX: &str = "restore-rollback.confirmed-";

// ---------------------------------------------------------------------------------------------
// Test seams
// ---------------------------------------------------------------------------------------------

/// Point reached right after the numbered step of the swap (spec 4.8, "Échange").
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SwapStep {
    /// Reached right before the corresponding rename (spec 4.8: the info is readable by then).
    BeforeDbMove,
    BeforeCompanionMove,
    BeforeImagesMove,
    BeforeDbInstall,
    BeforeImagesInstall,
    /// 1. `restore-rollback\` created.
    RollbackDirCreated,
    /// 2. `restore-info.json` written.
    InfoWritten,
    /// 3. `homebase.db` moved to `restore-rollback\`.
    DbMoved,
    /// 4. `-wal`, `-shm`, `-journal` moved.
    CompanionsMoved,
    /// 5. `images\` moved to `restore-rollback\images\`.
    ImagesMoved,
    /// 6. restored `homebase.db` installed.
    DbInstalled,
    /// 7. restored `images\` installed.
    ImagesInstalled,
    /// 8. `restore-pending\` removed.
    PendingRemoved,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Item {
    Db,
    Wal,
    Shm,
    Journal,
    Images,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RollbackStep {
    /// The foreign element was removed, the original is not back yet.
    ForeignRemoved(Item),
    /// The element is fully handled.
    Done(Item),
    /// All elements handled, `restore-rollback\` not touched yet.
    BeforeCleanup,
    /// `restore-info.json` removed, the (now empty) directory remains.
    InfoRemoved,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConfirmStep {
    /// `restore-rollback\` renamed to `.confirmed-<stamp>` (errors are only logged from here on).
    AfterMark,
    /// `last-restore.json` and `db-missing.json` handled.
    AfterMarkers,
    /// One entry of the confirmed folder was deleted.
    DuringDelete,
}

/// Points of the startup sequence itself.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StartupStep {
    /// Right before `restore-pending` is removed after a failed or refused exchange.
    DiscardRemove,
}

type Hook<'a, S> = &'a dyn Fn(S) -> io::Result<()>;

#[derive(Clone, Copy, Default)]
pub struct Faults<'a> {
    pub swap: Option<Hook<'a, SwapStep>>,
    pub rollback: Option<Hook<'a, RollbackStep>>,
    pub confirm: Option<Hook<'a, ConfirmStep>>,
    pub startup: Option<Hook<'a, StartupStep>>,
}

impl Faults<'_> {
    fn at_swap(&self, step: SwapStep) -> io::Result<()> {
        self.swap.map_or(Ok(()), |hook| hook(step))
    }

    fn at_rollback(&self, step: RollbackStep) -> io::Result<()> {
        self.rollback.map_or(Ok(()), |hook| hook(step))
    }

    fn at_confirm(&self, step: ConfirmStep) -> io::Result<()> {
        self.confirm.map_or(Ok(()), |hook| hook(step))
    }

    pub fn at_startup(&self, step: StartupStep) -> io::Result<()> {
        self.startup.map_or(Ok(()), |hook| hook(step))
    }
}

// ---------------------------------------------------------------------------------------------
// restore-info.json
// ---------------------------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RestoreInfo {
    pub backup_created_at: String,
    pub backup_kind: BackupKind,
    pub includes_images: bool,
    pub original_had_db: bool,
    pub original_had_wal: bool,
    pub original_had_shm: bool,
    pub original_had_journal: bool,
    pub original_had_images: bool,
    pub started_at: String,
}

impl RestoreInfo {
    /// Filename-safe `startedAt` (same shape as the stamp of archive names). The value comes from
    /// the disk and ends up in a path: it must parse as an instant first.
    pub fn stamp(&self) -> Option<String> {
        let at = parse_instant(&self.started_at).ok()?;
        Some(BackupName::new(at, BackupKind::Manual).stamp())
    }
}

/// `None` when the file is absent, unreadable or not a valid `RestoreInfo`.
pub fn read_restore_info(path: &Path) -> Option<RestoreInfo> {
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

/// Whether something exists at `path` (a broken symlink counts); only `NotFound` means absent.
pub fn present(path: &Path) -> io::Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e),
    }
}

fn companion_paths(root: &DataRoot, dir: &Path) -> [(PathBuf, PathBuf); 3] {
    root.db_companions().map(|from| {
        let saved = dir.join(from.file_name().unwrap_or_default());
        (from, saved)
    })
}

fn report(
    outcome: RestoreOutcome,
    at: Timestamp,
    created: Option<String>,
    kind: Option<BackupKind>,
) -> RestoreReport {
    RestoreReport {
        outcome,
        at: format_instant(at),
        backup_created_at: created,
        backup_kind: kind,
    }
}

pub fn write_report(
    root: &DataRoot,
    outcome: RestoreOutcome,
    at: Timestamp,
    created: Option<String>,
    kind: Option<BackupKind>,
) {
    if let Err(e) = write_last_restore(root, &report(outcome, at, created, kind)) {
        eprintln!("restore: cannot write last-restore.json: {:?}", e.kind());
    }
}

// ---------------------------------------------------------------------------------------------
// Staging (async, under the backup lock)
// ---------------------------------------------------------------------------------------------

/// Validates and extracts `archive` into `restore-staging.tmp\`, takes the `pre-restore` backup
/// (the source stays protected from retention through `protect`), then publishes the result as
/// `restore-pending\`. The caller then marks the restart pending and requests the restart.
///
/// Gap in the spec (4.8, step 2): with no database at all (R6), there is nothing to back up and
/// `create_backup` answers `NoDatabase`; that case continues without `pre-restore` instead of
/// making the recovery impossible.
pub async fn stage_restore(
    root: DataRoot,
    clock: Arc<dyn Clock>,
    archive: PathBuf,
    protect: Vec<String>,
) -> Result<(), BackupError> {
    let staging = root.restore_staging();
    let pending = root.restore_pending();
    {
        let staging = staging.clone();
        blocking(move || remove_with_retry(&staging)).await??;
    }
    extract_validated(&archive, &staging).await?;

    let protect_refs: Vec<&str> = protect.iter().map(String::as_str).collect();
    match create_backup(&root, clock.as_ref(), BackupKind::PreRestore, &protect_refs).await {
        Ok(_) => {}
        Err(BackupError::NoDatabase) => {
            eprintln!("restore: no database to protect, continuing without a pre-restore backup");
        }
        // The live database is corrupted: restoring is precisely what the user needs, so the
        // safety copy falls back to a raw copy of the files (spec 4.8, B2b review amendment).
        // If even that fails, the preparation is cancelled.
        Err(e) if is_corruption(&e) => {
            eprintln!("restore: live database is corrupted, taking a raw safety copy");
            let (raw_root, stamp) = (
                root.clone(),
                BackupName::new(clock.now(), BackupKind::PreRestore).stamp(),
            );
            let copied = blocking(move || raw_copy_live_database(&raw_root, &stamp)).await;
            match copied {
                Ok(Ok(())) => {}
                Ok(Err(io_error)) => {
                    eprintln!("restore: raw safety copy failed: {:?}", io_error.kind());
                    remove_staging(&staging).await;
                    return Err(io_error.into());
                }
                Err(join_error) => {
                    remove_staging(&staging).await;
                    return Err(join_error);
                }
            }
        }
        Err(e) => {
            remove_staging(&staging).await;
            return Err(e);
        }
    }

    let published = {
        let (staging, pending) = (staging.clone(), pending);
        blocking(move || -> io::Result<()> {
            remove_with_retry(&pending)?;
            rename_with_retry(&staging, &pending)
        })
        .await?
    };
    if let Err(e) = published {
        remove_staging(&staging).await;
        return Err(e.into());
    }
    Ok(())
}

/// Stages the archive previously copied by `backup_pick_external` (`.incoming\picked.zip`), then
/// removes that private copy. `NotFound` when there is none. The caller holds the backup lock.
pub async fn stage_restore_external(
    root: DataRoot,
    clock: Arc<dyn Clock>,
) -> Result<(), BackupError> {
    let picked = root.incoming_picked();
    {
        let picked = picked.clone();
        if !blocking(move || picked.is_file()).await? {
            return Err(BackupError::NotFound);
        }
    }
    stage_restore(root, clock, picked.clone(), Vec::new()).await?;
    // Spec 4.8 step 4. The restoration is staged: a leftover would only be emptied at startup.
    if let Ok(Err(e)) = blocking(move || remove_with_retry(&picked)).await {
        eprintln!("restore: cannot remove picked.zip: {:?}", e.kind());
    }
    Ok(())
}

/// SQLite primary codes 11 (`SQLITE_CORRUPT`) and 26 (`SQLITE_NOTADB`). sqlx reports the extended
/// code (for example 523, 779), whose low byte is the primary code.
pub fn is_corruption(error: &BackupError) -> bool {
    match error {
        BackupError::Database { code } => code
            .parse::<i64>()
            .is_ok_and(|c| matches!(c & 0xFF, 11 | 26)),
        _ => false,
    }
}

/// Folder holding the raw safety copy: `backups\homebase-<stamp>-pre-restore-raw\`. Not an
/// archive name (`BackupName::parse` refuses it and it is a directory), so it is never listed,
/// never restorable from the UI and never touched by the retention: it stays until the user
/// deletes it.
pub fn raw_copy_dir(root: &DataRoot, stamp: &str) -> PathBuf {
    root.backups()
        .join(format!("homebase-{stamp}-pre-restore-raw"))
}

fn copy_raw_file(from: &Path, to: &Path) -> io::Result<()> {
    // `File::open` shares read/write/delete, so a database held open by this process can be read
    // (unlike `fs::copy`, which asks for less sharing).
    let mut input = fs::File::open(from)?;
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(to)?;
    io::copy(&mut input, &mut output)?;
    output.sync_all()
}

/// Copies `homebase.db` and the companions that exist (`-wal`, `-shm`, `-journal`) into
/// `raw_copy_dir`. No inspection. Any failure removes the folder and is returned, except for the
/// `-shm`: it is only a cache rebuilt from the `-wal`, and SQLite may hold byte-range locks on it
/// that make it unreadable while the database is open. Blocking.
pub fn raw_copy_live_database(root: &DataRoot, stamp: &str) -> io::Result<()> {
    let dir = raw_copy_dir(root, stamp);
    fs::create_dir_all(root.backups())?;
    fs::create_dir(&dir)?;
    let result = (|| -> io::Result<()> {
        copy_raw_file(&root.db(), &dir.join(DB_FILE_NAME))?;
        for (from, saved) in companion_paths(root, &dir) {
            if !present(&from)? {
                continue;
            }
            let is_shm = from.to_string_lossy().ends_with("-shm");
            match copy_raw_file(&from, &saved) {
                Ok(()) => {}
                Err(e) if is_shm => {
                    eprintln!("restore: -shm not copied ({:?}), it is rebuilt", e.kind());
                    let _ = fs::remove_file(&saved);
                }
                Err(e) => return Err(e),
            }
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = remove_with_retry(&dir);
    }
    result
}

async fn remove_staging(staging: &Path) {
    let staging = staging.to_owned();
    if let Ok(Err(e)) = blocking(move || remove_with_retry(&staging)).await {
        eprintln!("restore: cannot remove the staging folder: {:?}", e.kind());
    }
}

// ---------------------------------------------------------------------------------------------
// restore-pending verification
// ---------------------------------------------------------------------------------------------

fn to_hex(digest: &[u8]) -> String {
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

fn sha256_of(path: &Path) -> io::Result<(u64, String)> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    let mut size = 0u64;
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        size += n as u64;
        hasher.update(&buf[..n]);
    }
    Ok((size, to_hex(&hasher.finalize())))
}

fn is_valid_entry_path(path: &str) -> bool {
    path == DB_ENTRY
        || path
            .strip_prefix(IMAGES_PREFIX)
            .is_some_and(is_image_file_name)
}

/// Why `restore-pending\` cannot be applied; the manifest is returned when it could be read.
#[derive(Debug)]
pub struct PendingInvalid {
    pub manifest: Option<Manifest>,
}

/// The folder must hold **exactly** `manifest.json` and the files it lists (no companion, no
/// extra file), with the right sizes and SHA-256.
pub fn verify_pending(root: &DataRoot) -> Result<Manifest, PendingInvalid> {
    let dir = root.restore_pending();
    let manifest = read_pending_manifest(&dir).ok_or(PendingInvalid { manifest: None })?;
    let invalid = |manifest: &Manifest| PendingInvalid {
        manifest: Some(manifest.clone()),
    };
    let listed: BTreeSet<&str> = manifest.files.iter().map(|f| f.path.as_str()).collect();
    if listed.len() != manifest.files.len()
        || !listed.contains(DB_ENTRY)
        || !listed.iter().all(|p| is_valid_entry_path(p))
    {
        return Err(invalid(&manifest));
    }
    let Some(actual) = list_pending_files(&dir) else {
        return Err(invalid(&manifest));
    };
    let expected: BTreeSet<String> = listed
        .iter()
        .map(|p| (*p).to_owned())
        .chain([MANIFEST_ENTRY.to_owned()])
        .collect();
    if actual != expected {
        return Err(invalid(&manifest));
    }
    for file in &manifest.files {
        match sha256_of(&dir.join(&file.path)) {
            Ok((size, hash)) if size == file.size && hash == file.sha256 => {}
            _ => return Err(invalid(&manifest)),
        }
    }
    Ok(manifest)
}

fn read_pending_manifest(dir: &Path) -> Option<Manifest> {
    let path = dir.join(MANIFEST_ENTRY);
    let meta = fs::symlink_metadata(&path).ok()?;
    if !meta.is_file() || meta.len() > MAX_MANIFEST_BYTES {
        return None;
    }
    let manifest: Manifest = serde_json::from_slice(&fs::read(&path).ok()?).ok()?;
    (manifest.format == MANIFEST_FORMAT
        && manifest.format_version == super::manifest::MANIFEST_VERSION)
        .then_some(manifest)
}

/// Relative paths (`/`-separated) of every file; `None` for anything that is neither a regular
/// file nor the `images` folder holding regular files.
fn list_pending_files(dir: &Path) -> Option<BTreeSet<String>> {
    let mut found = BTreeSet::new();
    for entry in fs::read_dir(dir).ok()? {
        let entry = entry.ok()?;
        let name = entry.file_name().into_string().ok()?;
        let kind = entry.file_type().ok()?;
        if kind.is_file() {
            found.insert(name);
        } else if kind.is_dir() && name == ROLLBACK_IMAGES {
            for image in fs::read_dir(entry.path()).ok()? {
                let image = image.ok()?;
                if !image.file_type().ok()?.is_file() {
                    return None;
                }
                found.insert(format!(
                    "{IMAGES_PREFIX}{}",
                    image.file_name().into_string().ok()?
                ));
            }
        } else {
            return None;
        }
    }
    Some(found)
}

// ---------------------------------------------------------------------------------------------
// Swap
// ---------------------------------------------------------------------------------------------

/// Rename that refuses to replace anything (on Windows `fs::rename` replaces a file): a target
/// that appeared since the start of the exchange means someone else is working on the root.
fn rename_new(from: &Path, to: &Path) -> io::Result<()> {
    if present(to)? {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "rename target already exists",
        ));
    }
    rename_with_retry(from, to)
}

/// The eight steps of spec 4.8. `restore-pending\` must already be verified. Renames use
/// `rename_with_retry` and never replace an existing target. On `Err` the caller runs
/// `rollback()`. Returns the `restore-info.json` written at step 2, for the confirmation.
pub fn swap(
    root: &DataRoot,
    clock: &dyn Clock,
    manifest: &Manifest,
    faults: &Faults,
) -> io::Result<RestoreInfo> {
    let rollback = root.restore_rollback();
    let pending = root.restore_pending();
    let images = root.images();
    let had_images = manifest.includes_images && present(&images)?;
    let companions = companion_paths(root, &rollback);
    let mut had_companion = [false; 3];
    for (slot, (from, _)) in had_companion.iter_mut().zip(&companions) {
        *slot = present(from)?;
    }
    let info = RestoreInfo {
        backup_created_at: manifest.created_at.clone(),
        backup_kind: manifest.kind,
        includes_images: manifest.includes_images,
        original_had_db: present(&root.db())?,
        original_had_wal: had_companion[0],
        original_had_shm: had_companion[1],
        original_had_journal: had_companion[2],
        original_had_images: present(&images)?,
        started_at: format_instant(clock.now()),
    };

    // 1.
    fs::create_dir(&rollback)?;
    faults.at_swap(SwapStep::RollbackDirCreated)?;
    // 2.
    write_json_atomic(&root.restore_info(), &info)?;
    faults.at_swap(SwapStep::InfoWritten)?;
    // 3. if this fails, nothing has moved.
    if info.original_had_db {
        faults.at_swap(SwapStep::BeforeDbMove)?;
        rename_new(&root.db(), &rollback.join(DB_FILE_NAME))?;
    }
    faults.at_swap(SwapStep::DbMoved)?;
    // 4.
    for ((from, saved), had) in companions.iter().zip(had_companion) {
        if had {
            faults.at_swap(SwapStep::BeforeCompanionMove)?;
            rename_new(from, saved)?;
        }
    }
    faults.at_swap(SwapStep::CompanionsMoved)?;
    // 5.
    if had_images {
        faults.at_swap(SwapStep::BeforeImagesMove)?;
        rename_new(&images, &rollback.join(ROLLBACK_IMAGES))?;
    }
    faults.at_swap(SwapStep::ImagesMoved)?;
    // 6.
    faults.at_swap(SwapStep::BeforeDbInstall)?;
    rename_new(&pending.join(DB_ENTRY), &root.db())?;
    faults.at_swap(SwapStep::DbInstalled)?;
    // 7.
    let pending_images = pending.join(ROLLBACK_IMAGES);
    if manifest.includes_images && present(&pending_images)? {
        faults.at_swap(SwapStep::BeforeImagesInstall)?;
        rename_new(&pending_images, &images)?;
    }
    faults.at_swap(SwapStep::ImagesInstalled)?;
    // 8.
    remove_with_retry(&pending)?;
    faults.at_swap(SwapStep::PendingRemoved)?;
    Ok(info)
}

// ---------------------------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------------------------

#[derive(Debug)]
pub enum RollbackError {
    /// `restore-info.json` is absent or unreadable while `restore-rollback\` holds something else.
    InfoUnreadable,
    Io(io::Error),
}

impl From<io::Error> for RollbackError {
    fn from(e: io::Error) -> Self {
        RollbackError::Io(e)
    }
}

impl RollbackError {
    pub fn reason(&self) -> StartupBlockedReason {
        match self {
            RollbackError::InfoUnreadable => StartupBlockedReason::RollbackInfoUnreadable,
            RollbackError::Io(_) => StartupBlockedReason::RollbackFailed,
        }
    }
}

/// `Ok(true)` when the folder is absent, empty or holds only `restore-info.json.tmp`.
fn is_empty_or_info_tmp(dir: &Path) -> io::Result<bool> {
    match fs::read_dir(dir) {
        Ok(entries) => {
            for entry in entries {
                if entry?.file_name() != INFO_TMP_FILE {
                    return Ok(false);
                }
            }
            Ok(true)
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(true),
        Err(e) => Err(e),
    }
}

/// One file of the database set. The foreign element is removed first, then the original is put
/// back; an original without a copy in `restore-rollback\` is already at the root: keep it.
fn restore_file(
    target: &Path,
    saved: &Path,
    original_had: bool,
    item: Item,
    faults: &Faults,
) -> Result<(), RollbackError> {
    if original_had {
        if present(saved)? {
            remove_with_retry(target)?;
            faults.at_rollback(RollbackStep::ForeignRemoved(item))?;
            rename_with_retry(saved, target)?;
        }
    } else {
        remove_with_retry(target)?;
    }
    faults.at_rollback(RollbackStep::Done(item))?;
    Ok(())
}

/// Renames `restore-rollback` to `restore-rollback.leftover-<stamp>` (a counter is appended when
/// that name is taken).
fn set_aside_leftover(root: &DataRoot, dir: &Path, info: &RestoreInfo) -> io::Result<()> {
    let stamp = info
        .stamp()
        .ok_or_else(|| io::Error::other("restore-info: invalid startedAt"))?;
    let base = root.restore_rollback_leftover(&stamp);
    let mut target = base.clone();
    let mut counter = 1u32;
    while present(&target)? {
        counter += 1;
        let mut name = base.as_os_str().to_owned();
        name.push(format!("-{counter}"));
        target = PathBuf::from(name);
    }
    eprintln!("restore: unexpected content in restore-rollback, folder set aside");
    rename_new(dir, &target)
}

/// Puts the original state back, driven by `restore-info.json`. Idempotent, also when
/// interrupted and run again. Any I/O error stops it without further deletion.
pub fn rollback(root: &DataRoot, faults: &Faults) -> Result<(), RollbackError> {
    let dir = root.restore_rollback();
    let Some(info) = read_restore_info(&root.restore_info()) else {
        if is_empty_or_info_tmp(&dir)? {
            remove_with_retry(&dir)?;
            return Ok(());
        }
        return Err(RollbackError::InfoUnreadable);
    };

    restore_file(
        &root.db(),
        &dir.join(DB_FILE_NAME),
        info.original_had_db,
        Item::Db,
        faults,
    )?;
    let companions = companion_paths(root, &dir);
    let had = [
        (info.original_had_wal, Item::Wal),
        (info.original_had_shm, Item::Shm),
        (info.original_had_journal, Item::Journal),
    ];
    for ((target, saved), (original_had, item)) in companions.iter().zip(had) {
        restore_file(target, saved, original_had, item, faults)?;
    }

    let saved_images = dir.join(ROLLBACK_IMAGES);
    if present(&saved_images)? {
        remove_with_retry(&root.images())?;
        faults.at_rollback(RollbackStep::ForeignRemoved(Item::Images))?;
        rename_with_retry(&saved_images, &root.images())?;
    } else if info.includes_images && !info.original_had_images {
        remove_with_retry(&root.images())?;
    }
    faults.at_rollback(RollbackStep::Done(Item::Images))?;

    faults.at_rollback(RollbackStep::BeforeCleanup)?;
    // Everything of ours is back; anything else in there is not ours to delete: the folder is set
    // aside (never deleted nor restored automatically) so that the application can start.
    for entry in fs::read_dir(&dir)? {
        let name = entry?.file_name();
        if name != INFO_FILE && name != INFO_TMP_FILE {
            set_aside_leftover(root, &dir, &info)?;
            return Ok(());
        }
    }
    remove_with_retry(&root.restore_info())?;
    remove_with_retry(&dir.join(INFO_TMP_FILE))?;
    faults.at_rollback(RollbackStep::InfoRemoved)?;
    remove_with_retry(&dir)?;
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Confirmation
// ---------------------------------------------------------------------------------------------

#[derive(Debug)]
pub enum ConfirmError {
    /// The swap's `startedAt` is not a valid instant (nothing was renamed).
    InfoUnreadable,
    /// `restore-rollback\` could not be renamed to `.confirmed-<stamp>`.
    MarkFailed(io::Error),
}

impl fmt::Display for ConfirmError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ConfirmError::InfoUnreadable => write!(f, "restore confirmation: info unreadable"),
            ConfirmError::MarkFailed(e) => {
                write!(f, "restore confirmation: cannot mark ({:?})", e.kind())
            }
        }
    }
}

impl std::error::Error for ConfirmError {}

/// Deletes a confirmed folder entry by entry (so that a failure can leave it half deleted), then
/// the folder itself.
pub fn remove_confirmed_dir(dir: &Path, faults: &Faults) -> io::Result<()> {
    for entry in fs::read_dir(dir)? {
        remove_with_retry(&entry?.path())?;
        faults.at_confirm(ConfirmStep::DuringDelete)?;
    }
    remove_with_retry(dir)
}

/// Every `restore-rollback.confirmed-*` folder directly under the root.
pub fn confirmed_dirs(root: &DataRoot) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(root.path()) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter(|e| {
            e.file_name()
                .to_str()
                .is_some_and(|n| n.starts_with(CONFIRMED_PREFIX))
                && e.file_type().is_ok_and(|t| t.is_dir())
        })
        .map(|e| e.path())
        .collect()
}

/// First call of `.setup()`. Only after a swap in this process: rename `restore-rollback\` to
/// `.confirmed-<stamp>` (atomic mark, **before** any deletion), then record `applied`, then delete.
pub fn confirm_restore(
    root: &DataRoot,
    clock: &dyn Clock,
    swapped: Option<&RestoreInfo>,
) -> Result<(), ConfirmError> {
    confirm_restore_with(root, clock, swapped, &Faults::default())
}

pub fn confirm_restore_with(
    root: &DataRoot,
    clock: &dyn Clock,
    swapped: Option<&RestoreInfo>,
    faults: &Faults,
) -> Result<(), ConfirmError> {
    let rollback = root.restore_rollback();
    let Some(info) = swapped else {
        if rollback.exists() {
            eprintln!("restore: restore-rollback is present without a swap in this process");
        }
        return Ok(());
    };
    let blocked = |error: ConfirmError| {
        if let Err(e) =
            write_startup_blocked(root, clock.now(), StartupBlockedReason::ConfirmMarkFailed)
        {
            eprintln!("restore: cannot write startup-blocked.json: {:?}", e.kind());
        }
        error
    };
    // 1. the info comes from memory (the swap of this process), not from the disk.
    let Some(stamp) = info.stamp() else {
        return Err(blocked(ConfirmError::InfoUnreadable));
    };
    // 2. atomic mark: nothing is deleted before this succeeds.
    let confirmed = root.restore_rollback_confirmed(&stamp);
    if let Err(e) = rename_with_retry(&rollback, &confirmed) {
        return Err(blocked(ConfirmError::MarkFailed(e)));
    }
    if let Err(e) = faults.at_confirm(ConfirmStep::AfterMark) {
        eprintln!("restore: after-mark hook failed: {:?}", e.kind());
    }
    // 3. `at` is the swap's `startedAt`: the startup sequence relies on it to recognise `applied`.
    if let Ok(started) = parse_instant(&info.started_at) {
        write_report(
            root,
            RestoreOutcome::Applied,
            started,
            Some(info.backup_created_at.clone()),
            Some(info.backup_kind),
        );
    }
    if let Err(e) = clear_db_missing(root) {
        eprintln!("restore: cannot remove db-missing.json: {:?}", e.kind());
    }
    if let Err(e) = faults.at_confirm(ConfirmStep::AfterMarkers) {
        eprintln!("restore: after-markers hook failed: {:?}", e.kind());
    }
    // 4. a failure is only logged: the next startup finishes the deletion, never a restoration.
    if let Err(e) = remove_confirmed_dir(&confirmed, faults) {
        eprintln!(
            "restore: confirmed folder not fully deleted ({:?}), retry at next startup",
            e.kind()
        );
    }
    Ok(())
}

impl fmt::Display for RollbackError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RollbackError::InfoUnreadable => write!(f, "rollback: restore-info unreadable"),
            RollbackError::Io(e) => write!(f, "rollback: I/O error ({:?})", e.kind()),
        }
    }
}
