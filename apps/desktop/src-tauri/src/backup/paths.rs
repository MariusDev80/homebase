use crate::db::DB_FILE_NAME;
use std::path::{Path, PathBuf};

/// `<root>` = `app_config_dir()` (spec 4.1). Everything lives on the same volume.
#[derive(Debug, Clone)]
pub struct DataRoot {
    root: PathBuf,
}

impl DataRoot {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn path(&self) -> &Path {
        &self.root
    }

    pub fn db(&self) -> PathBuf {
        self.root.join(DB_FILE_NAME)
    }

    /// `-wal`, `-shm`, `-journal` (always handled together with the database).
    pub fn db_companions(&self) -> [PathBuf; 3] {
        ["-wal", "-shm", "-journal"].map(|suffix| self.root.join(format!("{DB_FILE_NAME}{suffix}")))
    }

    pub fn images(&self) -> PathBuf {
        self.root.join("images")
    }

    pub fn backups(&self) -> PathBuf {
        self.root.join("backups")
    }

    pub fn backups_tmp(&self) -> PathBuf {
        self.backups().join(".tmp")
    }

    pub fn incoming(&self) -> PathBuf {
        self.backups().join(".incoming")
    }

    pub fn incoming_picked(&self) -> PathBuf {
        self.incoming().join("picked.zip")
    }

    pub fn incoming_check(&self) -> PathBuf {
        self.incoming().join("check")
    }

    pub fn status_dir(&self) -> PathBuf {
        self.backups().join(".status")
    }

    pub fn db_missing_marker(&self) -> PathBuf {
        self.status_dir().join("db-missing.json")
    }

    pub fn last_restore_marker(&self) -> PathBuf {
        self.status_dir().join("last-restore.json")
    }

    pub fn pre_migration_failed_marker(&self) -> PathBuf {
        self.status_dir().join("pre-migration-failed.json")
    }

    pub fn startup_blocked_marker(&self) -> PathBuf {
        self.status_dir().join("startup-blocked.json")
    }

    pub fn restore_staging(&self) -> PathBuf {
        self.root.join("restore-staging.tmp")
    }

    pub fn restore_pending(&self) -> PathBuf {
        self.root.join("restore-pending")
    }

    pub fn restore_rollback(&self) -> PathBuf {
        self.root.join("restore-rollback")
    }

    pub fn restore_info(&self) -> PathBuf {
        self.restore_rollback().join("restore-info.json")
    }

    pub fn restore_pending_discarded(&self, stamp: &str) -> PathBuf {
        self.root.join(format!("restore-pending.discarded-{stamp}"))
    }

    pub fn restore_rollback_leftover(&self, stamp: &str) -> PathBuf {
        self.root.join(format!("restore-rollback.leftover-{stamp}"))
    }

    pub fn restore_rollback_confirmed(&self, stamp: &str) -> PathBuf {
        self.root
            .join(format!("restore-rollback.confirmed-{stamp}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_matches_spec() {
        let r = DataRoot::new(PathBuf::from("root"));
        assert_eq!(r.db(), Path::new("root").join("homebase.db"));
        let c = r.db_companions();
        assert!(c[0].ends_with("homebase.db-wal"));
        assert!(c[1].ends_with("homebase.db-shm"));
        assert!(c[2].ends_with("homebase.db-journal"));
        assert_eq!(
            r.db_missing_marker(),
            Path::new("root")
                .join("backups")
                .join(".status")
                .join("db-missing.json")
        );
        assert_eq!(
            r.incoming_picked(),
            Path::new("root")
                .join("backups")
                .join(".incoming")
                .join("picked.zip")
        );
        assert!(r.restore_info().ends_with("restore-info.json"));
        assert!(r
            .restore_rollback_confirmed("20261021T081500.123Z")
            .ends_with("restore-rollback.confirmed-20261021T081500.123Z"));
    }
}
