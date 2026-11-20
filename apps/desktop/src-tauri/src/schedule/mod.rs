//! Reminder and timer scheduling (docs/specs/timers-reminders.md). Storage and pure planning
//! (lot R1), the pass, the worker thread and the wiring (lot R2), the Tauri commands (lot R3).

use crate::backup::BackupState;
use crate::time::clock::Clock;
use jiff::SignedDuration;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;
use tauri::{AppHandle, Manager, Runtime};

/// Runs the body under the module gate (D3) on a dedicated connection, closed afterwards. The
/// gate is released when the macro's block ends, so a caller that wakes the scheduler afterwards
/// does it outside the gate and after the commit. Defined before the submodules so that their
/// code sees it (textual scope); the paths are absolute, so it works from any of them.
macro_rules! locked {
    ($ctx:expr, $conn:ident => $body:expr) => {{
        let _gate = $ctx.gate.lock().await;
        let mut $conn =
            $crate::schedule::store::connect_with_timeout(&$ctx.db, $ctx.busy_timeout).await?;
        let result: Result<_, $crate::schedule::error::ScheduleError> = async { $body }.await;
        $crate::schedule::store::close($conn).await;
        result
    }};
}

pub mod commands;
pub mod error;
pub mod habit;
pub mod habit_commands;
pub mod habit_store;
pub mod notice;
pub mod notifier;
pub mod reminder;
pub mod session;
pub mod store;
pub mod text;
pub mod tick;
pub mod worker;

use notifier::{Notifier, TauriNotifier};
use worker::WakeSignal;

/// Longest sleep of the scheduler thread (ADR-003 section 3.10).
pub const MAX_SLEEP: Duration = Duration::from_secs(30);
pub const ERROR_RETRY: Duration = Duration::from_secs(5);
pub const WAKE_MARGIN: Duration = Duration::from_millis(20);
/// A prudence bound, kept under the wait for the process lock. Tauri runs the `Exit` callback
/// (and so both waits) before `process::restart`, so this does not protect against a concurrent
/// instance.
pub const EXIT_JOIN_MAX: Duration = Duration::from_secs(3);
const _: () = assert!(EXIT_JOIN_MAX.as_millis() < crate::backup::lock::ACQUIRE_TOTAL.as_millis());
/// A delay of at most this long still counts as "on time" (M2).
pub const GRACE: SignedDuration = SignedDuration::from_mins(5);
/// Older missed occurrences are recorded as missed, without a notification (M2).
pub const CATCHUP_WINDOW: SignedDuration = SignedDuration::from_hours(7 * 24);
/// Look-back used to count the occurrences skipped in one pass (D6).
pub const COUNT_WINDOW: SignedDuration = SignedDuration::from_hours(399 * 24);
pub const MAX_TOASTS_PER_TICK: usize = 4;
pub const DUE_BATCH: i64 = 200;
pub const MAX_REMINDERS: i64 = 1000;
pub const MAX_HABITS: i64 = 100;
/// Widest range of `habit_checks`, bounds included.
pub const HABIT_RANGE_MAX_DAYS: i64 = 400;
pub const HABIT_CHECKS_MAX_ROWS: i64 = 50_000;
pub const MAX_RUNNING_SESSIONS: i64 = 20;
pub const TITLE_MAX_CHARS: usize = 200;
pub const LABEL_MAX_CHARS: usize = 100;
pub const DURATION_MIN_MS: i64 = 1_000;
pub const DURATION_MAX_MS: i64 = 86_400_000;
pub const LIST_MAX_LIMIT: u32 = 200;

/// Everything a pass and a command need (D3). One per process.
pub struct SchedulerCtx {
    pub db: std::path::PathBuf,
    pub clock: Arc<dyn Clock>,
    pub notifier: Arc<dyn Notifier>,
    /// Serialises every operation of the module (passes and commands).
    pub gate: tokio::sync::Mutex<()>,
    /// Wait for a busy database ([`store::BUSY_TIMEOUT`] in production).
    pub busy_timeout: Duration,
    pub signal: WakeSignal,
}

pub struct SchedulerState {
    pub ctx: Arc<SchedulerCtx>,
    handle: Mutex<Option<JoinHandle<()>>>,
}

impl SchedulerState {
    pub fn new(ctx: Arc<SchedulerCtx>) -> Self {
        Self {
            ctx,
            handle: Mutex::new(None),
        }
    }
}

/// Called in `.setup()` after `tray::setup`: database path and clock come from `BackupState`,
/// the notifier is the Tauri one; manages the state, then starts the thread.
pub fn start<R: Runtime>(app: &AppHandle<R>) -> Result<(), Box<dyn std::error::Error>> {
    let backup = app
        .try_state::<BackupState>()
        .ok_or("the backup state must be managed before the scheduler")?;
    let ctx = Arc::new(SchedulerCtx {
        db: backup.root.db(),
        clock: backup.clock.clone(),
        notifier: Arc::new(TauriNotifier::new(app.clone())),
        gate: tokio::sync::Mutex::new(()),
        busy_timeout: store::BUSY_TIMEOUT,
        signal: WakeSignal::default(),
    });
    app.manage(SchedulerState::new(ctx));
    worker::spawn(&app.state::<SchedulerState>());
    Ok(())
}

/// `RunEvent::Exit`: stops the thread and waits for it, at most `EXIT_JOIN_MAX`. Nothing to do if
/// the setup failed before `start`.
pub fn shutdown<R: Runtime>(app: &AppHandle<R>) {
    if let Some(state) = app.try_state::<SchedulerState>() {
        worker::shutdown_within(&state, EXIT_JOIN_MAX);
    }
}

#[cfg(test)]
mod tests {
    mod commands_tests;
    mod habit_commands_tests;
    mod habit_plan_tests;
    mod habit_store_tests;
    mod plan_tests;
    mod store_tests;
    mod tick_tests;
    mod worker_tests;
}
