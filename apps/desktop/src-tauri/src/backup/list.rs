//! Listing of the archives in `backups\` (spec 4.6) and the DTOs the front receives.

use super::archive::read_manifest;
use super::manifest::Manifest;
use super::names::{BackupKind, BackupName, Pool};
use super::paths::DataRoot;
use super::status::BackupStatus;
use crate::time::formats::format_instant;
use jiff::{SignedDuration, Timestamp};
use serde::Serialize;
use std::fs;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    /// File name of the archive; never a path.
    pub id: String,
    pub kind: BackupKind,
    pub created_at: String,
    pub size_bytes: u64,
    pub includes_images: Option<bool>,
    pub schema_version: Option<i64>,
    pub app_version: Option<String>,
    pub image_count: Option<u32>,
    pub damaged: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupOverview {
    pub backups: Vec<BackupInfo>,
    pub status: BackupStatus,
    pub supported_schema_version: i64,
}

impl BackupInfo {
    pub fn from_manifest(name: &BackupName, size_bytes: u64, manifest: &Manifest) -> Self {
        Self {
            id: name.file_name(),
            kind: name.kind,
            created_at: format_instant(name.created_at),
            size_bytes,
            includes_images: Some(manifest.includes_images),
            schema_version: Some(manifest.schema_version),
            app_version: Some(manifest.app_version.clone()),
            image_count: Some(manifest.image_count()),
            damaged: false,
        }
    }

    fn damaged(name: &BackupName, size_bytes: u64) -> Self {
        Self {
            id: name.file_name(),
            kind: name.kind,
            created_at: format_instant(name.created_at),
            size_bytes,
            includes_images: None,
            schema_version: None,
            app_version: None,
            image_count: None,
            damaged: true,
        }
    }
}

/// Valid archive names directly under `backups\`, newest first. Blocking.
pub fn list_backups(root: &DataRoot) -> Vec<BackupInfo> {
    let Ok(entries) = fs::read_dir(root.backups()) else {
        return Vec::new();
    };
    let mut found: Vec<(BackupName, BackupInfo)> = Vec::new();
    for entry in entries.flatten() {
        let Some(file_name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        let Some(name) = BackupName::parse(&file_name) else {
            continue;
        };
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        let info = match read_manifest(&path) {
            // The manifest must agree with the file name, or the archive is suspect.
            Ok(manifest)
                if manifest.kind == name.kind
                    && manifest.created_at == format_instant(name.created_at) =>
            {
                BackupInfo::from_manifest(&name, meta.len(), &manifest)
            }
            _ => BackupInfo::damaged(&name, meta.len()),
        };
        found.push((name, info));
    }
    found.sort_by(|a, b| {
        b.1.created_at
            .cmp(&a.1.created_at)
            .then(b.1.id.cmp(&a.1.id))
    });
    found.into_iter().map(|(_, info)| info).collect()
}

/// Most recent complete archive: ignores damaged archives, `pre-migration`, `pre-import`
/// and those dated more than one hour in the future.
#[allow(dead_code)] // used from lot B3
pub fn newest_full_backup(backups: &[BackupInfo], now: Timestamp) -> Option<&BackupInfo> {
    let limit = now.checked_add(SignedDuration::from_hours(1)).ok()?;
    backups
        .iter()
        .filter(|b| {
            !b.damaged
                && b.includes_images == Some(true)
                && b.kind.pool() != Pool::Migration
                && b.kind != BackupKind::PreImport
        })
        .filter(|b| BackupName::parse(&b.id).is_some_and(|n| n.created_at <= limit))
        .max_by(|a, b| a.created_at.cmp(&b.created_at))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backup::create::create_backup;
    use crate::backup::test_support::{make_database, run};
    use crate::time::clock::FixedClock;
    use crate::time::formats::parse_instant;
    use tempfile::TempDir;

    fn at(s: &str) -> Timestamp {
        parse_instant(s).expect("instant")
    }

    fn setup() -> (TempDir, DataRoot) {
        let dir = TempDir::new().expect("tmp");
        let root = DataRoot::new(dir.path().to_path_buf());
        make_database(&root.db(), 3, true);
        (dir, root)
    }

    fn create(root: &DataRoot, when: &str, kind: BackupKind) -> BackupInfo {
        let clock = FixedClock::new(at(when));
        run(create_backup(root, &clock, kind, &[])).expect("create")
    }

    fn write_garbage(root: &DataRoot, when: &str, kind: BackupKind) -> String {
        let name = BackupName::new(at(when), kind).file_name();
        fs::create_dir_all(root.backups()).expect("dir");
        fs::write(root.backups().join(&name), b"not a zip at all, really").expect("write");
        name
    }

    #[test]
    fn sorted_newest_first_with_damaged_and_foreign_files() {
        let (_dir, root) = setup();
        let old = create(&root, "2026-10-20T08:00:00.000Z", BackupKind::Manual);
        let new = create(&root, "2026-10-21T08:00:00.000Z", BackupKind::Daily);
        let broken = write_garbage(&root, "2026-10-21T09:00:00.000Z", BackupKind::Manual);
        fs::write(root.backups().join("notes.txt"), b"x").expect("foreign");
        fs::write(root.backups().join("homebase-bad-manual.zip"), b"x").expect("foreign");
        fs::create_dir_all(
            root.backups().join(
                BackupName::new(at("2026-10-22T08:00:00.000Z"), BackupKind::Manual).file_name(),
            ),
        )
        .expect("dir named like an archive");

        let list = list_backups(&root);
        let ids: Vec<&str> = list.iter().map(|b| b.id.as_str()).collect();
        assert_eq!(ids, [broken.as_str(), new.id.as_str(), old.id.as_str()]);
        assert!(list[0].damaged);
        assert_eq!(list[0].schema_version, None);
        assert_eq!(list[0].created_at, "2026-10-21T09:00:00.000Z");
        assert!(!list[1].damaged);
        assert_eq!(list[1].kind, BackupKind::Daily);
        assert_eq!(list[1].schema_version, Some(3));
        assert_eq!(list[1].includes_images, Some(true));
        assert_eq!(list[1].image_count, Some(0));
        assert!(list[1].size_bytes > 0);
    }

    #[test]
    fn missing_directory_gives_empty_list() {
        let dir = TempDir::new().expect("tmp");
        assert!(list_backups(&DataRoot::new(dir.path().to_path_buf())).is_empty());
    }

    #[test]
    fn newest_full_backup_filters() {
        let (_dir, root) = setup();
        let now = at("2026-10-21T12:00:00.000Z");
        let valid_old = create(&root, "2026-10-20T08:00:00.000Z", BackupKind::Daily);
        create(&root, "2026-10-21T09:00:00.000Z", BackupKind::PreMigration);
        create(&root, "2026-10-21T09:30:00.000Z", BackupKind::PreImport);
        write_garbage(&root, "2026-10-21T10:00:00.000Z", BackupKind::Manual);
        create(&root, "2026-10-21T13:30:00.000Z", BackupKind::Manual); // > 1 h in the future

        let list = list_backups(&root);
        assert_eq!(
            newest_full_backup(&list, now).map(|b| &b.id),
            Some(&valid_old.id)
        );

        let restore = create(&root, "2026-10-21T11:00:00.000Z", BackupKind::PreRestore);
        let list = list_backups(&root);
        assert_eq!(
            newest_full_backup(&list, now).map(|b| &b.id),
            Some(&restore.id)
        );

        // Within the one hour tolerance.
        let near = create(&root, "2026-10-21T12:30:00.000Z", BackupKind::Manual);
        let list = list_backups(&root);
        assert_eq!(
            newest_full_backup(&list, now).map(|b| &b.id),
            Some(&near.id)
        );
        assert!(newest_full_backup(&[], now).is_none());
    }
}
