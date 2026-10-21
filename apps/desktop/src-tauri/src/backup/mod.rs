//! Backup, restore and configuration export (docs/specs/backup-restore.md).

pub mod archive;
#[cfg(test)]
mod archive_tests;
pub mod commands;
pub mod create;
pub mod error;
pub mod fsutil;
pub mod list;
pub mod manifest;
pub mod names;
pub mod paths;
pub mod retention;
pub mod sqlite;
pub mod status;
#[cfg(test)]
pub mod test_support;
#[allow(dead_code)] // used from lot B2b
pub mod validate;
#[cfg(test)]
mod validate_tests;

use crate::time::clock::Clock;
use error::BackupError;
use paths::DataRoot;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const MAX_ARCHIVE_BYTES: u64 = 3 * 1024 * 1024 * 1024 + 64 * 1024 * 1024;
pub const MAX_ENTRIES: usize = 20_000;
pub const MAX_MANIFEST_BYTES: u64 = 4 * 1024 * 1024;
pub const MAX_DB_BYTES: u64 = 1024 * 1024 * 1024;
pub const MAX_IMAGE_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_TOTAL_UNCOMPRESSED: u64 = 3 * 1024 * 1024 * 1024;
pub const RETAIN_MANUAL: usize = 10;
pub const RETAIN_DAILY: usize = 7;
pub const RETAIN_SAFETY: usize = 5;
pub const RETAIN_MIGRATION: usize = 3;
#[allow(dead_code)] // used from lot B3
pub const DAILY_INTERVAL: Duration = Duration::from_secs(24 * 3600);
#[allow(dead_code)] // used from lot B3
pub const DAILY_FIRST_CHECK: Duration = Duration::from_secs(120);
#[allow(dead_code)] // used from lot B3
pub const DAILY_CHECK_PERIOD: Duration = Duration::from_secs(3600);
#[allow(dead_code)] // used from lot B4a
pub const MAX_CONFIG_FILE_BYTES: u64 = 1_048_576;
pub const RENAME_RETRY_TOTAL: Duration = Duration::from_secs(2);
pub const RENAME_RETRY_STEP: Duration = Duration::from_millis(100);

/// Shared state of the backup subsystem (managed by Tauri from lot B1b).
pub struct BackupState {
    pub root: DataRoot,
    pub clock: Arc<dyn Clock>,
    busy: AtomicBool,
    restart_pending: AtomicBool,
    #[allow(dead_code)] // used from lot B2b
    pub swapped_this_process: bool,
    pub last_auto_error: Mutex<Option<BackupError>>,
}

/// Releases the busy flag on drop.
pub struct BusyGuard<'a> {
    busy: &'a AtomicBool,
}

impl Drop for BusyGuard<'_> {
    fn drop(&mut self) {
        self.busy.store(false, Ordering::SeqCst);
    }
}

impl BackupState {
    pub fn new(root: DataRoot, clock: Arc<dyn Clock>, swapped: bool) -> Self {
        Self {
            root,
            clock,
            busy: AtomicBool::new(false),
            restart_pending: AtomicBool::new(false),
            swapped_this_process: swapped,
            last_auto_error: Mutex::new(None),
        }
    }

    /// `RestartPending` takes priority over `Busy`.
    pub fn try_acquire(&self) -> Result<BusyGuard<'_>, BackupError> {
        if self.restart_pending.load(Ordering::SeqCst) {
            return Err(BackupError::RestartPending);
        }
        if self
            .busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err(BackupError::Busy);
        }
        Ok(BusyGuard { busy: &self.busy })
    }

    #[allow(dead_code)] // used from lot B2b
    pub fn mark_restart_pending(&self) {
        self.restart_pending.store(true, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::time::clock::SystemClock;

    fn state() -> BackupState {
        BackupState::new(
            DataRoot::new(std::path::PathBuf::from("unused")),
            Arc::new(SystemClock),
            false,
        )
    }

    #[test]
    fn busy_then_released_on_drop() {
        let s = state();
        let g = s.try_acquire().expect("first");
        assert_eq!(s.try_acquire().err(), Some(BackupError::Busy));
        drop(g);
        assert!(s.try_acquire().is_ok());
    }

    #[test]
    fn restart_pending_has_priority_over_busy() {
        let s = state();
        let _g = s.try_acquire().expect("first");
        s.mark_restart_pending();
        assert_eq!(s.try_acquire().err(), Some(BackupError::RestartPending));
    }

    #[test]
    fn restart_pending_alone() {
        let s = state();
        s.mark_restart_pending();
        assert_eq!(s.try_acquire().err(), Some(BackupError::RestartPending));
    }

    #[test]
    fn limits_are_consistent() {
        assert_eq!(MAX_ARCHIVE_BYTES, 3_221_225_472 + 67_108_864);
        assert_eq!(
            RENAME_RETRY_TOTAL.as_millis() % RENAME_RETRY_STEP.as_millis(),
            0
        );
    }
}
