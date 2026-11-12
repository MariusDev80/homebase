//! Backup creation (spec 4.4): snapshot, archive in `.partial`, atomic rename, retention.

use super::archive::{inventory_images, write_archive, ArchiveSpec, Limits};
use super::error::BackupError;
use super::fsutil::{remove_with_retry, rename_with_retry};
use super::list::BackupInfo;
use super::names::{BackupKind, BackupName};
use super::paths::DataRoot;
use super::retention::apply_retention;
use super::sqlite::{read_schema_version, snapshot_into};
use crate::time::clock::Clock;
use crate::time::formats::format_instant;
use std::fs;
use std::io;
use std::path::PathBuf;
use std::sync::Arc;

/// Runs blocking work on the blocking pool. Required for anything that can sleep (spec 4.1).
pub async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, BackupError> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| BackupError::Io {
            code: "join".into(),
        })
}

/// Test seams: limits and a fault injected right before the final rename.
#[derive(Clone, Default)]
pub struct CreateOptions {
    pub limits: Limits,
    pub before_rename: Option<Arc<dyn Fn() -> io::Result<()> + Send + Sync>>,
}

/// Removes the temporary files on every exit path. Plain `remove_file`: it also runs in async code.
struct TmpGuard {
    paths: Vec<PathBuf>,
}

impl Drop for TmpGuard {
    fn drop(&mut self) {
        for path in &self.paths {
            let _ = fs::remove_file(path);
        }
    }
}

/// The caller holds the lock (`BackupState::try_acquire`).
pub async fn create_backup(
    root: &DataRoot,
    clock: &dyn Clock,
    kind: BackupKind,
    protect: &[&str],
) -> Result<BackupInfo, BackupError> {
    create_backup_with(root, clock, kind, protect, CreateOptions::default()).await
}

pub async fn create_backup_with(
    root: &DataRoot,
    clock: &dyn Clock,
    kind: BackupKind,
    protect: &[&str],
    options: CreateOptions,
) -> Result<BackupInfo, BackupError> {
    let db = root.db();
    // 1 and 2. database present, name free, temporary directory ready.
    let name = BackupName::new(clock.now(), kind);
    let file_name = name.file_name();
    let final_path = root.backups().join(&file_name);
    let tmp_dir = root.backups_tmp();
    let base = format!("{}-{}", name.stamp(), kind.as_str());
    let snapshot = tmp_dir.join(format!("{base}.db"));
    let partial = tmp_dir.join(format!("{base}.partial"));
    let guard = TmpGuard {
        paths: vec![snapshot.clone(), partial.clone()],
    };
    {
        let (db, final_path, tmp_dir, snapshot) = (
            db.clone(),
            final_path.clone(),
            tmp_dir.clone(),
            snapshot.clone(),
        );
        blocking(move || -> Result<(), BackupError> {
            if !db.is_file() {
                return Err(BackupError::NoDatabase);
            }
            if final_path.exists() {
                return Err(io::Error::from(io::ErrorKind::AlreadyExists).into());
            }
            fs::create_dir_all(&tmp_dir)?;
            // Reserve the VACUUM target: SQLite accepts an existing empty file.
            fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&snapshot)?;
            Ok(())
        })
        .await??;
    }

    // 3. snapshot
    snapshot_into(&db, &snapshot).await?;
    {
        let snapshot = snapshot.clone();
        let max = options.limits.max_db_bytes;
        let size = blocking(move || fs::metadata(&snapshot).map(|m| m.len())).await??;
        if size > max {
            return Err(BackupError::TooLarge);
        }
    }

    // 4. schema version read from the snapshot
    let Some(schema_version) = read_schema_version(&snapshot).await? else {
        return Err(BackupError::Database {
            code: "no_migrations".into(),
        });
    };

    // 5. everything on files, in a single blocking task
    let root = root.clone();
    let protect: Vec<String> = protect.iter().map(|p| (*p).to_owned()).collect();
    let created_at = format_instant(name.created_at);
    blocking(move || -> Result<BackupInfo, BackupError> {
        let _guard = guard;
        let images = if kind.includes_images() {
            inventory_images(&root.images(), &options.limits)?
        } else {
            Vec::new()
        };
        let spec = ArchiveSpec {
            created_at,
            kind,
            schema_version,
            snapshot: &snapshot,
            images: &images,
        };
        let manifest = write_archive(&partial, &spec, &options.limits)?;
        if let Some(hook) = &options.before_rename {
            hook()?;
        }
        // The lock is held, but never replace an existing archive.
        if final_path.exists() {
            return Err(io::Error::from(io::ErrorKind::AlreadyExists).into());
        }
        rename_with_retry(&partial, &final_path)?;
        // The archive exists from here on: no error may be returned.
        let size_bytes = fs::metadata(&final_path)
            .map(|m| m.len())
            .unwrap_or_else(|e| {
                eprintln!(
                    "backup: cannot read the size of the new archive: {:?}",
                    e.kind()
                );
                0
            });
        if let Err(e) = remove_with_retry(&snapshot) {
            eprintln!("backup: snapshot cleanup failed: {:?}", e.kind());
        }
        let protect: Vec<&str> = protect.iter().map(String::as_str).collect();
        apply_retention(&root, &file_name, &protect);
        Ok(BackupInfo::from_manifest(&name, size_bytes, &manifest))
    })
    .await?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backup::archive::read_manifest;
    use crate::backup::manifest::Manifest;
    use crate::backup::test_support::{make_database, run};
    use crate::time::clock::FixedClock;
    use crate::time::formats::parse_instant;
    use sha2::{Digest, Sha256};
    use std::io::Read;
    use tempfile::TempDir;

    const UUID_A: &str = "3f0c2a5e-8f0b-4c55-9a43-0d2a1d6c9b11";
    const UUID_B: &str = "4a1d3b6f-9a1c-4d66-8b54-1e3b2e7d0c22";
    const PNG: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4, 5,
    ];

    fn clock() -> FixedClock {
        FixedClock::new(parse_instant("2026-10-21T08:15:00.123Z").expect("instant"))
    }

    fn setup() -> (TempDir, DataRoot) {
        let dir = TempDir::new().expect("tmp");
        let root = DataRoot::new(dir.path().to_path_buf());
        make_database(&root.db(), 3, true);
        (dir, root)
    }

    fn add_image(root: &DataRoot, name: &str, bytes: &[u8]) {
        fs::create_dir_all(root.images()).expect("images");
        fs::write(root.images().join(name), bytes).expect("image");
    }

    fn entries(path: &std::path::Path) -> Vec<(String, Vec<u8>)> {
        let mut zip = zip::ZipArchive::new(fs::File::open(path).expect("open")).expect("zip");
        (0..zip.len())
            .map(|i| {
                let mut f = zip.by_index(i).expect("entry");
                let mut data = Vec::new();
                f.read_to_end(&mut data).expect("read");
                (
                    String::from_utf8(f.name_raw().to_vec()).expect("utf-8"),
                    data,
                )
            })
            .collect()
    }

    fn tmp_is_empty(root: &DataRoot) -> bool {
        fs::read_dir(root.backups_tmp()).expect("tmp dir").count() == 0
    }

    #[test]
    fn creates_named_archive_with_manifest_and_hashes() {
        let (_dir, root) = setup();
        add_image(&root, &format!("{UUID_A}.png"), PNG);
        let info = run(create_backup(&root, &clock(), BackupKind::Manual, &[])).expect("create");

        assert_eq!(info.id, "homebase-20261021T081500.123Z-manual.zip");
        assert_eq!(info.created_at, "2026-10-21T08:15:00.123Z");
        assert_eq!(info.kind, BackupKind::Manual);
        assert_eq!(info.schema_version, Some(3));
        assert_eq!(info.includes_images, Some(true));
        assert_eq!(info.image_count, Some(1));
        assert!(!info.damaged);
        let path = root.backups().join(&info.id);
        assert_eq!(info.size_bytes, fs::metadata(&path).expect("meta").len());
        assert!(tmp_is_empty(&root));

        let entries = entries(&path);
        let names: Vec<&str> = entries.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(
            names,
            [
                "homebase.db".to_owned(),
                format!("images/{UUID_A}.png"),
                "manifest.json".to_owned()
            ]
        );
        let manifest: Manifest = serde_json::from_slice(&entries[2].1).expect("manifest");
        assert_eq!(manifest, read_manifest(&path).expect("read_manifest"));
        assert_eq!(manifest.schema_version, 3);
        assert_eq!(manifest.app_version, env!("CARGO_PKG_VERSION"));
        assert_eq!(manifest.files.len(), 2);
        for (file, (_, data)) in manifest.files.iter().zip(&entries) {
            assert_eq!(file.size, data.len() as u64);
            let hex: String = Sha256::digest(data)
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect();
            assert_eq!(file.sha256, hex);
        }
        assert_eq!(entries[1].1, PNG);
        // The database inside is a usable SQLite file.
        assert!(entries[0].1.starts_with(b"SQLite format 3\0"));
    }

    #[test]
    fn archives_are_reproducible_in_structure_dates_fixed() {
        let (_dir, root) = setup();
        run(create_backup(&root, &clock(), BackupKind::Manual, &[])).expect("create");
        let path = root
            .backups()
            .join("homebase-20261021T081500.123Z-manual.zip");
        let mut zip = zip::ZipArchive::new(fs::File::open(path).expect("open")).expect("zip");
        for i in 0..zip.len() {
            let f = zip.by_index(i).expect("entry");
            let t = f.last_modified().expect("date");
            assert_eq!((t.year(), t.month(), t.day()), (1980, 1, 1));
        }
    }

    #[test]
    fn non_conforming_images_are_ignored() {
        let (_dir, root) = setup();
        add_image(&root, &format!("{UUID_A}.png"), PNG);
        add_image(&root, &format!("{UUID_B}.png"), b"this is text, not a png");
        add_image(&root, "not-a-uuid.png", PNG);
        add_image(&root, &format!("{UUID_B}.svg"), b"<svg/>");
        add_image(&root, &format!("{UUID_A}.PNG"), PNG);
        let sub = root.images().join("sub");
        fs::create_dir_all(&sub).expect("sub");
        fs::write(sub.join(format!("{UUID_B}.png")), PNG).expect("nested");
        fs::create_dir_all(root.images().join(format!("{UUID_B}.webp"))).expect("dir");

        let info = run(create_backup(&root, &clock(), BackupKind::Daily, &[])).expect("create");
        assert_eq!(info.image_count, Some(1));
        let names: Vec<String> = entries(&root.backups().join(&info.id))
            .into_iter()
            .map(|(n, _)| n)
            .collect();
        assert_eq!(
            names,
            [
                "homebase.db".to_owned(),
                format!("images/{UUID_A}.png"),
                "manifest.json".to_owned()
            ]
        );
    }

    #[test]
    fn pre_migration_and_pre_import_have_no_images() {
        let (_dir, root) = setup();
        add_image(&root, &format!("{UUID_A}.png"), PNG);
        for (kind, when) in [
            (BackupKind::PreMigration, "2026-10-21T08:15:00.123Z"),
            (BackupKind::PreImport, "2026-10-21T08:16:00.123Z"),
        ] {
            let clock = FixedClock::new(parse_instant(when).expect("instant"));
            let info = run(create_backup(&root, &clock, kind, &[])).expect("create");
            assert_eq!(info.includes_images, Some(false));
            assert_eq!(info.image_count, Some(0));
            let names: Vec<String> = entries(&root.backups().join(&info.id))
                .into_iter()
                .map(|(n, _)| n)
                .collect();
            assert_eq!(names, ["homebase.db", "manifest.json"]);
        }
        // pre-restore is complete.
        let info =
            run(create_backup(&root, &clock(), BackupKind::PreRestore, &[])).expect("create");
        assert_eq!(info.includes_images, Some(true));
        assert_eq!(info.image_count, Some(1));
    }

    #[test]
    fn no_database_creates_nothing() {
        let dir = TempDir::new().expect("tmp");
        let root = DataRoot::new(dir.path().to_path_buf());
        let err = run(create_backup(&root, &clock(), BackupKind::Manual, &[])).expect_err("fail");
        assert_eq!(err, BackupError::NoDatabase);
        assert!(!root.backups().exists());
    }

    #[test]
    fn name_collision_is_an_already_exists_error_and_keeps_the_existing_file() {
        let (_dir, root) = setup();
        let first = run(create_backup(&root, &clock(), BackupKind::Manual, &[])).expect("first");
        let path = root.backups().join(&first.id);
        let before = fs::read(&path).expect("read");
        let err = run(create_backup(&root, &clock(), BackupKind::Manual, &[])).expect_err("second");
        assert_eq!(
            err,
            BackupError::Io {
                code: "AlreadyExists".into()
            }
        );
        assert_eq!(fs::read(&path).expect("read"), before);
    }

    #[test]
    fn fault_before_rename_leaves_no_archive_and_no_temporary_file() {
        let (_dir, root) = setup();
        let options = CreateOptions {
            before_rename: Some(Arc::new(|| Err(io::Error::other("injected")))),
            ..CreateOptions::default()
        };
        let err = run(create_backup_with(
            &root,
            &clock(),
            BackupKind::Manual,
            &[],
            options,
        ))
        .expect_err("fail");
        assert_eq!(
            err,
            BackupError::Io {
                code: "Other".into()
            }
        );
        assert!(tmp_is_empty(&root));
        let archives: Vec<_> = fs::read_dir(root.backups())
            .expect("dir")
            .flatten()
            .filter(|e| e.path().is_file())
            .collect();
        assert!(archives.is_empty());
    }

    #[test]
    fn limits_give_too_large_and_clean_up() {
        let (_dir, root) = setup();
        add_image(&root, &format!("{UUID_A}.png"), PNG);
        let cases = [
            Limits {
                max_db_bytes: 10,
                ..Limits::default()
            },
            Limits {
                max_image_bytes: 4,
                ..Limits::default()
            },
            Limits {
                max_total_uncompressed: 10,
                ..Limits::default()
            },
            Limits {
                max_entries: 2,
                ..Limits::default()
            },
            Limits {
                max_archive_bytes: 10,
                ..Limits::default()
            },
        ];
        for limits in cases {
            let options = CreateOptions {
                limits,
                ..CreateOptions::default()
            };
            let err = run(create_backup_with(
                &root,
                &clock(),
                BackupKind::Manual,
                &[],
                options,
            ))
            .expect_err("too large");
            assert_eq!(err, BackupError::TooLarge, "{limits:?}");
            assert!(tmp_is_empty(&root));
            assert!(!root
                .backups()
                .join("homebase-20261021T081500.123Z-manual.zip")
                .exists());
        }
    }

    #[test]
    fn database_without_migrations_is_refused() {
        let dir = TempDir::new().expect("tmp");
        let root = DataRoot::new(dir.path().to_path_buf());
        run(async {
            use sqlx::{sqlite::SqliteConnectOptions, Connection, SqliteConnection};
            let options = SqliteConnectOptions::new()
                .filename(root.db())
                .create_if_missing(true);
            let mut conn = SqliteConnection::connect_with(&options)
                .await
                .expect("open");
            sqlx::query("CREATE TABLE t (a)")
                .execute(&mut conn)
                .await
                .expect("create");
            conn.close().await.expect("close");
        });
        let err = run(create_backup(&root, &clock(), BackupKind::Manual, &[])).expect_err("fail");
        assert_eq!(
            err,
            BackupError::Database {
                code: "no_migrations".into()
            }
        );
        assert!(tmp_is_empty(&root));
    }

    #[test]
    fn retention_runs_after_creation_and_protect_is_honoured() {
        let (_dir, root) = setup();
        let c = clock();
        let mut ids = Vec::new();
        for _ in 0..12 {
            c.advance(jiff::SignedDuration::from_secs(60));
            ids.push(
                run(create_backup(&root, &c, BackupKind::Manual, &[]))
                    .expect("create")
                    .id,
            );
        }
        let present: Vec<String> = fs::read_dir(root.backups())
            .expect("dir")
            .flatten()
            .filter(|e| e.path().is_file())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(present.len(), 10);
        assert!(!present.contains(&ids[0]) && !present.contains(&ids[1]));

        c.advance(jiff::SignedDuration::from_secs(60));
        let protected = ids[2].as_str();
        run(create_backup(&root, &c, BackupKind::Manual, &[protected])).expect("create");
        assert!(root.backups().join(protected).exists());
    }
}
