//! Tests of `validate` (spec 4.7, checks 8 and 9, and the zip slip allow-list).

use super::archive::Limits;
use super::create::create_backup;
use super::error::{ArchiveProblem, BackupError};
use super::manifest::{Manifest, ManifestFile, MANIFEST_FORMAT, MANIFEST_VERSION};
use super::names::BackupKind;
use super::paths::DataRoot;
use super::sqlite::supported_schema_version;
use super::test_support::{make_database, make_database_with_migrator, run};
use super::validate::*;
use crate::time::clock::FixedClock;
use crate::time::formats::parse_instant;
use sha2::{Digest, Sha256};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode};
use sqlx::{Connection, SqliteConnection};
use std::collections::BTreeSet;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use tempfile::TempDir;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

const UUID: &str = "3f0c2a5e-8f0b-4c55-9a43-0d2a1d6c9b11";
const PNG: &[u8] = &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4];

fn image_name() -> String {
    format!("{UUID}.png")
}

/// Bytes of a database at `version`, after running `sql` on it (single file, no WAL).
fn db_bytes(version: i64, sql: &str) -> Vec<u8> {
    let dir = TempDir::new().expect("tmp");
    let path = dir.path().join("m.db");
    make_database(&path, version, true);
    run(async {
        let options = SqliteConnectOptions::new()
            .filename(&path)
            .foreign_keys(false)
            .journal_mode(SqliteJournalMode::Delete);
        let mut conn = SqliteConnection::connect_with(&options)
            .await
            .expect("open");
        sqlx::raw_sql(sql).execute(&mut conn).await.expect("mutate");
        conn.close().await.expect("close");
    });
    fs::read(&path).expect("read")
}

fn sha(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn manifest_for(db: &[u8], images: &[(String, Vec<u8>)], schema_version: i64) -> Manifest {
    let mut files = vec![ManifestFile {
        path: "homebase.db".into(),
        size: db.len() as u64,
        sha256: sha(db),
    }];
    for (name, data) in images {
        files.push(ManifestFile {
            path: format!("images/{name}"),
            size: data.len() as u64,
            sha256: sha(data),
        });
    }
    Manifest {
        format: MANIFEST_FORMAT.into(),
        format_version: MANIFEST_VERSION,
        created_at: "2026-10-21T08:15:00.123Z".into(),
        kind: BackupKind::Manual,
        app_version: "0.0.0".into(),
        schema_version,
        includes_images: !images.is_empty(),
        files,
    }
}

/// Writes a zip with exactly these entries (names as given); images are Stored.
fn write_zip(path: &Path, entries: &[(&str, &[u8])]) {
    let mut zip = ZipWriter::new(File::create(path).expect("create"));
    for (name, data) in entries {
        let method = if name.starts_with("images/") {
            CompressionMethod::Stored
        } else {
            CompressionMethod::Deflated
        };
        zip.start_file(
            *name,
            SimpleFileOptions::default().compression_method(method),
        )
        .expect("start");
        zip.write_all(data).expect("write");
    }
    zip.finish().expect("finish");
}

/// A consistent archive: database, images, manifest (changed by `tweak`).
fn archive(
    dir: &Path,
    db: &[u8],
    images: &[(String, Vec<u8>)],
    schema_version: i64,
    tweak: impl FnOnce(&mut Manifest),
) -> PathBuf {
    let mut manifest = manifest_for(db, images, schema_version);
    tweak(&mut manifest);
    let json = serde_json::to_vec(&manifest).expect("json");
    let image_names: Vec<String> = images.iter().map(|(n, _)| format!("images/{n}")).collect();
    let mut entries: Vec<(&str, &[u8])> = vec![("homebase.db", db)];
    for (name, (_, data)) in image_names.iter().zip(images) {
        entries.push((name, data));
    }
    entries.push(("manifest.json", &json));
    let path = dir.join("a.zip");
    write_zip(&path, &entries);
    path
}

fn good_archive(dir: &Path) -> PathBuf {
    archive(
        dir,
        &db_bytes(3, ""),
        &[(image_name(), PNG.to_vec())],
        3,
        |_| {},
    )
}

fn listing(dir: &Path) -> BTreeSet<String> {
    fn walk(base: &Path, dir: &Path, out: &mut BTreeSet<String>) {
        for entry in fs::read_dir(dir).expect("dir") {
            let path = entry.expect("entry").path();
            if path.is_dir() {
                walk(base, &path, out);
            }
            out.insert(
                path.strip_prefix(base)
                    .expect("prefix")
                    .to_string_lossy()
                    .replace('\\', "/"),
            );
        }
    }
    let mut out = BTreeSet::new();
    walk(dir, dir, &mut out);
    out
}

/// Extracts into `<archive dir>/dest` and checks that a failure leaves the directory untouched.
fn try_extract(archive: &Path) -> Result<Manifest, BackupError> {
    let dir = archive.parent().expect("parent");
    let before = listing(dir);
    let dest = dir.join("dest");
    let result = run(extract_validated(archive, &dest));
    if result.is_err() {
        assert!(!dest.exists(), "dest must be removed on failure");
        assert_eq!(listing(dir), before, "nothing written outside dest");
    }
    result
}

fn refused(archive: &Path) -> ArchiveProblem {
    match try_extract(archive).expect_err("must be refused") {
        BackupError::InvalidArchive { problem } => problem,
        other => panic!("unexpected error {other:?}"),
    }
}

fn expect_problem(archive: &Path, wanted: ArchiveProblem) {
    assert_eq!(refused(archive), wanted);
}

fn db_archive(dir: &TempDir, version: i64, sql: &str) -> PathBuf {
    archive(dir.path(), &db_bytes(version, sql), &[], version, |_| {})
}

fn find_all(haystack: &[u8], needle: &[u8]) -> Vec<usize> {
    haystack
        .windows(needle.len())
        .enumerate()
        .filter(|(_, w)| *w == needle)
        .map(|(i, _)| i)
        .collect()
}

#[test]
fn archive_from_create_backup_is_accepted_in_a_path_with_spaces_and_accents() {
    let dir = TempDir::new().expect("tmp");
    let root = DataRoot::new(dir.path().join("données de Marius"));
    fs::create_dir_all(root.images()).expect("images");
    make_database(&root.db(), 3, true);
    fs::write(root.images().join(image_name()), PNG).expect("image");
    let clock = FixedClock::new(parse_instant("2026-10-21T08:15:00.123Z").expect("instant"));
    let info = run(create_backup(&root, &clock, BackupKind::Manual, &[])).expect("create");
    let archive = root.backups().join(&info.id);

    let dest = dir.path().join("restauré é ü");
    let manifest = run(extract_validated(&archive, &dest)).expect("accepted");
    assert_eq!(manifest.schema_version, 3);
    let files: Vec<String> = listing(&dest).into_iter().collect();
    // S2: no -wal / -shm / -journal companion is created by the inspection.
    assert_eq!(
        files,
        vec![
            "homebase.db".to_owned(),
            "images".to_owned(),
            format!("images/{}", image_name()),
            "manifest.json".to_owned(),
        ]
    );
    assert_eq!(
        fs::read(dest.join("images").join(image_name())).expect("img"),
        PNG
    );
    let written: Manifest =
        serde_json::from_slice(&fs::read(dest.join("manifest.json")).expect("m")).expect("json");
    assert_eq!(written, manifest);
}

#[test]
fn existing_dest_is_refused_and_left_alone() {
    let dir = TempDir::new().expect("tmp");
    let archive = good_archive(dir.path());
    let dest = dir.path().join("dest");
    fs::create_dir(&dest).expect("dest");
    fs::write(dest.join("keep.txt"), b"x").expect("keep");
    let err = run(extract_validated(&archive, &dest)).expect_err("refused");
    assert_eq!(
        err,
        BackupError::Io {
            code: "AlreadyExists".into()
        }
    );
    assert!(dest.join("keep.txt").exists());
}

#[test]
fn zip_structure_errors() {
    let dir = TempDir::new().expect("tmp");
    let good = good_archive(dir.path());
    let bytes = fs::read(&good).expect("read");

    // No EOCD.
    let no_eocd = dir.path().join("b.zip");
    fs::write(&no_eocd, &bytes[..bytes.len() - 30]).expect("write");
    let work = TempDir::new().expect("tmp");
    let copy = work.path().join("a.zip");
    fs::copy(&no_eocd, &copy).expect("copy");
    expect_problem(&copy, ArchiveProblem::NotZip);

    let patch = |f: &dyn Fn(&mut Vec<u8>)| {
        let mut b = bytes.clone();
        f(&mut b);
        let w = TempDir::new().expect("tmp");
        let p = w.path().join("a.zip");
        fs::write(&p, b).expect("write");
        (w, p)
    };
    let eocd = |b: &Vec<u8>| *find_all(b, b"PK\x05\x06").last().expect("eocd");

    // Forged entry count above the limit.
    let (_w, p) = patch(&|b| {
        let e = eocd(b);
        b[e + 10..e + 12].copy_from_slice(&20_001u16.to_le_bytes());
    });
    expect_problem(&p, ArchiveProblem::TooManyEntries);
    // zip64 markers.
    let (_w, p) = patch(&|b| {
        let e = eocd(b);
        b[e + 10..e + 12].copy_from_slice(&0xFFFFu16.to_le_bytes());
    });
    expect_problem(&p, ArchiveProblem::Zip64);
    // Reduced limits.
    let limits = Limits {
        max_db_bytes: 10,
        ..Limits::default()
    };
    let dest = dir.path().join("dest");
    let err = run(extract_validated_with(&good, &dest, &limits)).expect_err("limit");
    assert_eq!(
        err,
        BackupError::InvalidArchive {
            problem: ArchiveProblem::EntryTooLarge
        }
    );
    assert!(!dest.exists());
}

#[test]
fn zip_slip_and_reserved_names_are_refused() {
    let bad_names = [
        "../x",
        "../homebase.db",
        "/x",
        "/homebase.db",
        "C:/x",
        "C:\\x",
        "images/../homebase.db",
        "images\\x.webp",
        "images\\..\\..\\x",
        "\\\\server\\share\\x",
        "homebase.db:ads",
        "manifest.json:ads",
        "images/sub/x.webp",
        &format!("IMAGES/{UUID}.png"),
        &format!("images/{UUID}.svg"),
        &format!("images/{UUID}.png:ads"),
        "images/x.svg",
        "CON",
        "NUL",
        "images/CON",
        &format!("images/{UUID}.png."),
        &format!("images/{UUID}.png "),
        "Homebase.db",
    ];
    for name in bad_names {
        let dir = TempDir::new().expect("tmp");
        let path = dir.path().join("a.zip");
        write_zip(
            &path,
            &[
                ("homebase.db", b"x"),
                (name, b"x"),
                ("manifest.json", b"{}"),
            ],
        );
        assert_eq!(refused(&path), ArchiveProblem::UnexpectedEntry, "{name}");
    }
    // Directory entry.
    let dir = TempDir::new().expect("tmp");
    let path = dir.path().join("a.zip");
    let mut zip = ZipWriter::new(File::create(&path).expect("create"));
    let options = SimpleFileOptions::default();
    zip.start_file("homebase.db", options).expect("start");
    zip.write_all(b"x").expect("write");
    zip.add_directory("images/", options).expect("dir");
    zip.start_file("manifest.json", options).expect("start");
    zip.write_all(b"{}").expect("write");
    zip.finish().expect("finish");
    assert_eq!(refused(&path), ArchiveProblem::UnexpectedEntry);
}

#[test]
fn duplicate_entry_is_refused() {
    let dir = TempDir::new().expect("tmp");
    let path = dir.path().join("a.zip");
    write_zip(
        &path,
        &[
            ("homebase.db", b"aaa"),
            ("homebase.dX", b"bbb"),
            ("manifest.json", b"{}"),
        ],
    );
    let mut bytes = fs::read(&path).expect("read");
    for i in find_all(&bytes, b"homebase.dX") {
        bytes[i + 10] = b'b';
    }
    fs::write(&path, bytes).expect("write");
    expect_problem(&path, ArchiveProblem::TooManyEntries);
}

#[test]
fn central_directory_name_decides_not_the_local_header() {
    let dir = TempDir::new().expect("tmp");
    let good = good_archive(dir.path());
    let mut bytes = fs::read(&good).expect("read");
    // Local header of the image says "../" + part of the name; the central name is untouched.
    let local = find_all(&bytes, b"PK\x03\x04")[1];
    bytes[local + 30..local + 33].copy_from_slice(b"../");
    let work = TempDir::new().expect("tmp");
    let path = work.path().join("a.zip");
    fs::write(&path, bytes).expect("write");
    // The local header disagrees with the central directory: refused, nothing extracted.    expect_problem(&path, ArchiveProblem::CorruptEntry);
}

#[test]
fn encrypted_and_unknown_method_are_refused() {
    let dir = TempDir::new().expect("tmp");
    let good = good_archive(dir.path());
    let bytes = fs::read(&good).expect("read");
    let central = find_all(&bytes, b"PK\x01\x02");
    let local = find_all(&bytes, b"PK\x03\x04");
    let mut enc = bytes.clone();
    enc[central[1] + 8] |= 1;
    enc[local[1] + 6] |= 1;
    let w = TempDir::new().expect("tmp");
    fs::write(w.path().join("a.zip"), enc).expect("write");
    expect_problem(&w.path().join("a.zip"), ArchiveProblem::EncryptedEntry);
    let mut method = bytes;
    method[central[1] + 10..central[1] + 12].copy_from_slice(&12u16.to_le_bytes());
    method[local[1] + 8..local[1] + 10].copy_from_slice(&12u16.to_le_bytes());
    let w = TempDir::new().expect("tmp");
    fs::write(w.path().join("a.zip"), method).expect("write");
    expect_problem(
        &w.path().join("a.zip"),
        ArchiveProblem::UnsupportedCompression,
    );
}

#[test]
fn declared_size_different_from_the_data_is_refused() {
    // Deflated database whose declared (and listed) size is wrong in both directions.
    for delta in [-5i64, 5] {
        let dir = TempDir::new().expect("tmp");
        let db = db_bytes(3, "");
        let declared = (db.len() as i64 + delta) as u32;
        let good = archive(dir.path(), &db, &[], 3, |m| {
            m.files[0].size = u64::from(declared);
        });
        let mut bytes = fs::read(&good).expect("read");
        let central = find_all(&bytes, b"PK\x01\x02")[0];
        let local = find_all(&bytes, b"PK\x03\x04")[0];
        bytes[central + 24..central + 28].copy_from_slice(&declared.to_le_bytes());
        bytes[local + 22..local + 26].copy_from_slice(&declared.to_le_bytes());
        fs::write(&good, bytes).expect("write");
        let wanted = if delta < 0 {
            ArchiveProblem::CorruptEntry
        } else {
            ArchiveProblem::SizeMismatch
        };
        assert_eq!(refused(&good), wanted, "{delta}");
    }
}

#[test]
fn manifest_errors() {
    let db = db_bytes(3, "");
    let image = [(image_name(), PNG.to_vec())];
    let case = |tweak: &dyn Fn(&mut Manifest), with_image: bool| {
        let dir = TempDir::new().expect("tmp");
        let images: &[(String, Vec<u8>)] = if with_image { &image } else { &[] };
        let path = archive(dir.path(), &db, images, 3, |m| tweak(m));
        (dir, refused(&path))
    };
    assert_eq!(
        case(&|m| m.format_version = 2, false).1,
        ArchiveProblem::UnsupportedFormat
    );
    assert_eq!(
        case(&|m| m.files[0].sha256 = "0".repeat(64), false).1,
        ArchiveProblem::ChecksumMismatch
    );
    assert_eq!(
        case(&|m| m.files[1].sha256 = "0".repeat(64), true).1,
        ArchiveProblem::ChecksumMismatch
    );
    assert_eq!(
        case(&|m| m.files[0].size += 1, false).1,
        ArchiveProblem::ManifestMismatch
    );
    assert_eq!(
        case(
            &|m| m.files.push(ManifestFile {
                path: format!("images/{UUID}.png"),
                size: 1,
                sha256: "0".repeat(64)
            }),
            false
        )
        .1,
        ArchiveProblem::ManifestMismatch
    );
    assert_eq!(
        case(
            &|m| {
                m.files.pop();
            },
            true
        )
        .1,
        ArchiveProblem::ManifestMismatch
    );

    // Raw manifests: absent, invalid, unknown field.
    let raw = |entries: &[(&str, &[u8])]| {
        let dir = TempDir::new().expect("tmp");
        let path = dir.path().join("a.zip");
        write_zip(&path, entries);
        (refused(&path), dir)
    };
    assert_eq!(
        raw(&[("homebase.db", &db)]).0,
        ArchiveProblem::MissingManifest
    );
    assert_eq!(
        raw(&[("manifest.json", b"{}")]).0,
        ArchiveProblem::MissingDatabase
    );
    assert_eq!(
        raw(&[("homebase.db", &db), ("manifest.json", b"not json")]).0,
        ArchiveProblem::InvalidManifest
    );
    let mut value = serde_json::to_value(manifest_for(&db, &[], 3)).expect("value");
    value["extra"] = serde_json::json!(1);
    let json = serde_json::to_vec(&value).expect("json");
    assert_eq!(
        raw(&[("homebase.db", &db), ("manifest.json", &json)]).0,
        ArchiveProblem::InvalidManifest
    );
}

#[test]
fn image_content_must_match_its_extension() {
    let db = db_bytes(3, "");
    // A .png holding text.
    let dir = TempDir::new().expect("tmp");
    let text = [(image_name(), b"hello, not a png at all".to_vec())];
    let path = archive(dir.path(), &db, &text, 3, |_| {});
    expect_problem(&path, ArchiveProblem::ImageTypeMismatch);
    // A .jpg holding a PNG, and a .png holding a JPEG.
    for (name, data) in [
        (format!("{UUID}.jpg"), PNG.to_vec()),
        (
            format!("{UUID}.png"),
            vec![0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0],
        ),
        (format!("{UUID}.webp"), PNG.to_vec()),
        (format!("{UUID}.gif"), b"GIF8".to_vec()),
    ] {
        let dir = TempDir::new().expect("tmp");
        let path = archive(dir.path(), &db, &[(name.clone(), data)], 3, |_| {});
        assert_eq!(refused(&path), ArchiveProblem::ImageTypeMismatch, "{name}");
    }
    // Matching signatures are accepted.
    let dir = TempDir::new().expect("tmp");
    let ok = [
        (format!("{UUID}.jpeg"), vec![0xFF, 0xD8, 0xFF, 0xE0, 1]),
        (
            "4a1d3b6f-9a1c-4d66-8b54-1e3b2e7d0c22.gif".to_owned(),
            b"GIF89a....".to_vec(),
        ),
    ];
    let path = archive(dir.path(), &db, &ok, 3, |_| {});
    try_extract(&path).expect("accepted");
}

#[test]
fn not_a_sqlite_database() {
    let dir = TempDir::new().expect("tmp");
    let path = archive(dir.path(), &[b'x'; 5000], &[], 3, |_| {});
    expect_problem(&path, ArchiveProblem::NotSqlite);
}

#[test]
fn inspection_order_and_migration_table() {
    let cases: [(&str, &str, ArchiveProblem); 11] = [
        ("empty file", "", ArchiveProblem::NotHomebase),
        (
            "no migrations table",
            "DROP TABLE _sqlx_migrations",
            ArchiveProblem::NotHomebase,
        ),
        (
            "view",
            "DROP TABLE _sqlx_migrations; CREATE VIEW _sqlx_migrations AS SELECT 1 AS version",
            ArchiveProblem::UnexpectedSchema,
        ),
        (
            "virtual table",
            "DROP TABLE _sqlx_migrations; CREATE VIRTUAL TABLE _sqlx_migrations USING fts5(a)",
            ArchiveProblem::UnexpectedSchema,
        ),
        (
            "extra column",
            "ALTER TABLE _sqlx_migrations ADD COLUMN extra TEXT",
            ArchiveProblem::UnexpectedSchema,
        ),
        (
            "generated column",
            "ALTER TABLE _sqlx_migrations ADD COLUMN g INTEGER GENERATED ALWAYS AS (1) VIRTUAL",
            ArchiveProblem::UnexpectedSchema,
        ),
        (
            "dirty",
            "UPDATE _sqlx_migrations SET success = 0 WHERE version = 3",
            ArchiveProblem::DirtyMigration,
        ),
        (
            "gap",
            "DELETE FROM _sqlx_migrations WHERE version = 2",
            ArchiveProblem::UnknownMigration,
        ),
        (
            "empty history",
            "DELETE FROM _sqlx_migrations",
            ArchiveProblem::UnknownMigration,
        ),
        (
            "checksum",
            "UPDATE _sqlx_migrations SET checksum = X'00' WHERE version = 2",
            ArchiveProblem::UnknownMigration,
        ),
        (
            "foreign key",
            "INSERT INTO widget_instances (id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h, config, config_version, created_at, updated_at) VALUES ('3f0c2a5e-8f0b-4c55-9a43-0d2a1d6c9b99', '3f0c2a5e-8f0b-4c55-9a43-0d2a1d6c9b00', 'notes', 0, 0, 1, 1, '{}', 1, '2026-10-21T08:15:00.123Z', '2026-10-21T08:15:00.123Z')",
            ArchiveProblem::ForeignKeyViolation,
        ),
    ];
    for (label, sql, wanted) in cases {
        let dir = TempDir::new().expect("tmp");
        let db = if label == "empty file" {
            Vec::new()
        } else {
            db_bytes(3, sql)
        };
        let path = archive(dir.path(), &db, &[], 3, |_| {});
        assert_eq!(refused(&path), wanted, "{label}");
    }
}

#[test]
fn contiguous_history_beyond_the_supported_version_is_schema_too_new() {
    let dir = TempDir::new().expect("tmp");
    let path = db_archive(
        &dir,
        3,
        "WITH RECURSIVE n(i) AS (SELECT 4 UNION ALL SELECT i + 1 FROM n WHERE i < 99) INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) SELECT i, 'x', 1, X'00', 0 FROM n",
    );
    assert_eq!(
        try_extract(&path).expect_err("refused"),
        BackupError::SchemaTooNew {
            archive: 99,
            supported: 6
        }
    );
    // A schema that also differs from ours stays "too new" (R4).
    let dir = TempDir::new().expect("tmp");
    let path = db_archive(
        &dir,
        6,
        "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) VALUES (7, 'x', 1, X'00', 0); CREATE TABLE future (a)",
    );
    assert!(matches!(
        try_extract(&path).expect_err("refused"),
        BackupError::SchemaTooNew { archive: 7, .. }
    ));
}

#[test]
fn non_contiguous_history_is_an_unknown_migration() {
    let dir = TempDir::new().expect("tmp");
    let path = db_archive(
        &dir,
        3,
        "UPDATE _sqlx_migrations SET version = 99 WHERE version = 3",
    );
    expect_problem(&path, ArchiveProblem::UnknownMigration);
}

const MIGRATION_COLUMNS: &str = "version BIGINT PRIMARY KEY, description TEXT NOT NULL, installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, success BOOLEAN NOT NULL, checksum BLOB NOT NULL, execution_time BIGINT NOT NULL";

/// Rebuilds `_sqlx_migrations` from `columns`, keeping its rows.
fn rebuild_migrations(columns: &str) -> String {
    format!("ALTER TABLE _sqlx_migrations RENAME TO old_m; CREATE TABLE _sqlx_migrations ({columns}); INSERT INTO _sqlx_migrations SELECT * FROM old_m; DROP TABLE old_m;")
}

const WRITABLE: &str = "PRAGMA writable_schema = ON; ";

#[test]
fn schema_differences_are_refused() {
    let blob = |table: &str| {
        format!("{WRITABLE}UPDATE sqlite_schema SET sql = CAST(sql AS BLOB) WHERE name = '{table}'; PRAGMA writable_schema = OFF")
    };
    let renamed = |table: &str| {
        format!("CREATE TRIGGER evil AFTER INSERT ON {table} BEGIN SELECT 1; END; {WRITABLE}UPDATE sqlite_schema SET name = 'sqlite_evil', sql = replace(sql, 'TRIGGER evil', 'TRIGGER sqlite_evil') WHERE type = 'trigger'; PRAGMA writable_schema = OFF")
    };
    let cases: Vec<(&str, String)> = vec![
        (
            "trigger",
            "CREATE TRIGGER evil AFTER INSERT ON settings BEGIN SELECT 1; END".into(),
        ),
        ("view", "CREATE VIEW v AS SELECT 1 AS a".into()),
        ("index", "CREATE INDEX extra_idx ON settings (value)".into()),
        ("table", "CREATE TABLE extra (a)".into()),
        ("trigger sqlite_evil on settings", renamed("settings")),
        (
            "trigger sqlite_evil on _sqlx_migrations",
            renamed("_sqlx_migrations"),
        ),
        (
            "sqlite_stat1 with another SQL",
            format!("ANALYZE; {WRITABLE}UPDATE sqlite_schema SET sql = 'CREATE TABLE sqlite_stat1(tbl,idx,stat,x)' WHERE name = 'sqlite_stat1'; PRAGMA writable_schema = OFF"),
        ),
        ("sql of settings as a BLOB", blob("settings")),
        ("sql of _sqlx_migrations as a BLOB", blob("_sqlx_migrations")),
        (
            "CHECK on _sqlx_migrations",
            rebuild_migrations(&MIGRATION_COLUMNS.replace("PRIMARY KEY", "PRIMARY KEY CHECK (version <= 3)")),
        ),
        (
            "DEFAULT on _sqlx_migrations",
            rebuild_migrations(&MIGRATION_COLUMNS.replace("execution_time BIGINT NOT NULL", "execution_time BIGINT NOT NULL DEFAULT (random())")),
        ),
        (
            "ON CONFLICT and COLLATE on _sqlx_migrations",
            rebuild_migrations(&MIGRATION_COLUMNS.replace("PRIMARY KEY", "PRIMARY KEY ON CONFLICT REPLACE").replace("description TEXT NOT NULL", "description TEXT NOT NULL COLLATE NOCASE")),
        ),
        (
            "PRIMARY KEY DESC on _sqlx_migrations",
            rebuild_migrations(&MIGRATION_COLUMNS.replace("version BIGINT PRIMARY KEY", "version BIGINT").replace("execution_time BIGINT NOT NULL", "execution_time BIGINT NOT NULL, PRIMARY KEY (version DESC)")),
        ),
        (
            "REFERENCES on _sqlx_migrations",
            rebuild_migrations(&MIGRATION_COLUMNS.replace("description TEXT NOT NULL", "description TEXT NOT NULL REFERENCES dashboards (id) ON DELETE CASCADE")),
        ),
    ];
    for (label, sql) in &cases {
        let dir = TempDir::new().expect("tmp");
        let path = db_archive(&dir, 3, sql);
        assert_eq!(refused(&path), ArchiveProblem::UnexpectedSchema, "{label}");
    }
}

#[test]
fn trigger_renamed_without_changing_its_sql_is_a_malformed_schema() {
    let dir = TempDir::new().expect("tmp");
    let path = db_archive(
        &dir,
        3,
        &format!("CREATE TRIGGER evil AFTER INSERT ON settings BEGIN SELECT 1; END; {WRITABLE}UPDATE sqlite_schema SET name = 'sqlite_evil' WHERE type = 'trigger'; PRAGMA writable_schema = OFF"),
    );
    expect_problem(&path, ArchiveProblem::IntegrityFailed);
}

/// `(page size, root page of settings)` of a database image.
fn settings_page(db: &[u8]) -> (usize, usize) {
    let dir = TempDir::new().expect("tmp");
    let path = dir.path().join("p.db");
    fs::write(&path, db).expect("write");
    let root: i64 = run(async {
        let options = SqliteConnectOptions::new().filename(&path).read_only(true);
        let mut conn = SqliteConnection::connect_with(&options)
            .await
            .expect("open");
        let row: (i64,) =
            sqlx::query_as("SELECT rootpage FROM sqlite_schema WHERE name = 'settings'")
                .fetch_one(&mut conn)
                .await
                .expect("rootpage");
        conn.close().await.expect("close");
        row.0
    });
    let raw = u16::from_be_bytes([db[16], db[17]]);
    let page_size = if raw == 1 { 65_536 } else { usize::from(raw) };
    assert!(root > 1, "settings must not be on page 1");
    (page_size, root as usize)
}

#[test]
fn real_page_corruption_fails_the_integrity_check() {
    // (a) A key byte of the table leaf only: the index no longer matches the row.
    let mut db = db_bytes(3, "");
    let (page_size, root) = settings_page(&db);
    let leaf = (root - 1) * page_size..root * page_size;
    let at = find_all(&db[leaf.clone()], b"theme");
    assert_eq!(at.len(), 1, "key present once in the table leaf");
    db[leaf.start + at[0]] ^= 0x01;
    let dir = TempDir::new().expect("tmp");
    let path = archive(dir.path(), &db, &[], 3, |_| {});
    expect_problem(&path, ArchiveProblem::IntegrityFailed);

    // (b) Impossible cell count in the leaf header.
    let mut db = db_bytes(3, "");
    let start = (root - 1) * page_size;
    db[start + 3..start + 5].copy_from_slice(&9u16.to_be_bytes());
    let dir = TempDir::new().expect("tmp");
    let path = archive(dir.path(), &db, &[], 3, |_| {});
    expect_problem(&path, ArchiveProblem::IntegrityFailed);
}

#[test]
fn exact_sqlite_stat1_is_tolerated() {
    let dir = TempDir::new().expect("tmp");
    let path = db_archive(&dir, 3, "ANALYZE");
    try_extract(&path).expect("accepted");
}

#[test]
fn v1_only_database_is_accepted_with_version_1() {
    let dir = TempDir::new().expect("tmp");
    let path = db_archive(&dir, 1, "");
    let manifest = try_extract(&path).expect("accepted");
    assert_eq!(manifest.schema_version, 1);
    let ok = run(inspect_restored_database(
        &dir.path().join("dest").join("homebase.db"),
        &manifest,
    ))
    .expect("inspect");
    assert_eq!(ok, 1);
}

#[test]
fn manifest_schema_version_must_match_the_database() {
    let dir = TempDir::new().expect("tmp");
    let path = archive(dir.path(), &db_bytes(3, ""), &[], 3, |m| {
        m.schema_version = 2
    });
    expect_problem(&path, ArchiveProblem::ManifestMismatch);
}

#[test]
fn expected_schema_of_version_3_matches_a_real_database() {
    let dir = TempDir::new().expect("tmp");
    let path = dir.path().join("homebase.db");
    make_database(&path, 3, false);
    let actual = run(async {
        let options = SqliteConnectOptions::new().filename(&path).read_only(true);
        let mut conn = SqliteConnection::connect_with(&options)
            .await
            .expect("open");
        let rows =
            sqlx::query("SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name")
                .fetch_all(&mut conn)
                .await
                .expect("rows");
        conn.close().await.expect("close");
        rows
    });
    use sqlx::Row;
    let actual: Vec<SchemaRow> = actual
        .iter()
        .map(|r| (r.get(0), r.get(1), r.get(2), r.get(3)))
        .collect();
    let expected = run(expected_schema(3)).expect("expected");
    assert_eq!(actual, expected);
    let names: Vec<&str> = expected.iter().map(|r| r.1.as_str()).collect();
    for wanted in [
        "dashboards",
        "todos",
        "notes",
        "shortcuts",
        "widget_instances",
    ] {
        assert!(names.contains(&wanted), "{wanted}");
    }
    assert!(names.iter().any(|n| n.starts_with("sqlite_autoindex_")));
    assert!(run(expected_schema(1)).expect("v1").len() < expected.len());
}

/// `sqlite_schema` of the database at `path`, read-only.
fn schema_of(path: &Path) -> Vec<SchemaRow> {
    use sqlx::Row;
    run(async {
        let options = SqliteConnectOptions::new().filename(path).read_only(true);
        let mut conn = SqliteConnection::connect_with(&options)
            .await
            .expect("open");
        let rows =
            sqlx::query("SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name")
                .fetch_all(&mut conn)
                .await
                .expect("rows");
        conn.close().await.expect("close");
        rows.iter()
            .map(|r| (r.get(0), r.get(1), r.get(2), r.get(3)))
            .collect()
    })
}

/// One text column of the first `dashboards` row.
fn dashboard_value(path: &Path, column: &str) -> String {
    use sqlx::Row;
    run(async {
        let options = SqliteConnectOptions::new().filename(path).read_only(true);
        let mut conn = SqliteConnection::connect_with(&options)
            .await
            .expect("open");
        let sql = format!("SELECT {column} FROM dashboards ORDER BY id LIMIT 1");
        let row = sqlx::query(&sql).fetch_one(&mut conn).await.expect("row");
        conn.close().await.expect("close");
        row.get(0)
    })
}

#[test]
fn expected_schema_of_version_4_matches_a_real_database() {
    let dir = TempDir::new().expect("tmp");
    let path = dir.path().join("homebase.db");
    make_database(&path, 4, false);
    let expected = run(expected_schema(4)).expect("expected");
    assert_eq!(schema_of(&path), expected);
    let dashboards = expected
        .iter()
        .find(|r| r.1 == "dashboards")
        .and_then(|r| r.3.clone())
        .expect("dashboards sql");
    // Frozen text: SQLite rewrites the CREATE TABLE on ADD COLUMN (column appended before the
    // closing parenthesis). A change in the bundled SQLite would turn this red.
    let frozen = "CREATE TABLE dashboards (
  id          TEXT    NOT NULL PRIMARY KEY
              CHECK (length(id) = 36 AND id NOT GLOB '*[^0-9a-f-]*'),
  name        TEXT    NOT NULL
              CHECK (length(trim(name)) >= 1 AND length(name) <= 100),
  sort_order  INTEGER NOT NULL CHECK (sort_order >= 0),
  created_at  TEXT    NOT NULL
              CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at  TEXT    NOT NULL
              CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
, icon TEXT NOT NULL DEFAULT 'th-large'
  CHECK (length(icon) BETWEEN 1 AND 32
         AND icon GLOB '[a-z]*'
         AND icon NOT GLOB '*[^a-z0-9-]*')) STRICT";
    assert_eq!(dashboards, frozen);

    assert_ne!(expected, run(expected_schema(3)).expect("v3"));
}

/// One integer column of the first `dashboards` row.
fn dashboard_int(path: &Path, column: &str) -> i64 {
    use sqlx::Row;
    run(async {
        let options = SqliteConnectOptions::new().filename(path).read_only(true);
        let mut conn = SqliteConnection::connect_with(&options)
            .await
            .expect("open");
        let sql = format!("SELECT {column} FROM dashboards ORDER BY id LIMIT 1");
        let row = sqlx::query(&sql).fetch_one(&mut conn).await.expect("row");
        conn.close().await.expect("close");
        row.get(0)
    })
}

/// Applies the remaining migrations with the real sqlx migrator (the path of a real database).
fn migrate_for_real(path: &Path) {
    run(async {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .journal_mode(SqliteJournalMode::Wal);
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .expect("open");
        super::test_support::migrate_with_real_migrator(&pool).await;
        pool.close().await;
    });
}

#[test]
fn expected_schema_of_version_5_matches_a_real_database() {
    let dir = TempDir::new().expect("tmp");
    let path = dir.path().join("homebase.db");
    make_database(&path, 5, false);
    let expected = run(expected_schema(5)).expect("expected");
    assert_eq!(schema_of(&path), expected);
    let dashboards = expected
        .iter()
        .find(|r| r.1 == "dashboards")
        .and_then(|r| r.3.clone())
        .expect("dashboards sql");
    // Frozen text (see the V4 test): the two ADD COLUMN of V5 are appended before the closing
    // parenthesis, each after the previous column.
    let frozen = "CREATE TABLE dashboards (
  id          TEXT    NOT NULL PRIMARY KEY
              CHECK (length(id) = 36 AND id NOT GLOB '*[^0-9a-f-]*'),
  name        TEXT    NOT NULL
              CHECK (length(trim(name)) >= 1 AND length(name) <= 100),
  sort_order  INTEGER NOT NULL CHECK (sort_order >= 0),
  created_at  TEXT    NOT NULL
              CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at  TEXT    NOT NULL
              CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
, icon TEXT NOT NULL DEFAULT 'th-large'
  CHECK (length(icon) BETWEEN 1 AND 32
         AND icon GLOB '[a-z]*'
         AND icon NOT GLOB '*[^a-z0-9-]*'), theme TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(theme) AND json_type(theme) = 'object' AND length(theme) <= 4096), theme_version INTEGER NOT NULL DEFAULT 1
  CHECK (theme_version >= 1)) STRICT";
    assert_eq!(dashboards, frozen);

    assert_ne!(expected, run(expected_schema(4)).expect("v4"));
}

#[test]
fn v3_database_migrated_to_the_supported_version_has_its_schema_and_defaults() {
    let dir = TempDir::new().expect("tmp");
    let path = dir.path().join("homebase.db");
    make_database(&path, 3, true);
    assert_eq!(
        schema_of(&path),
        run(expected_schema(3)).expect("expected v3")
    );
    migrate_for_real(&path);
    assert_eq!(dashboard_value(&path, "icon"), "th-large");
    assert_eq!(dashboard_value(&path, "theme"), "{}");
    assert_eq!(dashboard_int(&path, "theme_version"), 1);
    assert_eq!(
        dashboard_value(&path, "updated_at"),
        "2026-10-21T08:15:00.123Z"
    );
    // ALTER TABLE ADD COLUMN rewrites the CREATE TABLE text, so compare to a fresh database at the
    // supported version, not to the v3 text.
    let fresh = dir.path().join("fresh.db");
    make_database(&fresh, supported_schema_version(), false);
    assert_eq!(schema_of(&path), schema_of(&fresh));
    assert_eq!(
        schema_of(&path),
        run(expected_schema(supported_schema_version())).expect("expected supported")
    );
}

#[test]
fn v4_database_migrated_to_the_supported_version_keeps_the_icon_and_gets_the_default_theme() {
    let dir = TempDir::new().expect("tmp");
    let path = dir.path().join("homebase.db");
    make_database(&path, 4, true);
    run(async {
        let options = SqliteConnectOptions::new().filename(&path);
        let mut conn = SqliteConnection::connect_with(&options)
            .await
            .expect("open");
        sqlx::query("UPDATE dashboards SET icon = 'briefcase'")
            .execute(&mut conn)
            .await
            .expect("icon");
        conn.close().await.expect("close");
    });
    migrate_for_real(&path);
    assert_eq!(dashboard_value(&path, "icon"), "briefcase");
    assert_eq!(dashboard_value(&path, "theme"), "{}");
    assert_eq!(dashboard_int(&path, "theme_version"), 1);
    assert_eq!(
        dashboard_value(&path, "updated_at"),
        "2026-10-21T08:15:00.123Z"
    );
    assert_eq!(
        schema_of(&path),
        run(expected_schema(supported_schema_version())).expect("supported")
    );
}

const TODO_ID: &str = "a0000000-0000-4000-8000-000000000003";
const TODO_AT: &str = "2026-10-21T08:15:00.123Z";

/// Frozen tail of `CREATE TABLE todos` before and after V6 (spec todo-details 4.1, S2).
const TODOS_TAIL_V5: &str = "  updated_at  TEXT    NOT NULL
              CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
) STRICT";
const TODOS_TAIL_V6: &str = "  updated_at  TEXT    NOT NULL
              CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
, description TEXT NOT NULL DEFAULT ''
  CHECK (length(description) <= 10000 AND length(CAST(description AS BLOB)) <= 40000), rrule TEXT NULL
  CHECK (rrule IS NULL OR (length(rrule) BETWEEN 10 AND 256 AND rrule GLOB 'FREQ=*'
         AND due_on IS NOT NULL)), important INTEGER NOT NULL DEFAULT 0
  CHECK (important IN (0, 1))) STRICT";

/// Inserts an instance, a list and one todo (due date, completed) on the first dashboard,
/// using only the columns that exist since V3.
async fn seed_todo(conn: &mut SqliteConnection) {
    for sql in [
        "INSERT INTO widget_instances (id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h, config, config_version, created_at, updated_at) SELECT 'a0000000-0000-4000-8000-000000000001', id, 'todo', 0, 0, 3, 3, '{}', 1, '2026-10-21T08:15:00.123Z', '2026-10-21T08:15:00.123Z' FROM dashboards LIMIT 1",
        "INSERT INTO todo_lists (id, widget_instance_id, name, created_at, updated_at) VALUES ('a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'L', '2026-10-21T08:15:00.123Z', '2026-10-21T08:15:00.123Z')",
        "INSERT INTO todos (id, list_id, title, due_on, completed_at, sort_order, created_at, updated_at) VALUES ('a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002', 'x', '2026-11-02', '2026-10-30T10:00:00.000Z', 0, '2026-10-21T08:15:00.123Z', '2026-10-21T08:15:00.123Z')",
    ] {
        sqlx::query(sql).execute(&mut *conn).await.expect("seed");
    }
}

/// Sets the V6 columns of the seeded todo (database already at V6).
async fn set_v6_columns(conn: &mut SqliteConnection) {
    sqlx::query("UPDATE todos SET description = 'Détails' || char(10) || 'de la tâche', rrule = 'FREQ=WEEKLY', important = 1 WHERE id = ?1")
        .bind(TODO_ID)
        .execute(&mut *conn)
        .await
        .expect("v6 columns");
}

/// One column of the seeded todo as text (NULL -> None), read-only.
fn todo_value(path: &Path, column: &str) -> Option<String> {
    use sqlx::Row;
    run(async {
        let options = SqliteConnectOptions::new().filename(path).read_only(true);
        let mut conn = SqliteConnection::connect_with(&options)
            .await
            .expect("open");
        let sql = format!("SELECT CAST({column} AS TEXT) FROM todos WHERE id = ?1");
        let row = sqlx::query(&sql)
            .bind(TODO_ID)
            .fetch_one(&mut conn)
            .await
            .expect("row");
        conn.close().await.expect("close");
        row.get(0)
    })
}

fn todos_sql(rows: &[SchemaRow]) -> String {
    rows.iter()
        .find(|r| r.1 == "todos")
        .and_then(|r| r.3.clone())
        .expect("todos sql")
}

#[test]
fn expected_schema_of_version_6_matches_a_real_database() {
    let dir = TempDir::new().expect("tmp");
    let path = dir.path().join("homebase.db");
    make_database(&path, 6, false);
    let expected = run(expected_schema(6)).expect("expected");
    assert_eq!(schema_of(&path), expected);
    let v5 = run(expected_schema(5)).expect("v5");
    // Frozen text: the three ADD COLUMN of V6 are appended before the closing parenthesis, each
    // after the previous column; the text before the tail is the one of V3.
    let before = todos_sql(&v5);
    assert!(before.ends_with(TODOS_TAIL_V5));
    let frozen = format!(
        "{}{}",
        &before[..before.len() - TODOS_TAIL_V5.len()],
        TODOS_TAIL_V6
    );
    assert_eq!(todos_sql(&expected), frozen);
    assert_ne!(expected, v5);
}

#[test]
fn v5_database_migrated_to_v6_keeps_todos_and_gets_defaults() {
    let dir = TempDir::new().expect("tmp");
    let path = dir.path().join("homebase.db");
    make_database(&path, 5, true);
    run(async {
        let options = SqliteConnectOptions::new().filename(&path);
        let mut conn = SqliteConnection::connect_with(&options)
            .await
            .expect("open");
        seed_todo(&mut conn).await;
        conn.close().await.expect("close");
    });
    migrate_for_real(&path);
    assert_eq!(todo_value(&path, "description").as_deref(), Some(""));
    assert_eq!(todo_value(&path, "rrule"), None);
    assert_eq!(todo_value(&path, "important").as_deref(), Some("0"));
    assert_eq!(todo_value(&path, "due_on").as_deref(), Some("2026-11-02"));
    assert_eq!(
        todo_value(&path, "completed_at").as_deref(),
        Some("2026-10-30T10:00:00.000Z")
    );
    assert_eq!(todo_value(&path, "updated_at").as_deref(), Some(TODO_AT));
    assert_eq!(schema_of(&path), run(expected_schema(6)).expect("v6"));
}

#[test]
fn v3_database_with_a_todo_migrated_for_real_gets_the_v6_defaults() {
    let dir = TempDir::new().expect("tmp");
    let path = dir.path().join("homebase.db");
    make_database(&path, 3, true);
    run(async {
        let options = SqliteConnectOptions::new().filename(&path);
        let mut conn = SqliteConnection::connect_with(&options)
            .await
            .expect("open");
        seed_todo(&mut conn).await;
        conn.close().await.expect("close");
    });
    migrate_for_real(&path);
    assert_eq!(todo_value(&path, "description").as_deref(), Some(""));
    assert_eq!(todo_value(&path, "rrule"), None);
    assert_eq!(todo_value(&path, "important").as_deref(), Some("0"));
    assert_eq!(todo_value(&path, "updated_at").as_deref(), Some(TODO_AT));
    assert_eq!(
        schema_of(&path),
        run(expected_schema(supported_schema_version())).expect("supported")
    );
}

#[test]
fn archive_of_version_5_is_still_accepted() {
    let dir = TempDir::new().expect("tmp");
    let path = db_archive(&dir, 5, "");
    let dest = dir.path().join("dest");
    let manifest = run(extract_validated(&path, &dest)).expect("accepted");
    assert_eq!(manifest.schema_version, 5);
    assert!(supported_schema_version() > 5);
}

#[test]
fn archive_of_version_3_is_still_accepted() {
    let dir = TempDir::new().expect("tmp");
    let path = db_archive(&dir, 3, "");
    let dest = dir.path().join("dest");
    let manifest = run(extract_validated(&path, &dest)).expect("accepted");
    assert_eq!(manifest.schema_version, 3);
    assert!(supported_schema_version() > 3);
}

#[test]
fn archive_of_version_4_is_still_accepted() {
    let dir = TempDir::new().expect("tmp");
    let path = db_archive(&dir, 4, "");
    let dest = dir.path().join("dest");
    let manifest = run(extract_validated(&path, &dest)).expect("accepted");
    assert_eq!(manifest.schema_version, 4);
    assert!(supported_schema_version() > 4);
}

#[test]
fn archive_at_the_supported_version_made_by_the_real_migrator_is_accepted() {
    let dir = TempDir::new().expect("tmp");
    let root = DataRoot::new(dir.path().join("data"));
    fs::create_dir_all(root.images()).expect("images");
    make_database_with_migrator(&root.db(), true);
    run(async {
        let options = SqliteConnectOptions::new().filename(root.db());
        let mut conn = SqliteConnection::connect_with(&options)
            .await
            .expect("open");
        sqlx::query("UPDATE dashboards SET icon = 'briefcase', theme = '{\"cardBody\":\"rose\",\"cardHeader\":\"default\"}'")
            .execute(&mut conn)
            .await
            .expect("icon");
        seed_todo(&mut conn).await;
        set_v6_columns(&mut conn).await;
        conn.close().await.expect("close");
    });
    let clock = FixedClock::new(parse_instant("2026-10-21T08:15:00.123Z").expect("instant"));
    let info = run(create_backup(&root, &clock, BackupKind::Manual, &[])).expect("create");
    let archive = root.backups().join(&info.id);

    let dest = dir.path().join("restored");
    let manifest = run(extract_validated(&archive, &dest)).expect("accepted");
    assert_eq!(manifest.schema_version, supported_schema_version());
    let restored = dest.join("homebase.db");
    assert_eq!(
        todo_value(&restored, "description").as_deref(),
        Some("Détails\nde la tâche")
    );
    assert_eq!(
        todo_value(&restored, "rrule").as_deref(),
        Some("FREQ=WEEKLY")
    );
    assert_eq!(todo_value(&restored, "important").as_deref(), Some("1"));
    assert_eq!(
        dashboard_value(&dest.join("homebase.db"), "icon"),
        "briefcase"
    );
    assert_eq!(
        dashboard_value(&dest.join("homebase.db"), "theme"),
        "{\"cardBody\":\"rose\",\"cardHeader\":\"default\"}"
    );
    assert_eq!(dashboard_int(&dest.join("homebase.db"), "theme_version"), 1);
}
