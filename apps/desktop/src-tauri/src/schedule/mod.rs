//! Reminder and timer scheduling (docs/specs/timers-reminders.md). Lot R1: storage and pure
//! planning only; the tick, the worker thread and the Tauri commands come in later lots.
#![cfg_attr(
    not(test),
    expect(dead_code, reason = "wired by the scheduler lots R2 and R3")
)]
// Tests exercise only part of it (the notifier, the constants, ...): same reason, no `expect`.
#![cfg_attr(test, allow(dead_code))]

use jiff::SignedDuration;
use std::time::Duration;

pub mod error;
pub mod notice;
pub mod notifier;
pub mod reminder;
pub mod session;
pub mod store;
pub mod text;

/// Longest sleep of the scheduler thread (ADR-003 section 3.10).
pub const MAX_SLEEP: Duration = Duration::from_secs(30);
pub const ERROR_RETRY: Duration = Duration::from_secs(5);
pub const WAKE_MARGIN: Duration = Duration::from_millis(20);
pub const EXIT_JOIN_MAX: Duration = Duration::from_secs(3);
/// A delay of at most this long still counts as "on time" (M2).
pub const GRACE: SignedDuration = SignedDuration::from_mins(5);
/// Older missed occurrences are recorded as missed, without a notification (M2).
pub const CATCHUP_WINDOW: SignedDuration = SignedDuration::from_hours(7 * 24);
/// Look-back used to count the occurrences skipped in one pass (D6).
pub const COUNT_WINDOW: SignedDuration = SignedDuration::from_hours(399 * 24);
pub const MAX_TOASTS_PER_TICK: usize = 4;
pub const DUE_BATCH: i64 = 200;
pub const MAX_REMINDERS: i64 = 1000;
pub const MAX_RUNNING_SESSIONS: i64 = 20;
pub const TITLE_MAX_CHARS: usize = 200;
pub const LABEL_MAX_CHARS: usize = 100;
pub const DURATION_MIN_MS: i64 = 1_000;
pub const DURATION_MAX_MS: i64 = 86_400_000;
pub const LIST_MAX_LIMIT: u32 = 200;

#[cfg(test)]
mod tests {
    mod plan_tests;
    mod store_tests;
}
