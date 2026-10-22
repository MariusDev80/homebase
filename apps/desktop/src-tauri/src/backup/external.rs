//! Files chosen by the user (spec D5, 4.10): export of a backup to a user-chosen place, and the
//! private copy of an external archive. These functions receive paths from the dialogs, never from
//! the front, and treat the files as data.

use super::create::blocking;
use super::error::BackupError;
use super::fsutil::{remove_with_retry, rename_with_retry};
use super::manifest::Manifest;
use super::names::BackupKind;
use super::paths::DataRoot;
use super::restore::sha256_of;
use super::validate::extract_validated;
use super::MAX_ARCHIVE_BYTES;
use serde::Serialize;
use std::ffi::OsString;
use std::fs;
use std::io::{self, Read};
use std::path::Path;

/// What the front is told about an external archive before it can be restored.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveSummary {
    pub kind: BackupKind,
    pub created_at: String,
    pub size_bytes: u64,
    pub includes_images: bool,
    pub schema_version: i64,
    pub app_version: String,
    pub image_count: u32,
    /// SHA-256 (hex) of the private copy `picked.zip`. `backup_restore(External)` must send it
    /// back: the archive restored is then the one the user was shown.
    pub token: String,
}

impl ArchiveSummary {
    fn new(manifest: &Manifest, size_bytes: u64, token: String) -> Self {
        Self {
            kind: manifest.kind,
            created_at: manifest.created_at.clone(),
            size_bytes,
            includes_images: manifest.includes_images,
            schema_version: manifest.schema_version,
            app_version: manifest.app_version.clone(),
            image_count: manifest.image_count(),
            token,
        }
    }
}

fn refuse(code: &str) -> BackupError {
    BackupError::Io { code: code.into() }
}

/// The destination must be a `.zip` (case-insensitive) outside the Homebase data root: writing
/// there would let a dialog choice plant a file among the app's own (`restore-pending`, `backups`
/// ...). The parent is canonicalised first, so `..` and links cannot hide the root.
fn check_export_destination(root: &DataRoot, dest: &Path) -> Result<(), BackupError> {
    let is_zip = dest
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("zip"));
    if !is_zip {
        return Err(refuse("bad_extension"));
    }
    let parent = dest
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let parent = fs::canonicalize(parent)?;
    // A root that does not exist yet cannot contain an existing parent.
    if let Ok(root) = fs::canonicalize(root.path()) {
        if parent.starts_with(&root) {
            return Err(refuse("destination_in_data_root"));
        }
    }
    Ok(())
}

/// Removes the temporary file of a previous crash. Only a regular file is removed (judged by
/// `symlink_metadata`, so a link is never followed nor deleted); anything else is refused.
fn recover_orphan_tmp(tmp: &Path) -> io::Result<()> {
    match fs::symlink_metadata(tmp) {
        Ok(meta) if meta.file_type().is_file() => fs::remove_file(tmp),
        Ok(_) => Err(io::Error::from(io::ErrorKind::AlreadyExists)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

/// Copies `src` to `dest` through `.<name>.homebase-tmp` (created with `create_new`, after
/// removing a regular leftover of a crash), then renames it over `dest` (replacing is allowed: the
/// user confirmed it in the save dialog). `dest` must pass `check_export_destination`. No partial
/// file survives an error. Blocking.
pub fn export_archive_to(root: &DataRoot, src: &Path, dest: &Path) -> Result<(), BackupError> {
    check_export_destination(root, dest)?;
    let mut tmp_name = OsString::from(".");
    tmp_name.push(
        dest.file_name()
            .ok_or_else(|| io::Error::from(io::ErrorKind::InvalidInput))?,
    );
    tmp_name.push(".homebase-tmp");
    let tmp = dest.with_file_name(tmp_name);
    recover_orphan_tmp(&tmp)?;
    let result = (|| -> io::Result<()> {
        let mut input = fs::File::open(src)?;
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)?;
        io::copy(&mut input, &mut output)?;
        output.sync_all()?;
        drop(output);
        rename_with_retry(&tmp, dest)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result.map_err(BackupError::from)
}

/// Copies at most `max + 1` bytes and fails with `TooLarge` when the source holds more than `max`.
pub(super) fn copy_bounded<R: Read, W: io::Write>(
    input: &mut R,
    output: &mut W,
    max: u64,
) -> Result<u64, BackupError> {
    let copied = io::copy(&mut input.take(max.saturating_add(1)), output)?;
    if copied > max {
        return Err(BackupError::TooLarge);
    }
    Ok(copied)
}

/// Copies the user's file into `backups\.incoming\picked.zip` (via `picked.zip.partial`), reading
/// at most `max + 1` bytes. Replaces a previous `picked.zip`. Blocking.
pub fn copy_external_archive_with(
    src: &Path,
    root: &DataRoot,
    max: u64,
) -> Result<u64, BackupError> {
    let meta = fs::metadata(src)?;
    if !meta.is_file() {
        return Err(BackupError::Io {
            code: "not_a_file".into(),
        });
    }
    if meta.len() > max {
        return Err(BackupError::TooLarge);
    }
    let incoming = root.incoming();
    fs::create_dir_all(&incoming)?;
    let partial = incoming.join("picked.zip.partial");
    remove_with_retry(&partial)?;
    let result = (|| -> Result<u64, BackupError> {
        let mut input = fs::File::open(src)?;
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&partial)?;
        // The file may grow after the metadata check: the copy is bounded as well.
        let copied = copy_bounded(&mut input, &mut output, max)?;
        output.sync_all()?;
        drop(output);
        remove_with_retry(&root.incoming_picked())?;
        rename_with_retry(&partial, &root.incoming_picked())?;
        Ok(copied)
    })();
    if result.is_err() {
        let _ = remove_with_retry(&partial);
    }
    result
}

pub fn copy_external_archive(src: &Path, root: &DataRoot) -> Result<u64, BackupError> {
    copy_external_archive_with(src, root, MAX_ARCHIVE_BYTES)
}

/// Private copy, full validation (extraction into `.incoming\check\`, removed afterwards), then
/// the summary. On failure `picked.zip` is removed. The caller holds the backup lock.
pub async fn import_external(root: &DataRoot, src: &Path) -> Result<ArchiveSummary, BackupError> {
    let result = async {
        let (src, root_copy) = (src.to_owned(), root.clone());
        let size = blocking(move || copy_external_archive(&src, &root_copy)).await??;
        let check = root.incoming_check();
        {
            let check = check.clone();
            blocking(move || remove_with_retry(&check)).await??;
        }
        let manifest = extract_validated(&root.incoming_picked(), &check).await;
        {
            let check = check.clone();
            // Best effort: `.incoming` is emptied at every startup anyway.
            if let Ok(Err(e)) = blocking(move || remove_with_retry(&check)).await {
                eprintln!("backup: cannot remove the check folder: {:?}", e.kind());
            }
        }
        let manifest = manifest?;
        let picked = root.incoming_picked();
        let (_, token) = blocking(move || sha256_of(&picked)).await??;
        Ok(ArchiveSummary::new(&manifest, size, token))
    }
    .await;
    if result.is_err() {
        let picked = root.incoming_picked();
        if let Ok(Err(e)) = blocking(move || remove_with_retry(&picked)).await {
            eprintln!("backup: cannot remove picked.zip: {:?}", e.kind());
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backup::create::create_backup;
    use crate::backup::error::ArchiveProblem;
    use crate::backup::test_support::{make_database, run};
    use crate::time::clock::FixedClock;
    use crate::time::formats::parse_instant;
    use tempfile::TempDir;

    fn clock(when: &str) -> FixedClock {
        FixedClock::new(parse_instant(when).expect("instant"))
    }

    /// A data root that is not part of the temporary folder used for the exports.
    fn root_for(dir: &TempDir) -> DataRoot {
        DataRoot::new(dir.path().join("data-root"))
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut found: Vec<String> = fs::read_dir(dir)
            .expect("dir")
            .map(|e| e.expect("entry").file_name().to_string_lossy().into_owned())
            .collect();
        found.sort();
        found
    }

    /// A real archive built from a temporary root.
    fn real_archive(dir: &TempDir) -> std::path::PathBuf {
        let root = DataRoot::new(dir.path().join("source-root"));
        fs::create_dir_all(root.path()).expect("root");
        make_database(&root.db(), 2, true);
        let info = run(create_backup(
            &root,
            &clock("2026-10-21T08:15:00.123Z"),
            BackupKind::Manual,
            &[],
        ))
        .expect("backup");
        root.backups().join(info.id)
    }

    #[test]
    fn export_copies_identically_and_leaves_no_temporary_file() {
        let dir = TempDir::new().expect("tmp");
        let src = dir.path().join("src.zip");
        let out = dir.path().join("out");
        fs::create_dir(&out).expect("out");
        let content: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
        fs::write(&src, &content).expect("src");
        let dest = out.join("exported.zip");
        export_archive_to(&root_for(&dir), &src, &dest).expect("export");
        assert_eq!(fs::read(&dest).expect("dest"), content);
        assert_eq!(names(&out), ["exported.zip"]);
    }

    #[test]
    fn export_replaces_an_existing_destination() {
        let dir = TempDir::new().expect("tmp");
        let src = dir.path().join("src.zip");
        let dest = dir.path().join("dest.zip");
        fs::write(&src, b"new content").expect("src");
        fs::write(&dest, b"old").expect("dest");
        export_archive_to(&root_for(&dir), &src, &dest).expect("export");
        assert_eq!(fs::read(&dest).expect("dest"), b"new content");
        assert_eq!(names(dir.path()), ["dest.zip", "src.zip"]);
    }

    #[test]
    fn export_errors_leave_no_partial_file_and_keep_the_destination() {
        let dir = TempDir::new().expect("tmp");
        // Missing source.
        let dest = dir.path().join("dest.zip");
        fs::write(&dest, b"old").expect("dest");
        let err = export_archive_to(&root_for(&dir), &dir.path().join("absent.zip"), &dest)
            .expect_err("no source");
        assert_eq!(
            err,
            BackupError::Io {
                code: "NotFound".into()
            }
        );
        assert_eq!(fs::read(&dest).expect("dest"), b"old");
        assert_eq!(names(dir.path()), ["dest.zip"]);

        // Missing destination folder.
        let src = dir.path().join("src.zip");
        fs::write(&src, b"x").expect("src");
        assert!(export_archive_to(
            &root_for(&dir),
            &src,
            &dir.path().join("no-such-dir").join("d.zip")
        )
        .is_err());

        // A directory in place of the temporary file is refused and kept.
        let tmp = dir.path().join(".dest.zip.homebase-tmp");
        fs::create_dir(&tmp).expect("tmp dir");
        assert!(export_archive_to(&root_for(&dir), &src, &dest).is_err());
        assert_eq!(fs::read(&dest).expect("dest"), b"old");
        assert!(tmp.is_dir());
    }

    #[test]
    fn export_recovers_an_orphan_temporary_file() {
        let dir = TempDir::new().expect("tmp");
        let src = dir.path().join("src.zip");
        let dest = dir.path().join("dest.zip");
        fs::write(&src, b"new").expect("src");
        fs::write(dir.path().join(".dest.zip.homebase-tmp"), b"leftover").expect("tmp");
        export_archive_to(&root_for(&dir), &src, &dest).expect("export");
        assert_eq!(fs::read(&dest).expect("dest"), b"new");
        assert_eq!(names(dir.path()), ["dest.zip", "src.zip"]);
    }

    #[test]
    fn export_never_follows_a_link_in_place_of_the_temporary_file() {
        let dir = TempDir::new().expect("tmp");
        let src = dir.path().join("src.zip");
        let dest = dir.path().join("dest.zip");
        let victim = dir.path().join("victim.txt");
        fs::write(&src, b"new").expect("src");
        fs::write(&victim, b"precious").expect("victim");
        let tmp = dir.path().join(".dest.zip.homebase-tmp");
        #[cfg(windows)]
        let linked = std::os::windows::fs::symlink_file(&victim, &tmp);
        #[cfg(not(windows))]
        let linked = std::os::unix::fs::symlink(&victim, &tmp);
        if linked.is_err() {
            // Creating a symbolic link needs a privilege (or developer mode) on Windows.
            eprintln!("symlink not available, test skipped");
            return;
        }
        assert!(export_archive_to(&root_for(&dir), &src, &dest).is_err());
        assert_eq!(fs::read(&victim).expect("victim"), b"precious");
        assert!(fs::symlink_metadata(&tmp).expect("link kept").is_symlink());
        assert!(!dest.exists());
    }

    #[test]
    fn export_refuses_a_destination_under_the_data_root() {
        let dir = TempDir::new().expect("tmp");
        let root = DataRoot::new(dir.path().join("data"));
        fs::create_dir_all(root.backups()).expect("backups");
        let src = dir.path().join("src.zip");
        fs::write(&src, b"x").expect("src");
        let refused = BackupError::Io {
            code: "destination_in_data_root".into(),
        };
        for dest in [
            root.path().join("out.zip"),
            root.backups().join("out.zip"),
            // `..` cannot hide the root.
            root.backups().join("..").join("backups").join("out.zip"),
        ] {
            assert_eq!(export_archive_to(&root, &src, &dest), Err(refused.clone()));
            assert!(!dest.exists());
        }
        // A sibling folder whose name starts like the root is fine.
        let sibling = dir.path().join("data-other");
        fs::create_dir(&sibling).expect("sibling");
        export_archive_to(&root, &src, &sibling.join("out.zip")).expect("outside");
        assert!(names(&root.backups()).is_empty());
    }

    #[test]
    fn export_requires_a_zip_extension_case_insensitively() {
        let dir = TempDir::new().expect("tmp");
        let src = dir.path().join("src.zip");
        fs::write(&src, b"x").expect("src");
        let refused = BackupError::Io {
            code: "bad_extension".into(),
        };
        for name in ["out.exe", "out", "out.zip.txt", "out.zip."] {
            let dest = dir.path().join(name);
            assert_eq!(
                export_archive_to(&root_for(&dir), &src, &dest),
                Err(refused.clone()),
                "{name}"
            );
            assert!(!dest.exists());
        }
        export_archive_to(&root_for(&dir), &src, &dir.path().join("OUT.ZIP")).expect("upper");
        assert!(dir.path().join("OUT.ZIP").is_file());
    }

    #[test]
    fn bounded_copy_stops_one_byte_past_the_limit() {
        let mut out = Vec::new();
        assert_eq!(
            copy_bounded(&mut io::repeat(7).take(10), &mut out, 10),
            Ok(10)
        );
        assert_eq!(out.len(), 10);
        // An endless source: the copy reads max + 1 bytes at most, then fails.
        let mut out = Vec::new();
        assert_eq!(
            copy_bounded(&mut io::repeat(7), &mut out, 10),
            Err(BackupError::TooLarge)
        );
        assert_eq!(out.len(), 11);
        assert_eq!(copy_bounded(&mut io::empty(), &mut Vec::new(), 0), Ok(0));
        assert_eq!(
            copy_bounded(&mut io::repeat(1), &mut Vec::new(), 0),
            Err(BackupError::TooLarge)
        );
    }

    #[test]
    fn copy_replaces_the_previous_picked_archive_and_leaves_no_partial() {
        let dir = TempDir::new().expect("tmp");
        let root = DataRoot::new(dir.path().join("root"));
        let a = dir.path().join("a.zip");
        let b = dir.path().join("b.zip");
        fs::write(&a, b"first").expect("a");
        fs::write(&b, b"second one").expect("b");
        assert_eq!(copy_external_archive(&a, &root).expect("copy a"), 5);
        assert_eq!(copy_external_archive(&b, &root).expect("copy b"), 10);
        assert_eq!(
            fs::read(root.incoming_picked()).expect("picked"),
            b"second one"
        );
        assert_eq!(names(&root.incoming()), ["picked.zip"]);
        // The user's file is untouched.
        assert_eq!(fs::read(&a).expect("a"), b"first");
    }

    #[test]
    fn copy_refuses_too_large_files_and_non_files() {
        let dir = TempDir::new().expect("tmp");
        let root = DataRoot::new(dir.path().join("root"));
        let big = dir.path().join("big.zip");
        fs::write(&big, [0u8; 11]).expect("big");
        let ok = dir.path().join("ok.zip");
        fs::write(&ok, [0u8; 10]).expect("ok");
        assert_eq!(
            copy_external_archive_with(&big, &root, 10),
            Err(BackupError::TooLarge)
        );
        assert!(!root.incoming_picked().exists());
        assert_eq!(copy_external_archive_with(&ok, &root, 10), Ok(10));
        // A refused copy keeps the previous picked archive.
        assert_eq!(
            copy_external_archive_with(&big, &root, 10),
            Err(BackupError::TooLarge)
        );
        assert!(root.incoming_picked().exists());
        assert_eq!(names(&root.incoming()), ["picked.zip"]);
        assert_eq!(
            copy_external_archive_with(dir.path(), &root, 10),
            Err(BackupError::Io {
                code: "not_a_file".into()
            })
        );
    }

    #[test]
    fn import_external_validates_and_summarises() {
        let dir = TempDir::new().expect("tmp");
        let archive = real_archive(&dir);
        let root = DataRoot::new(dir.path().join("root"));
        let summary = run(import_external(&root, &archive)).expect("summary");
        assert_eq!(summary.kind, BackupKind::Manual);
        assert_eq!(summary.created_at, "2026-10-21T08:15:00.123Z");
        assert_eq!(summary.schema_version, 2);
        assert!(summary.includes_images);
        assert_eq!(summary.image_count, 0);
        assert_eq!(
            summary.size_bytes,
            fs::metadata(&archive).expect("meta").len()
        );
        assert_eq!(names(&root.incoming()), ["picked.zip"]);
    }

    #[test]
    fn invalid_external_archive_removes_picked_zip() {
        let dir = TempDir::new().expect("tmp");
        let root = DataRoot::new(dir.path().join("root"));
        let junk = dir.path().join("junk.zip");
        fs::write(&junk, vec![7u8; 4096]).expect("junk");
        let err = run(import_external(&root, &junk)).expect_err("invalid");
        assert_eq!(
            err,
            BackupError::InvalidArchive {
                problem: ArchiveProblem::NotZip
            }
        );
        assert!(names(&root.incoming()).is_empty());
        // A previous valid pick is replaced then removed too: no stale archive can be restored.
        let archive = real_archive(&dir);
        run(import_external(&root, &archive)).expect("valid");
        assert!(root.incoming_picked().exists());
        run(import_external(&root, &junk)).expect_err("invalid again");
        assert!(!root.incoming_picked().exists());
    }
}
