//! Backup, restore and configuration export (docs/specs/backup-restore.md).

pub mod archive;
#[cfg(test)]
mod archive_tests;
#[cfg(test)]
mod b3_tests;
pub mod commands;
pub mod config_transfer;
#[cfg(test)]
mod config_transfer_tests;
pub mod create;
pub mod daily;
pub mod dashboard_delete;
#[cfg(test)]
mod dashboard_delete_tests;
pub mod dialogs;
pub mod error;
pub mod external;
pub mod fsutil;
pub mod list;
pub mod lock;
pub mod manifest;
pub mod names;
pub mod paths;
pub mod restore;
#[cfg(test)]
mod restore_tests;
pub mod retention;
pub mod sqlite;
pub mod startup;
pub mod status;
#[cfg(test)]
pub mod test_support;
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
pub const DAILY_INTERVAL: Duration = Duration::from_secs(24 * 3600);
pub const DAILY_FIRST_CHECK: Duration = Duration::from_secs(120);
pub const DAILY_CHECK_PERIOD: Duration = Duration::from_secs(3600);
pub const MAX_CONFIG_FILE_BYTES: u64 = 1_048_576;
pub const RENAME_RETRY_TOTAL: Duration = Duration::from_secs(2);
pub const RENAME_RETRY_STEP: Duration = Duration::from_millis(100);

/// Shared state of the backup subsystem (managed by Tauri from lot B1b).
pub struct BackupState {
    pub root: DataRoot,
    pub clock: Arc<dyn Clock>,
    busy: AtomicBool,
    restart_pending: AtomicBool,
    /// The exchange done by the startup sequence of this process (confirmed in `.setup()`).
    pub swap_info: Option<restore::RestoreInfo>,
    /// Exclusive lock on the data root, held for the whole life of the process.
    _process_lock: Option<lock::ProcessLock>,
    /// The daily backup thread (spec 4.9) and its stop signal.
    pub daily: daily::DailyThread,
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
    pub fn new(
        root: DataRoot,
        clock: Arc<dyn Clock>,
        swap_info: Option<restore::RestoreInfo>,
    ) -> Self {
        Self {
            root,
            clock,
            busy: AtomicBool::new(false),
            restart_pending: AtomicBool::new(false),
            swap_info,
            _process_lock: None,
            daily: daily::DailyThread::default(),
            last_auto_error: Mutex::new(None),
        }
    }

    pub fn with_process_lock(mut self, lock: lock::ProcessLock) -> Self {
        self._process_lock = Some(lock);
        self
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
            None,
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
