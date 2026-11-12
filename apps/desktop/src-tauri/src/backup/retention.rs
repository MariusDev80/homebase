use super::fsutil::remove_with_retry;
use super::names::{BackupName, Pool};
use super::paths::DataRoot;
use super::{RETAIN_DAILY, RETAIN_MANUAL, RETAIN_MIGRATION, RETAIN_SAFETY};
use std::fs;

fn retain_count(pool: Pool) -> usize {
    match pool {
        Pool::Manual => RETAIN_MANUAL,
        Pool::Daily => RETAIN_DAILY,
        Pool::Safety => RETAIN_SAFETY,
        Pool::Migration => RETAIN_MIGRATION,
    }
}

/// Prunes the reserve of `keep` (the file just created), sparing `keep` and every name in
/// `protect`. Returns the deleted file names. Does nothing while `db-missing.json` exists.
/// Files with an invalid name are never touched; deletion errors are logged, never propagated.
pub fn apply_retention(root: &DataRoot, keep: &str, protect: &[&str]) -> Vec<String> {
    if root.db_missing_marker().exists() {
        return Vec::new();
    }
    let Some(keep_name) = BackupName::parse(keep) else {
        return Vec::new();
    };
    let pool = keep_name.kind.pool();
    let Ok(entries) = fs::read_dir(root.backups()) else {
        return Vec::new();
    };
    let mut candidates: Vec<(BackupName, String)> = entries
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|e| {
            let file_name = e.file_name().into_string().ok()?;
            let name = BackupName::parse(&file_name)?;
            (name.kind.pool() == pool).then_some((name, file_name))
        })
        .collect();
    // Newest first (stamp is fixed-width, so the instant order is the stamp order).
    candidates.sort_by(|a, b| {
        b.0.created_at
            .cmp(&a.0.created_at)
            .then_with(|| b.1.cmp(&a.1))
    });
    let mut deleted = Vec::new();
    for (_, file_name) in candidates.into_iter().skip(retain_count(pool)) {
        if file_name == keep || protect.contains(&file_name.as_str()) {
            continue;
        }
        match remove_with_retry(&root.backups().join(&file_name)) {
            Ok(()) => deleted.push(file_name),
            Err(e) => eprintln!("backup retention: cannot delete a backup ({:?})", e.kind()),
        }
    }
    deleted
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backup::fsutil::write_json_atomic;
    use crate::backup::names::BackupKind;
    use crate::time::formats::parse_instant;
    use tempfile::TempDir;

    fn name(minute: u32, kind: BackupKind) -> String {
        let t = parse_instant(&format!("2026-10-21T08:{minute:02}:00.000Z")).expect("instant");
        BackupName::new(t, kind).file_name()
    }

    fn setup() -> (TempDir, DataRoot) {
        let dir = TempDir::new().expect("tmp");
        let root = DataRoot::new(dir.path().to_path_buf());
        fs::create_dir_all(root.backups()).expect("mkdir");
        (dir, root)
    }

    fn touch(root: &DataRoot, file: &str) {
        fs::write(root.backups().join(file), b"x").expect("write");
    }

    fn exists(root: &DataRoot, file: &str) -> bool {
        root.backups().join(file).exists()
    }

    #[test]
    fn keeps_newest_n_per_pool_independently() {
        let (_d, root) = setup();
        let manual: Vec<_> = (0..12).map(|m| name(m, BackupKind::Manual)).collect();
        let daily: Vec<_> = (0..9).map(|m| name(m, BackupKind::Daily)).collect();
        let migration: Vec<_> = (0..5).map(|m| name(m, BackupKind::PreMigration)).collect();
        let mut safety: Vec<_> = (0..4).map(|m| name(m, BackupKind::PreRestore)).collect();
        safety.extend((4..7).map(|m| name(m, BackupKind::PreImport)));
        for f in manual.iter().chain(&daily).chain(&migration).chain(&safety) {
            touch(&root, f);
        }

        let deleted = apply_retention(&root, manual.last().expect("last"), &[]);
        assert_eq!(deleted.len(), 2);
        assert!(!exists(&root, &manual[0]) && !exists(&root, &manual[1]));
        assert!(exists(&root, &manual[2]));
        // Other pools untouched by a manual retention pass.
        assert!(daily.iter().all(|f| exists(&root, f)));
        assert!(migration.iter().all(|f| exists(&root, f)));
        assert!(safety.iter().all(|f| exists(&root, f)));

        assert_eq!(
            apply_retention(&root, daily.last().expect("last"), &[]).len(),
            2
        );
        assert_eq!(
            apply_retention(&root, migration.last().expect("last"), &[]).len(),
            2
        );
        // Safety pool mixes pre-restore and pre-import: 7 files, keep 5.
        let deleted = apply_retention(&root, safety.last().expect("last"), &[]);
        assert_eq!(deleted.len(), 2);
        assert!(!exists(&root, &safety[0]) && !exists(&root, &safety[1]));
        assert!(exists(&root, &safety[2]));
    }

    #[test]
    fn keep_is_spared_even_if_old() {
        let (_d, root) = setup();
        let files: Vec<_> = (0..12).map(|m| name(m, BackupKind::Manual)).collect();
        for f in &files {
            touch(&root, f);
        }
        let deleted = apply_retention(&root, &files[0], &[]);
        assert!(exists(&root, &files[0]));
        assert_eq!(deleted, vec![files[1].clone()]);
    }

    #[test]
    fn protect_is_spared_even_if_oldest() {
        let (_d, root) = setup();
        let files: Vec<_> = (0..12).map(|m| name(m, BackupKind::Manual)).collect();
        for f in &files {
            touch(&root, f);
        }
        let deleted = apply_retention(&root, &files[11], &[files[0].as_str()]);
        assert!(exists(&root, &files[0]));
        assert_eq!(deleted, vec![files[1].clone()]);
    }

    #[test]
    fn suspended_by_db_missing_marker() {
        let (_d, root) = setup();
        let files: Vec<_> = (0..12).map(|m| name(m, BackupKind::Manual)).collect();
        for f in &files {
            touch(&root, f);
        }
        write_json_atomic(&root.db_missing_marker(), &serde_json::json!({})).expect("marker");
        assert!(apply_retention(&root, &files[11], &[]).is_empty());
        assert!(files.iter().all(|f| exists(&root, f)));
    }

    #[test]
    fn foreign_files_and_dirs_are_untouched() {
        let (_d, root) = setup();
        let files: Vec<_> = (0..12).map(|m| name(m, BackupKind::Manual)).collect();
        for f in &files {
            touch(&root, f);
        }
        let foreign = [
            "notes.txt",
            "homebase-20261021T081500.123Z-manual.ZIP",
            "homebase-20261021T081500.123Z-weird.zip",
            "homebase-bad-manual.zip",
        ];
        for f in foreign {
            touch(&root, f);
        }
        fs::create_dir_all(root.backups().join(".tmp")).expect("mkdir");
        fs::create_dir_all(root.backups().join(".status")).expect("mkdir");
        // A directory with a valid name is not a backup file.
        fs::create_dir_all(root.backups().join(name(30, BackupKind::Manual))).expect("mkdir");

        let deleted = apply_retention(&root, &files[11], &[]);
        assert_eq!(deleted.len(), 2);
        for f in foreign {
            assert!(exists(&root, f), "{f}");
        }
        assert!(root.backups().join(".tmp").is_dir());
        assert!(root.backups().join(name(30, BackupKind::Manual)).is_dir());
    }

    #[test]
    fn invalid_keep_or_missing_dir_is_a_no_op() {
        let (_d, root) = setup();
        assert!(apply_retention(&root, "garbage.zip", &[]).is_empty());
        let other = DataRoot::new(root.path().join("absent"));
        assert!(apply_retention(&other, &name(0, BackupKind::Manual), &[]).is_empty());
    }
}
