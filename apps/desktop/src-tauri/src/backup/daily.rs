//! Daily backup thread (spec D7, 4.9). Started by `on_app_ready`; wakes up after
//! `DAILY_FIRST_CHECK`, then every `DAILY_CHECK_PERIOD`. It takes the same lock as the manual
//! operations (`busy` / `restart_pending` make it skip its turn) and stops cleanly at exit.

use super::create::create_backup;
use super::list::{list_backups, newest_full_backup, BackupInfo};
use super::names::{BackupKind, BackupName};
use super::{BackupState, DAILY_CHECK_PERIOD, DAILY_FIRST_CHECK, DAILY_INTERVAL};
use jiff::Timestamp;
use std::sync::{Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Runtime};

/// How long the exit waits for a backup in progress before giving up on the join.
const EXIT_JOIN_MAX: Duration = Duration::from_secs(10);

/// A full, undamaged archive younger than 24 hours exists: no daily backup is needed.
/// Archives dated more than one hour in the future are ignored (`newest_full_backup`).
pub fn daily_due(backups: &[BackupInfo], now: Timestamp) -> bool {
    let Some(newest) = newest_full_backup(backups, now) else {
        return true;
    };
    let Some(created) = BackupName::parse(&newest.id).map(|n| n.created_at) else {
        return true;
    };
    match now.since(created) {
        Ok(age) => age.get_seconds() >= DAILY_INTERVAL.as_secs() as i64,
        Err(_) => true,
    }
}

/// Wakes the thread up (and tells it to stop) without waiting for the whole period.
#[derive(Default)]
pub struct StopSignal {
    stopped: Mutex<bool>,
    wake: Condvar,
}

impl StopSignal {
    pub fn stop(&self) {
        if let Ok(mut stopped) = self.stopped.lock() {
            *stopped = true;
        }
        self.wake.notify_all();
    }

    /// Sleeps for `total`; returns `true` when the stop was requested.
    pub fn wait(&self, total: Duration) -> bool {
        let deadline = Instant::now() + total;
        let Ok(mut stopped) = self.stopped.lock() else {
            return true;
        };
        while !*stopped {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break;
            }
            match self.wake.wait_timeout(stopped, remaining) {
                Ok((guard, _)) => stopped = guard,
                Err(_) => return true,
            }
        }
        *stopped
    }
}

/// The thread and its stop signal, kept in `BackupState`.
#[derive(Default)]
pub struct DailyThread {
    pub stop: StopSignal,
    handle: Mutex<Option<JoinHandle<()>>>,
}

/// One turn: skips when the lock is taken, otherwise creates a `daily` archive when due and
/// records the outcome in `last_auto_error` (cleared on success and when nothing is due).
pub fn tick(state: &BackupState) {
    // `busy` or `restart_pending`: skip this turn.
    let Ok(_guard) = state.try_acquire() else {
        return;
    };
    let error = if daily_due(&list_backups(&state.root), state.clock.now()) {
        tauri::async_runtime::block_on(create_backup(
            &state.root,
            state.clock.as_ref(),
            BackupKind::Daily,
            &[],
        ))
        .err()
    } else {
        None
    };
    if let Some(e) = &error {
        eprintln!("backup: daily backup failed: {e:?}");
    }
    if let Ok(mut slot) = state.last_auto_error.lock() {
        *slot = error;
    }
}

/// Runs until the stop signal. Delays are parameters so that tests can use short ones.
pub fn run_loop(state: &BackupState, first: Duration, period: Duration) {
    if state.daily.stop.wait(first) {
        return;
    }
    loop {
        tick(state);
        if state.daily.stop.wait(period) {
            return;
        }
    }
}

pub fn spawn<R: Runtime>(app: &AppHandle<R>) {
    let handle_app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("homebase-daily-backup".into())
        .spawn(move || {
            let state = handle_app.state::<BackupState>();
            run_loop(&state, DAILY_FIRST_CHECK, DAILY_CHECK_PERIOD);
        });
    match spawned {
        Ok(handle) => {
            let state = app.state::<BackupState>();
            if let Ok(mut slot) = state.daily.handle.lock() {
                *slot = Some(handle);
            };
        }
        Err(e) => eprintln!("backup: cannot start the daily thread: {:?}", e.kind()),
    }
}

/// Called on `RunEvent::Exit`: asks the thread to stop and waits for it (a backup in progress
/// finishes) for a bounded time. An abandoned thread is harmless: its temporary files are
/// removed at the next startup.
pub fn shutdown(state: &BackupState) {
    state.daily.stop.stop();
    let handle = state.daily.handle.lock().ok().and_then(|mut h| h.take());
    let Some(handle) = handle else {
        return;
    };
    let deadline = Instant::now() + EXIT_JOIN_MAX;
    while !handle.is_finished() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(50));
    }
    if handle.is_finished() {
        let _ = handle.join();
    } else {
        eprintln!("backup: the daily thread did not stop in time, leaving it");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backup::paths::DataRoot;
    use crate::backup::test_support::make_database;
    use crate::time::clock::FixedClock;
    use crate::time::formats::parse_instant;
    use std::sync::Arc;
    use tempfile::TempDir;

    fn at(s: &str) -> Timestamp {
        parse_instant(s).expect("instant")
    }

    fn info(when: &str, kind: BackupKind, full: bool, damaged: bool) -> BackupInfo {
        let name = BackupName::new(at(when), kind);
        BackupInfo {
            id: name.file_name(),
            kind,
            created_at: when.to_owned(),
            size_bytes: 1,
            includes_images: (!damaged).then_some(full),
            schema_version: (!damaged).then_some(3),
            app_version: None,
            image_count: None,
            damaged,
        }
    }

    const NOW: &str = "2026-10-21T12:00:00.000Z";

    #[test]
    fn daily_due_threshold_is_24_hours() {
        let now = at(NOW);
        assert!(daily_due(&[], now));
        let recent = [info(
            "2026-10-20T12:00:01.000Z",
            BackupKind::Manual,
            true,
            false,
        )];
        assert!(!daily_due(&recent, now));
        let exactly = [info(
            "2026-10-20T12:00:00.000Z",
            BackupKind::Daily,
            true,
            false,
        )];
        assert!(daily_due(&exactly, now));
        let old = [info(
            "2026-10-19T12:00:00.000Z",
            BackupKind::Daily,
            true,
            false,
        )];
        assert!(daily_due(&old, now));
    }

    #[test]
    fn daily_due_ignores_partial_damaged_and_far_future_archives() {
        let now = at(NOW);
        let partial = [
            info(
                "2026-10-21T11:00:00.000Z",
                BackupKind::PreMigration,
                false,
                false,
            ),
            info(
                "2026-10-21T11:00:00.000Z",
                BackupKind::PreImport,
                false,
                false,
            ),
        ];
        assert!(daily_due(&partial, now));
        let damaged = [info(
            "2026-10-21T11:00:00.000Z",
            BackupKind::Daily,
            true,
            true,
        )];
        assert!(daily_due(&damaged, now));
        // Two hours in the future: ignored. Thirty minutes ahead: counts as recent.
        let future = [info(
            "2026-10-21T14:00:00.000Z",
            BackupKind::Daily,
            true,
            false,
        )];
        assert!(daily_due(&future, now));
        let near_future = [info(
            "2026-10-21T12:30:00.000Z",
            BackupKind::Daily,
            true,
            false,
        )];
        assert!(!daily_due(&near_future, now));
        // A recent full archive hidden behind a damaged one still counts.
        let mixed = [
            info("2026-10-21T11:30:00.000Z", BackupKind::Daily, true, true),
            info("2026-10-21T10:00:00.000Z", BackupKind::Manual, true, false),
        ];
        assert!(!daily_due(&mixed, now));
    }

    fn state(dir: &TempDir) -> BackupState {
        let root = DataRoot::new(dir.path().to_path_buf());
        make_database(&root.db(), 3, true);
        BackupState::new(root, Arc::new(FixedClock::new(at(NOW))), None)
    }

    fn archives(state: &BackupState) -> Vec<BackupInfo> {
        list_backups(&state.root)
    }

    #[test]
    fn tick_creates_one_daily_archive_then_waits() {
        let dir = TempDir::new().expect("tmp");
        let state = state(&dir);
        tick(&state);
        let found = archives(&state);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].kind, BackupKind::Daily);
        assert_eq!(found[0].includes_images, Some(true));
        // Not due any more: nothing is created (the fixed clock would otherwise collide).
        tick(&state);
        assert_eq!(archives(&state).len(), 1);
        assert_eq!(*state.last_auto_error.lock().expect("lock"), None);
    }

    #[test]
    fn tick_skips_when_busy_or_restart_pending() {
        let dir = TempDir::new().expect("tmp");
        let state = state(&dir);
        {
            let _manual = state.try_acquire().expect("manual operation");
            tick(&state);
            assert!(archives(&state).is_empty());
        }
        state.mark_restart_pending();
        tick(&state);
        assert!(archives(&state).is_empty());
    }

    #[test]
    fn tick_records_a_failure_and_clears_it_later() {
        let dir = TempDir::new().expect("tmp");
        let root = DataRoot::new(dir.path().to_path_buf());
        let state = BackupState::new(root, Arc::new(FixedClock::new(at(NOW))), None);
        tick(&state); // no database
        assert_eq!(
            *state.last_auto_error.lock().expect("lock"),
            Some(crate::backup::error::BackupError::NoDatabase)
        );
        make_database(&state.root.db(), 3, false);
        tick(&state);
        assert_eq!(*state.last_auto_error.lock().expect("lock"), None);
        assert_eq!(archives(&state).len(), 1);
    }

    #[test]
    fn the_loop_runs_and_stops_cleanly() {
        let dir = TempDir::new().expect("tmp");
        let state = state(&dir);
        std::thread::scope(|scope| {
            let worker = scope.spawn(|| {
                run_loop(&state, Duration::from_millis(10), Duration::from_secs(3600));
            });
            let start = Instant::now();
            while archives(&state).is_empty() && start.elapsed() < Duration::from_secs(20) {
                std::thread::sleep(Duration::from_millis(20));
            }
            state.daily.stop.stop();
            worker.join().expect("loop ended");
        });
        assert_eq!(archives(&state).len(), 1);
        assert!(state.clock.now() == at(NOW));
    }

    #[test]
    fn stop_before_the_first_check_creates_nothing() {
        let dir = TempDir::new().expect("tmp");
        let state = state(&dir);
        state.daily.stop.stop();
        let start = Instant::now();
        run_loop(&state, Duration::from_secs(3600), Duration::from_secs(3600));
        assert!(start.elapsed() < Duration::from_secs(5));
        assert!(archives(&state).is_empty());
        shutdown(&state);
    }
}
