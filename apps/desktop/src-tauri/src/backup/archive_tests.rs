//! Hardening tests of `archive::read_manifest` (spec 4.7, checks 1 to 7).

use super::archive::*;
use super::error::{ArchiveProblem, BackupError};
use super::manifest::{Manifest, ManifestFile, MANIFEST_FORMAT, MANIFEST_VERSION};
use super::names::BackupKind;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tempfile::TempDir;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

const UUID: &str = "3f0c2a5e-8f0b-4c55-9a43-0d2a1d6c9b11";
const PNG: &[u8] = &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4];

fn problem(err: BackupError) -> ArchiveProblem {
    match err {
        BackupError::InvalidArchive { problem } => problem,
        other => panic!("unexpected error {other:?}"),
    }
}

/// A real archive written by `write_archive`: 5000-byte database and one PNG.
fn baseline(dir: &TempDir) -> PathBuf {
    let snapshot = dir.path().join("snap.db");
    fs::write(&snapshot, vec![7u8; 5000]).expect("snapshot");
    let image = dir.path().join(format!("{UUID}.png"));
    fs::write(&image, PNG).expect("image");
    let images = [ImageFile {
        name: format!("{UUID}.png"),
        path: image,
        size: PNG.len() as u64,
    }];
    let spec = ArchiveSpec {
        created_at: "2026-10-21T08:15:00.123Z".into(),
        kind: BackupKind::Manual,
        schema_version: 3,
        snapshot: &snapshot,
        images: &images,
    };
    let out = dir.path().join("base.zip");
    write_archive(&out, &spec, &Limits::default()).expect("write");
    assert!(read_manifest(&out).is_ok());
    out
}

fn find_all(haystack: &[u8], needle: &[u8]) -> Vec<usize> {
    haystack
        .windows(needle.len())
        .enumerate()
        .filter(|(_, w)| *w == needle)
        .map(|(i, _)| i)
        .collect()
}

/// Patches a copy of `src`; offsets of the central (`PK 01 02`) and local (`PK 03 04`) headers
/// are passed to `patch` (index 0 = database, 1 = image, 2 = manifest).
fn patched(
    src: &Path,
    name: &str,
    patch: impl FnOnce(&mut Vec<u8>, &[usize], &[usize]),
) -> PathBuf {
    let mut bytes = fs::read(src).expect("read");
    let central = find_all(&bytes, b"PK\x01\x02");
    let local = find_all(&bytes, b"PK\x03\x04");
    assert_eq!((central.len(), local.len()), (3, 3));
    patch(&mut bytes, &central, &local);
    let out = src.with_file_name(name);
    fs::write(&out, bytes).expect("write");
    out
}

fn expect(path: &Path, wanted: ArchiveProblem) {
    assert_eq!(problem(read_manifest(path).expect_err("refused")), wanted);
}

#[test]
fn garbage_and_tiny_files_are_not_zip() {
    let dir = TempDir::new().expect("tmp");
    let path = dir.path().join("a.zip");
    for content in [&b""[..], &b"short"[..], &[b'x'; 5000][..]] {
        fs::write(&path, content).expect("write");
        expect(&path, ArchiveProblem::NotZip);
    }
}

#[test]
fn leading_garbage_is_not_zip() {
    let dir = TempDir::new().expect("tmp");
    let p = patched(&baseline(&dir), "junk.zip", |b, _, _| {
        let mut v = vec![b'J'; 1 << 20];
        v.append(b);
        *b = v;
    });
    expect(&p, ArchiveProblem::NotZip);
}

#[test]
fn mass_central_directory_signatures_are_refused_quickly() {
    let dir = TempDir::new().expect("tmp");
    let base = baseline(&dir);
    let mut bytes = b"PK\x01\x02".repeat(32 * 1024 * 1024 / 4);
    bytes.extend(fs::read(&base).expect("read"));
    let p = dir.path().join("spam.zip");
    fs::write(&p, bytes).expect("write");
    let started = Instant::now();
    expect(&p, ArchiveProblem::NotZip);
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "{:?}",
        started.elapsed()
    );
}

#[test]
fn zip64_markers_are_refused() {
    let dir = TempDir::new().expect("tmp");
    let base = baseline(&dir);
    let counts = patched(&base, "z64count.zip", |b, _, _| {
        let e = *find_all(b, b"PK\x05\x06").last().expect("eocd");
        b[e + 10..e + 12].copy_from_slice(&0xFFFFu16.to_le_bytes());
    });
    expect(&counts, ArchiveProblem::Zip64);
    let locator = patched(&base, "z64loc.zip", |b, _, _| {
        let e = *find_all(b, b"PK\x05\x06").last().expect("eocd");
        let mut loc = b"PK\x06\x07".to_vec();
        loc.resize(20, 0);
        b.splice(e..e, loc);
    });
    expect(&locator, ArchiveProblem::Zip64);
}

#[test]
fn overlapping_entries_are_refused() {
    let dir = TempDir::new().expect("tmp");
    let p = patched(&baseline(&dir), "overlap.zip", |b, central, _| {
        // The image entry now starts where the database entry starts.
        let first: [u8; 4] = b[central[0] + 42..central[0] + 46]
            .try_into()
            .expect("offset");
        b[central[1] + 42..central[1] + 46].copy_from_slice(&first);
    });
    expect(&p, ArchiveProblem::OverlappingEntries);
}

#[test]
fn encrypted_and_unsupported_compression_are_refused() {
    let dir = TempDir::new().expect("tmp");
    let base = baseline(&dir);
    let encrypted = patched(&base, "enc.zip", |b, central, local| {
        b[central[1] + 8] |= 1;
        b[local[1] + 6] |= 1;
    });
    expect(&encrypted, ArchiveProblem::EncryptedEntry);
    let method = patched(&base, "method.zip", |b, central, local| {
        b[central[1] + 10..central[1] + 12].copy_from_slice(&12u16.to_le_bytes());
        b[local[1] + 8..local[1] + 10].copy_from_slice(&12u16.to_le_bytes());
    });
    expect(&method, ArchiveProblem::UnsupportedCompression);
}

#[test]
fn size_limits_are_enforced() {
    let dir = TempDir::new().expect("tmp");
    let base = baseline(&dir);
    let image_limit = Limits {
        max_image_bytes: 4,
        ..Limits::default()
    };
    assert_eq!(
        problem(read_manifest_with(&base, &image_limit).expect_err("image")),
        ArchiveProblem::EntryTooLarge
    );
    let total_limit = Limits {
        max_total_uncompressed: 5005,
        ..Limits::default()
    };
    assert_eq!(
        problem(read_manifest_with(&base, &total_limit).expect_err("total")),
        ArchiveProblem::TotalTooLarge
    );
    let size_limit = Limits {
        max_archive_bytes: 10,
        ..Limits::default()
    };
    assert_eq!(
        read_manifest_with(&base, &size_limit).expect_err("size"),
        BackupError::TooLarge
    );
}

#[test]
fn entries_outside_the_allow_list_and_missing_parts_are_refused() {
    let dir = TempDir::new().expect("tmp");
    let build = |entries: &[(&str, &[u8])]| {
        let path = dir.path().join("a.zip");
        let mut zip = ZipWriter::new(File::create(&path).expect("create"));
        for (name, data) in entries {
            zip.start_file(*name, SimpleFileOptions::default())
                .expect("start");
            zip.write_all(data).expect("write");
        }
        zip.finish().expect("finish");
        path
    };
    expect(
        &build(&[("homebase.db", b"x"), ("../evil.txt", b"x")]),
        ArchiveProblem::UnexpectedEntry,
    );
    expect(
        &build(&[("homebase.db", b"x")]),
        ArchiveProblem::MissingManifest,
    );
    expect(
        &build(&[("manifest.json", b"{}")]),
        ArchiveProblem::MissingDatabase,
    );
    expect(
        &build(&[("homebase.db", b"x"), ("manifest.json", b"{}")]),
        ArchiveProblem::InvalidManifest,
    );
    let limits = Limits {
        max_entries: 1,
        ..Limits::default()
    };
    let two = build(&[("homebase.db", b"x"), ("manifest.json", b"{}")]);
    assert_eq!(
        problem(read_manifest_with(&two, &limits).expect_err("limit")),
        ArchiveProblem::TooManyEntries
    );
}

#[test]
fn duplicate_names_are_caught_when_the_archive_is_opened() {
    let dir = TempDir::new().expect("tmp");
    let path = dir.path().join("dup.zip");
    let mut zip = ZipWriter::new(File::create(&path).expect("create"));
    let options = SimpleFileOptions::default();
    for (name, data) in [
        ("homebase.db", &b"aaa"[..]),
        ("homebase.dX", &b"bbb"[..]),
        ("manifest.json", &b"{}"[..]),
    ] {
        zip.start_file(name, options).expect("start");
        zip.write_all(data).expect("write");
    }
    zip.finish().expect("finish");
    let mut bytes = fs::read(&path).expect("read");
    for i in find_all(&bytes, b"homebase.dX") {
        bytes[i + 10] = b'b';
    }
    fs::write(&path, bytes).expect("write");
    // zip 9 drops the second name at open: the count no longer matches the EOCD.
    expect(&path, ArchiveProblem::TooManyEntries);
}

fn file(path: &str, size: u64) -> ManifestFile {
    ManifestFile {
        path: path.into(),
        size,
        sha256: "0".repeat(64),
    }
}

/// Zip with `homebase.db` (6 bytes), optionally the image (12 bytes), and a manifest that
/// `change` may alter.
fn with_manifest(dir: &TempDir, with_image: bool, change: impl FnOnce(&mut Manifest)) -> PathBuf {
    let image = format!("images/{UUID}.png");
    let mut files = vec![file("homebase.db", 6)];
    if with_image {
        files.push(file(&image, PNG.len() as u64));
    }
    let mut manifest = Manifest {
        format: MANIFEST_FORMAT.into(),
        format_version: MANIFEST_VERSION,
        created_at: "2026-10-21T08:15:00.123Z".into(),
        kind: BackupKind::Manual,
        app_version: "0.0.0".into(),
        schema_version: 3,
        includes_images: with_image,
        files,
    };
    change(&mut manifest);
    let path = dir.path().join("m.zip");
    let mut zip = ZipWriter::new(File::create(&path).expect("create"));
    let options = SimpleFileOptions::default();
    zip.start_file("homebase.db", options).expect("start");
    zip.write_all(b"dbdata").expect("write");
    if with_image {
        zip.start_file(&image, options).expect("start");
        zip.write_all(PNG).expect("write");
    }
    zip.start_file("manifest.json", options).expect("start");
    zip.write_all(&serde_json::to_vec(&manifest).expect("json"))
        .expect("write");
    zip.finish().expect("finish");
    path
}

#[test]
fn manifest_checks() {
    let dir = TempDir::new().expect("tmp");
    assert!(read_manifest(&with_manifest(&dir, true, |_| {})).is_ok());

    expect(
        &with_manifest(&dir, false, |m| m.format_version = 2),
        ArchiveProblem::UnsupportedFormat,
    );
    expect(
        &with_manifest(&dir, false, |m| m.format = "other".into()),
        ArchiveProblem::UnsupportedFormat,
    );
    expect(
        &with_manifest(&dir, false, |m| m.created_at = "2026-10-21".into()),
        ArchiveProblem::InvalidManifest,
    );
    for bad in ["", "has space", "x/y", &"9".repeat(65)] {
        expect(
            &with_manifest(&dir, false, |m| m.app_version = bad.into()),
            ArchiveProblem::InvalidManifest,
        );
    }
    // Size differs.
    expect(
        &with_manifest(&dir, false, |m| m.files[0].size = 7),
        ArchiveProblem::ManifestMismatch,
    );
    // Listed but absent.
    expect(
        &with_manifest(&dir, false, |m| {
            m.files
                .push(file("images/4a1d3b6f-9a1c-4d66-8b54-1e3b2e7d0c22.png", 1))
        }),
        ArchiveProblem::ManifestMismatch,
    );
    // Present but not listed.
    expect(
        &with_manifest(&dir, true, |m| {
            m.files.pop();
        }),
        ArchiveProblem::ManifestMismatch,
    );
    // Images in the archive while includesImages is false.
    expect(
        &with_manifest(&dir, true, |m| m.includes_images = false),
        ArchiveProblem::ManifestMismatch,
    );
    // Same path listed twice.
    expect(
        &with_manifest(&dir, false, |m| m.files.push(file("homebase.db", 6))),
        ArchiveProblem::ManifestMismatch,
    );
}

#[test]
fn image_replaced_by_non_image_is_refused_at_copy_time() {
    let dir = TempDir::new().expect("tmp");
    let snapshot = dir.path().join("snap.db");
    fs::write(&snapshot, b"db").expect("snapshot");
    let image = dir.path().join(format!("{UUID}.png"));
    fs::write(&image, b"plain text, not a png").expect("image");
    let images = [ImageFile {
        name: format!("{UUID}.png"),
        path: image,
        size: 21,
    }];
    let spec = ArchiveSpec {
        created_at: "2026-10-21T08:15:00.123Z".into(),
        kind: BackupKind::Manual,
        schema_version: 3,
        snapshot: &snapshot,
        images: &images,
    };
    let err =
        write_archive(&dir.path().join("o.zip"), &spec, &Limits::default()).expect_err("refused");
    assert_eq!(
        err,
        BackupError::Io {
            code: "changed_during_backup".into()
        }
    );
}
