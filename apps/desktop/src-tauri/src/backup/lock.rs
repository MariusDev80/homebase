//! Process-wide lock on the data root (spec 4.8): a second instance must not run the startup
//! sequence (exchange / rollback) while the first one is alive.
//!
//! `<root>\homebase.lock` is opened exclusively (`share_mode(0)` on Windows) and kept for the whole
//! life of the process; the OS releases it when the process dies, so there is never a stale lock.

use super::paths::DataRoot;
use std::fs::{self, File, OpenOptions};
use std::io;
use std::time::{Duration, Instant};

const LOCK_FILE: &str = "homebase.lock";
/// A restarting application starts before the previous process is fully gone.
pub(super) const ACQUIRE_TOTAL: Duration = Duration::from_secs(5);
const ACQUIRE_STEP: Duration = Duration::from_millis(100);

/// Holds the lock until dropped.
#[derive(Debug)]
pub struct ProcessLock {
    _file: File,
}

fn try_open(root: &DataRoot) -> io::Result<ProcessLock> {
    fs::create_dir_all(root.path())?;
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(0);
    }
    let file = options.open(root.path().join(LOCK_FILE))?;
    #[cfg(not(windows))]
    file.try_lock().map_err(|e| match e {
        fs::TryLockError::WouldBlock => io::Error::from(io::ErrorKind::WouldBlock),
        fs::TryLockError::Error(e) => e,
    })?;
    Ok(ProcessLock { _file: file })
}

/// Retries for at most `total` (the previous instance may still be exiting).
pub fn acquire_within(root: &DataRoot, total: Duration) -> io::Result<ProcessLock> {
    let start = Instant::now();
    loop {
        match try_open(root) {
            Ok(lock) => return Ok(lock),
            Err(_) if start.elapsed() < total => {
                std::thread::sleep(ACQUIRE_STEP);
            }
            Err(e) => return Err(e),
        }
    }
}

pub fn acquire(root: &DataRoot) -> io::Result<ProcessLock> {
    acquire_within(root, ACQUIRE_TOTAL)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn a_second_holder_is_refused_until_the_first_is_dropped() {
        let dir = TempDir::new().expect("tmp");
        let root = DataRoot::new(dir.path().join("fresh"));
        let first = acquire_within(&root, Duration::ZERO).expect("first");
        assert!(acquire_within(&root, Duration::ZERO).is_err());
        drop(first);
        assert!(acquire_within(&root, Duration::ZERO).is_ok());
    }

    #[test]
    fn the_second_holder_waits_for_a_releasing_first() {
        let dir = TempDir::new().expect("tmp");
        let root = DataRoot::new(dir.path().to_path_buf());
        let first = acquire_within(&root, Duration::ZERO).expect("first");
        let releaser = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            drop(first);
        });
        acquire_within(&root, Duration::from_secs(3)).expect("second after release");
        releaser.join().expect("join");
    }
}
