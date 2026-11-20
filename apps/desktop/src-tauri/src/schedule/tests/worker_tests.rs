//! The scheduler thread (spec 6.1, `worker_tests`): wake-up, stop, bounded shutdown and retry
//! after an error, with short injected durations.

use crate::backup::sqlite::supported_schema_version;
use crate::backup::test_support::{make_database, run};
use crate::schedule::notice::Toast;
use crate::schedule::notifier::Notifier;
use crate::schedule::notifier::RecordingNotifier;
use crate::schedule::reminder::ReminderRow;
use crate::schedule::store;
use crate::schedule::worker::{self, WaitOutcome, WakeSignal};
use crate::schedule::{SchedulerCtx, SchedulerState};
use crate::time::clock::Clock;
use crate::time::clock::FixedClock;
use crate::time::formats::parse_instant;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tempfile::TempDir;

const NOW: &str = "2026-11-16T08:00:00.000Z";

fn ctx(db: &Path) -> (Arc<SchedulerCtx>, Arc<RecordingNotifier>) {
    let notifier = Arc::new(RecordingNotifier::default());
    let ctx = Arc::new(SchedulerCtx {
        db: db.to_path_buf(),
        clock: Arc::new(FixedClock::new(parse_instant(NOW).expect("instant"))),
        notifier: notifier.clone(),
        gate: tokio::sync::Mutex::new(()),
        busy_timeout: Duration::from_millis(200),
        signal: WakeSignal::default(),
    });
    (ctx, notifier)
}

/// A one-off reminder due exactly at `NOW`.
fn due_reminder() -> ReminderRow {
    ReminderRow {
        id: "00000000-0000-4000-8000-000000000001".to_owned(),
        title: "Due".to_owned(),
        start_local: "2026-11-16T09:00:00".to_owned(),
        time_zone: "Europe/Paris".to_owned(),
        rrule: None,
        exdates: "[]".to_owned(),
        enabled: true,
        next_fire_at: Some(NOW.to_owned()),
        next_fire_key: Some("2026-11-16T09:00:00".to_owned()),
        habit_id: None,
        created_at: "2026-11-01T00:00:00.000Z".to_owned(),
        updated_at: "2026-11-01T00:00:00.000Z".to_owned(),
    }
}

fn insert_due(db: &Path) {
    run(async {
        let mut conn = store::connect(db).await.expect("connect");
        store::insert_reminder(&mut conn, &due_reminder())
            .await
            .expect("insert");
        store::close(conn).await;
    });
}

fn wait_for_toasts(notifier: &RecordingNotifier, within: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < within {
        if !notifier.shown.lock().expect("lock").is_empty() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    false
}

#[test]
fn the_signal_reports_timeout_wake_and_stop() {
    let signal = WakeSignal::default();
    assert_eq!(
        signal.wait(Duration::from_millis(20)),
        WaitOutcome::TimedOut
    );
    // A wake-up requested before the wait is not lost, and is consumed once.
    signal.wake();
    assert_eq!(signal.wait(Duration::from_secs(5)), WaitOutcome::Woken);
    assert_eq!(
        signal.wait(Duration::from_millis(20)),
        WaitOutcome::TimedOut
    );
    signal.stop();
    assert!(signal.is_stopped());
    assert_eq!(signal.wait(Duration::from_secs(5)), WaitOutcome::Stopped);
}

#[test]
fn wake_triggers_a_pass_within_a_second_while_max_sleep_is_an_hour() {
    let dir = TempDir::new().expect("tmp");
    let db = dir.path().join("homebase.db");
    make_database(&db, supported_schema_version(), false);
    let (ctx, notifier) = ctx(&db);
    std::thread::scope(|scope| {
        let worker = scope.spawn(|| {
            worker::run_loop(&ctx, Duration::from_secs(3600));
        });
        // Let the startup pass finish on the empty base, then add work and wake the thread.
        std::thread::sleep(Duration::from_millis(500));
        assert!(notifier.shown.lock().expect("lock").is_empty());
        insert_due(&db);
        let start = Instant::now();
        ctx.signal.wake();
        assert!(wait_for_toasts(&notifier, Duration::from_secs(10)));
        assert!(
            start.elapsed() < Duration::from_secs(2),
            "{:?}",
            start.elapsed()
        );
        ctx.signal.stop();
        worker.join().expect("loop ended");
    });
    assert_eq!(notifier.shown.lock().expect("lock").len(), 1);
}

#[test]
fn a_loop_stopped_before_it_starts_does_nothing() {
    let dir = TempDir::new().expect("tmp");
    let db = dir.path().join("homebase.db");
    make_database(&db, supported_schema_version(), false);
    insert_due(&db);
    let (ctx, notifier) = ctx(&db);
    ctx.signal.stop();
    let start = Instant::now();
    worker::run_loop(&ctx, Duration::from_secs(3600));
    assert!(start.elapsed() < Duration::from_secs(2));
    assert!(notifier.shown.lock().expect("lock").is_empty());
}

#[test]
fn shutdown_stops_and_joins_a_sleeping_thread() {
    let dir = TempDir::new().expect("tmp");
    let db = dir.path().join("homebase.db");
    make_database(&db, supported_schema_version(), false);
    let (ctx, _notifier) = ctx(&db);
    let state = SchedulerState::new(ctx);
    worker::spawn(&state);
    assert!(state.handle.lock().expect("lock").is_some());
    std::thread::sleep(Duration::from_millis(300));
    let start = Instant::now();
    worker::shutdown_within(&state, Duration::from_secs(2));
    assert!(
        start.elapsed() < Duration::from_secs(2),
        "{:?}",
        start.elapsed()
    );
    assert!(state.handle.lock().expect("lock").is_none());
    // Without a thread (setup failed): nothing to do.
    worker::shutdown_within(&state, Duration::from_millis(10));
}

#[test]
fn shutdown_gives_up_on_a_thread_that_does_not_stop() {
    let dir = TempDir::new().expect("tmp");
    let db = dir.path().join("homebase.db");
    let (ctx, _notifier) = ctx(&db);
    let state = SchedulerState::new(ctx);
    let (release, released) = std::sync::mpsc::channel::<()>();
    let handle = std::thread::spawn(move || {
        let _ = released.recv_timeout(Duration::from_secs(20));
    });
    *state.handle.lock().expect("lock") = Some(handle);
    let start = Instant::now();
    worker::shutdown_within(&state, Duration::from_millis(200));
    let elapsed = start.elapsed();
    assert!(elapsed >= Duration::from_millis(200), "waited the bound");
    assert!(elapsed < Duration::from_secs(5), "but no longer");
    drop(release);
}

#[test]
fn a_failed_pass_is_retried_after_the_error_delay() {
    let dir = TempDir::new().expect("tmp");
    let db = dir.path().join("homebase.db");
    // No database yet: every pass fails (the connection never creates the file).
    let (ctx, notifier) = ctx(&db);
    std::thread::scope(|scope| {
        let worker = scope.spawn(|| {
            worker::run_loop_with(&ctx, Duration::from_secs(3600), Duration::from_millis(50));
        });
        std::thread::sleep(Duration::from_millis(300));
        assert!(notifier.shown.lock().expect("lock").is_empty());
        // Built elsewhere, then put in place at once: the retry cannot see a half-made base.
        let staged = dir.path().join("staged.db");
        make_database(&staged, supported_schema_version(), false);
        insert_due(&staged);
        std::fs::rename(&staged, &db).expect("move into place");
        let seen = wait_for_toasts(&notifier, Duration::from_secs(10));
        ctx.signal.stop();
        worker.join().expect("loop ended");
        assert!(seen);
    });
}

fn secs(n: u64) -> Duration {
    Duration::from_secs(n)
}

#[test]
fn sleep_for_clamps_the_delay_and_adds_the_margin() {
    use crate::schedule::worker::sleep_for;
    use crate::schedule::WAKE_MARGIN;
    let now = parse_instant(NOW).expect("instant");
    let in_secs = |n: i64| {
        Some(
            now.checked_add(jiff::SignedDuration::from_secs(n))
                .expect("add"),
        )
    };
    let max = secs(30);
    assert_eq!(sleep_for(None, now, max), max + WAKE_MARGIN);
    assert_eq!(sleep_for(in_secs(-60), now, max), WAKE_MARGIN);
    assert_eq!(sleep_for(Some(now), now, max), WAKE_MARGIN);
    assert_eq!(sleep_for(in_secs(3600), now, max), max + WAKE_MARGIN);
    assert_eq!(sleep_for(in_secs(5), now, max), secs(5) + WAKE_MARGIN);
}

struct CountingClock {
    inner: FixedClock,
    reads: AtomicUsize,
}

impl Clock for CountingClock {
    fn now(&self) -> jiff::Timestamp {
        self.reads.fetch_add(1, Ordering::SeqCst);
        self.inner.now()
    }
}

#[test]
fn a_disabled_line_with_a_past_cache_does_not_make_the_loop_spin() {
    let dir = TempDir::new().expect("tmp");
    let db = dir.path().join("homebase.db");
    make_database(&db, supported_schema_version(), false);
    run(async {
        let mut conn = store::connect(&db).await.expect("connect");
        sqlx::query("PRAGMA ignore_check_constraints = ON")
            .execute(&mut conn)
            .await
            .expect("pragma");
        let row = ReminderRow {
            enabled: false,
            ..due_reminder()
        };
        store::insert_reminder(&mut conn, &row)
            .await
            .expect("insert");
        store::close(conn).await;
    });
    let clock = Arc::new(CountingClock {
        inner: FixedClock::new(parse_instant(NOW).expect("instant")),
        reads: AtomicUsize::new(0),
    });
    let ctx = SchedulerCtx {
        db,
        clock: clock.clone(),
        notifier: Arc::new(RecordingNotifier::default()),
        gate: tokio::sync::Mutex::new(()),
        busy_timeout: Duration::from_millis(200),
        signal: WakeSignal::default(),
    };
    std::thread::scope(|scope| {
        let worker = scope.spawn(|| worker::run_loop(&ctx, secs(3600)));
        std::thread::sleep(Duration::from_millis(600));
        ctx.signal.stop();
        worker.join().expect("loop ended");
    });
    // One read per pass: a single pass, not a burst every 20 ms.
    assert_eq!(clock.reads.load(Ordering::SeqCst), 1);
}

/// Panics on its first toast, records the next ones.
#[derive(Default)]
struct PanicOnce {
    panicked: AtomicBool,
    shown: std::sync::Mutex<Vec<Toast>>,
}

impl Notifier for PanicOnce {
    fn show(&self, toast: &Toast) {
        if !self.panicked.swap(true, Ordering::SeqCst) {
            panic!("notifier failure (expected by the test)");
        }
        self.shown.lock().expect("lock").push(toast.clone());
    }
}

#[test]
fn a_panicking_pass_is_retried_and_the_next_pass_works() {
    let dir = TempDir::new().expect("tmp");
    let db = dir.path().join("homebase.db");
    make_database(&db, supported_schema_version(), false);
    insert_due(&db);
    let notifier = Arc::new(PanicOnce::default());
    let ctx = SchedulerCtx {
        db: db.clone(),
        clock: Arc::new(FixedClock::new(parse_instant(NOW).expect("instant"))),
        notifier: notifier.clone(),
        gate: tokio::sync::Mutex::new(()),
        busy_timeout: Duration::from_millis(200),
        signal: WakeSignal::default(),
    };
    std::thread::scope(|scope| {
        let worker = scope.spawn(|| {
            worker::run_loop_with(&ctx, secs(3600), Duration::from_millis(50));
        });
        let start = Instant::now();
        while !notifier.panicked.load(Ordering::SeqCst) && start.elapsed() < secs(10) {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(notifier.panicked.load(Ordering::SeqCst));
        // The thread survived: a second due reminder is notified after a wake-up.
        run(async {
            let mut conn = store::connect(&db).await.expect("connect");
            let second = ReminderRow {
                id: "00000000-0000-4000-8000-000000000002".to_owned(),
                title: "Second".to_owned(),
                ..due_reminder()
            };
            store::insert_reminder(&mut conn, &second)
                .await
                .expect("insert");
            store::close(conn).await;
        });
        ctx.signal.wake();
        let start = Instant::now();
        while notifier.shown.lock().expect("lock").is_empty() && start.elapsed() < secs(10) {
            std::thread::sleep(Duration::from_millis(10));
        }
        ctx.signal.stop();
        worker.join().expect("loop ended");
    });
    let shown = notifier.shown.lock().expect("lock");
    assert_eq!(shown.len(), 1);
    assert_eq!(shown[0].title, "Second");
}
