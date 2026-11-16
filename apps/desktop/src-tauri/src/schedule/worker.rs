//! The scheduler thread (spec D1, 4.2), modelled on `backup::daily`: a `std` thread that sleeps
//! on a `Condvar` for at most `MAX_SLEEP`, re-reads the clock at every wake-up (suspend, clock
//! change), can be woken at once and stops within a bounded time at exit.

use super::tick::{tick, Phase};
use super::{SchedulerCtx, SchedulerState, ERROR_RETRY, MAX_SLEEP, WAKE_MARGIN};
use jiff::Timestamp;
use std::panic::AssertUnwindSafe;
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

#[derive(Debug, PartialEq, Eq)]
pub enum WaitOutcome {
    Stopped,
    Woken,
    TimedOut,
}

#[derive(Default)]
struct Flags {
    stopped: bool,
    woken: bool,
}

/// Wakes the thread up early (a deadline changed) or tells it to stop.
#[derive(Default)]
pub struct WakeSignal {
    flags: Mutex<Flags>,
    condvar: Condvar,
}

impl WakeSignal {
    #[cfg_attr(not(test), expect(dead_code, reason = "used by the R3 commands"))]
    pub fn wake(&self) {
        if let Ok(mut flags) = self.flags.lock() {
            flags.woken = true;
        }
        self.condvar.notify_all();
    }

    pub fn stop(&self) {
        if let Ok(mut flags) = self.flags.lock() {
            flags.stopped = true;
        }
        self.condvar.notify_all();
    }

    pub fn is_stopped(&self) -> bool {
        self.flags.lock().map(|f| f.stopped).unwrap_or(true)
    }

    /// Sleeps for at most `max`. A wake-up requested while nobody waited is not lost: the next
    /// call returns `Woken` at once.
    pub fn wait(&self, max: Duration) -> WaitOutcome {
        let deadline = Instant::now() + max;
        let Ok(mut flags) = self.flags.lock() else {
            return WaitOutcome::Stopped;
        };
        loop {
            if flags.stopped {
                return WaitOutcome::Stopped;
            }
            if flags.woken {
                flags.woken = false;
                return WaitOutcome::Woken;
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return WaitOutcome::TimedOut;
            }
            match self.condvar.wait_timeout(flags, remaining) {
                Ok((guard, _)) => flags = guard,
                Err(_) => return WaitOutcome::Stopped,
            }
        }
    }
}

/// How long to sleep after a successful pass: until the next deadline, clamped to
/// `0..=max_sleep`, plus `WAKE_MARGIN`; `max_sleep` when there is no deadline.
pub(crate) fn sleep_for(
    next_due: Option<Timestamp>,
    now: Timestamp,
    max_sleep: Duration,
) -> Duration {
    let until = next_due.map_or(max_sleep, |due| {
        let ms = due.duration_since(now).as_millis().max(0);
        u64::try_from(ms)
            .map(Duration::from_millis)
            .unwrap_or(max_sleep)
            .min(max_sleep)
    });
    until + WAKE_MARGIN
}

/// `tick(Startup)` then `tick(Regular)` until stopped. A failed pass is logged (kind only) and
/// retried after `error_retry`.
pub fn run_loop_with(ctx: &SchedulerCtx, max_sleep: Duration, error_retry: Duration) {
    let mut phase = Phase::Startup;
    while !ctx.signal.is_stopped() {
        // A panic (a notifier, say) is an error like any other: the thread must survive it.
        let pass = std::panic::catch_unwind(AssertUnwindSafe(|| {
            tauri::async_runtime::block_on(tick(ctx, phase))
        }));
        let wait = match pass {
            Ok(Ok(report)) => {
                phase = Phase::Regular;
                if report.next_due.is_some_and(|due| due <= report.now) {
                    // Something due that the pass could not move forward: do not spin.
                    eprintln!("schedule: a deadline is still due after the pass, retrying later");
                    error_retry
                } else {
                    sleep_for(report.next_due, report.now, max_sleep)
                }
            }
            Ok(Err(e)) => {
                eprintln!("schedule: pass failed ({e:?}), retrying");
                error_retry
            }
            Err(_) => {
                eprintln!("schedule: pass panicked, retrying");
                error_retry
            }
        };
        if ctx.signal.wait(wait) == WaitOutcome::Stopped {
            return;
        }
    }
}

pub fn run_loop(ctx: &SchedulerCtx, max_sleep: Duration) {
    run_loop_with(ctx, max_sleep, ERROR_RETRY);
}

pub fn spawn(state: &SchedulerState) {
    let ctx = state.ctx.clone();
    let spawned = std::thread::Builder::new()
        .name("homebase-scheduler".into())
        .spawn(move || run_loop(&ctx, MAX_SLEEP));
    match spawned {
        Ok(handle) => {
            if let Ok(mut slot) = state.handle.lock() {
                *slot = Some(handle);
            }
        }
        Err(e) => eprintln!(
            "schedule: cannot start the scheduler thread: {:?}",
            e.kind()
        ),
    }
}

/// Asks the thread to stop and waits for it for at most `max`. An abandoned thread is harmless:
/// every write it makes is a committed transaction.
pub(crate) fn shutdown_within(state: &SchedulerState, max: Duration) {
    state.ctx.signal.stop();
    let handle = state.handle.lock().ok().and_then(|mut h| h.take());
    let Some(handle) = handle else {
        return;
    };
    let deadline = Instant::now() + max;
    while !handle.is_finished() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(20));
    }
    if handle.is_finished() {
        let _ = handle.join();
    } else {
        eprintln!("schedule: the scheduler thread did not stop in time, leaving it");
    }
}
