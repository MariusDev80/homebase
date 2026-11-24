//! One scheduler pass on a real database at the latest schema (spec 6.1, `tick_tests`): `FixedClock` and
//! `RecordingNotifier`; cases L1 to L3, L5 to L10, L14 to L17, L20 and L35 of the spec.

use crate::backup::sqlite::supported_schema_version;
use crate::backup::test_support::{make_database, run};
use crate::schedule::error::ScheduleError;
use crate::schedule::notice::Toast;
use crate::schedule::notifier::RecordingNotifier;
use crate::schedule::reminder::{
    next_fire, spec_of, status_of, Outcome, ReminderRow, ReminderStatus,
};
use crate::schedule::session::{SessionKind, SessionRow};
use crate::schedule::store::{self, DeliveryRow};
use crate::schedule::tick::{tick, Phase, TickReport};
use crate::schedule::worker::WakeSignal;
use crate::schedule::SchedulerCtx;
use crate::time::clock::{Clock, FixedClock};
use crate::time::formats::{format_instant, parse_instant};
use crate::time::recurrence::OccurrenceStart;
use jiff::Timestamp;
use sqlx::SqliteConnection;
use std::sync::Arc;
use std::time::Duration;
use tempfile::TempDir;

fn at(s: &str) -> Timestamp {
    parse_instant(s).expect("instant")
}

fn uuid(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012x}")
}

struct Fx {
    _dir: TempDir,
    ctx: SchedulerCtx,
    clock: Arc<FixedClock>,
    notifier: Arc<RecordingNotifier>,
}

impl Fx {
    fn new(now: &str) -> Self {
        let dir = TempDir::new().expect("tmp");
        let db = dir.path().join("homebase.db");
        make_database(&db, supported_schema_version(), false);
        let clock = Arc::new(FixedClock::new(at(now)));
        let notifier = Arc::new(RecordingNotifier::default());
        let ctx = SchedulerCtx {
            db,
            clock: clock.clone(),
            notifier: notifier.clone(),
            gate: tokio::sync::Mutex::new(()),
            busy_timeout: Duration::from_millis(200),
            signal: WakeSignal::default(),
        };
        Self {
            _dir: dir,
            ctx,
            clock,
            notifier,
        }
    }

    fn set(&self, now: &str) {
        self.clock.set(at(now));
    }

    fn toasts(&self) -> Vec<Toast> {
        self.notifier.shown.lock().expect("lock").clone()
    }

    async fn conn(&self) -> SqliteConnection {
        store::connect(&self.ctx.db).await.expect("connect")
    }

    async fn tick(&self) -> TickReport {
        tick(&self.ctx, Phase::Regular).await.expect("tick")
    }

    /// Inserts a reminder whose cache is computed at the current clock, like a creation.
    async fn add(&self, n: u32, start_local: &str, rrule: Option<&str>, exdates: &str) {
        self.add_titled(n, &format!("R{n}"), start_local, rrule, exdates)
            .await;
    }

    async fn add_titled(
        &self,
        n: u32,
        title: &str,
        start_local: &str,
        rrule: Option<&str>,
        exdates: &str,
    ) {
        let mut row = row_of(n, title, start_local, rrule, exdates);
        let spec = spec_of(&row).expect("spec");
        if let Some(next) = next_fire(&spec, self.clock.now()).expect("next") {
            let OccurrenceStart::Instant { at, .. } = next.start else {
                panic!("dated");
            };
            row.next_fire_at = Some(format_instant(at));
            row.next_fire_key = Some(next.key);
        }
        let mut conn = self.conn().await;
        store::insert_reminder(&mut conn, &row)
            .await
            .expect("insert");
        store::close(conn).await;
    }

    async fn reminder(&self, n: u32) -> ReminderRow {
        let mut conn = self.conn().await;
        let row = store::get_reminder(&mut conn, &uuid(n))
            .await
            .expect("get")
            .expect("row");
        store::close(conn).await;
        row
    }

    async fn delivery(&self, n: u32, key: &str) -> Option<DeliveryRow> {
        let mut conn = self.conn().await;
        let row = store::get_delivery(&mut conn, &uuid(n), key)
            .await
            .expect("get");
        store::close(conn).await;
        row
    }

    async fn deliveries(&self) -> usize {
        let mut conn = self.conn().await;
        let all = store::unseen_deliveries(&mut conn, 200)
            .await
            .expect("list");
        store::close(conn).await;
        all.len()
    }

    async fn add_session(&self, n: u32, kind: SessionKind, label: &str, started: &str, ends: &str) {
        let row = SessionRow {
            id: uuid(n),
            kind,
            label: label.to_owned(),
            started_at: started.to_owned(),
            ends_at: Some(ends.to_owned()),
            ended_at: None,
            end_reason: None,
            created_at: started.to_owned(),
            updated_at: started.to_owned(),
        };
        let mut conn = self.conn().await;
        store::insert_session(&mut conn, &row, 20)
            .await
            .expect("session");
        store::close(conn).await;
    }

    async fn session(&self, n: u32) -> SessionRow {
        let mut conn = self.conn().await;
        let row = store::get_session(&mut conn, &uuid(n))
            .await
            .expect("get")
            .expect("row");
        store::close(conn).await;
        row
    }
}

fn row_of(
    n: u32,
    title: &str,
    start_local: &str,
    rrule: Option<&str>,
    exdates: &str,
) -> ReminderRow {
    ReminderRow {
        id: uuid(n),
        title: title.to_owned(),
        start_local: start_local.to_owned(),
        time_zone: "Europe/Paris".to_owned(),
        rrule: rrule.map(str::to_owned),
        exdates: exdates.to_owned(),
        enabled: true,
        next_fire_at: None,
        next_fire_key: None,
        habit_id: None,
        created_at: "2026-11-01T00:00:00.000Z".to_owned(),
        updated_at: "2026-11-01T00:00:00.000Z".to_owned(),
    }
}

// ---------------------------------------------------------------------------------------------
// reminders
// ---------------------------------------------------------------------------------------------

#[test]
fn l1_l2_l3_a_one_off_reminder_fires_once_at_its_time() {
    let fx = Fx::new("2026-11-16T07:00:00.000Z");
    run(async {
        fx.add(1, "2026-11-16T09:00:00", None, "[]").await;
        fx.set("2026-11-16T07:59:59.999Z");
        let report = fx.tick().await;
        assert!(fx.toasts().is_empty());
        assert_eq!(report.next_due, Some(at("2026-11-16T08:00:00.000Z")));

        fx.set("2026-11-16T08:00:00.000Z");
        let report = fx.tick().await;
        assert_eq!(report.reminders_processed, 1);
        assert_eq!(report.toasts, 1);
        assert_eq!(report.next_due, None);
        assert_eq!(
            fx.toasts(),
            vec![Toast {
                title: "R1".to_owned(),
                body: "Prévu à 09:00".to_owned(),
                sound: "Reminder",
            }]
        );
        let delivery = fx
            .delivery(1, "2026-11-16T09:00:00")
            .await
            .expect("delivery");
        assert_eq!(delivery.outcome, Outcome::OnTime);
        assert_eq!(delivery.skipped_count, 0);
        assert_eq!(delivery.due_at, "2026-11-16T08:00:00.000Z");
        assert_eq!(delivery.created_at, "2026-11-16T08:00:00.000Z");
        let row = fx.reminder(1).await;
        assert_eq!(
            (row.next_fire_at.as_deref(), row.next_fire_key.as_deref()),
            (None, None)
        );
        assert_eq!(
            status_of(&row, at("2026-11-16T08:00:00.000Z")),
            ReminderStatus::Finished
        );

        // L2: a second pass at the same instant shows nothing.
        fx.tick().await;
        assert_eq!(fx.toasts().len(), 1);
        // L3: the clock goes back one hour: still nothing.
        fx.set("2026-11-16T07:00:00.000Z");
        fx.tick().await;
        fx.set("2026-11-16T08:00:00.000Z");
        fx.tick().await;
        assert_eq!(fx.toasts().len(), 1);
        assert_eq!(fx.deliveries().await, 1);
    });
}

#[test]
fn l5_a_week_offline_gives_one_late_notice_with_the_skipped_count() {
    let fx = Fx::new("2026-11-10T07:00:00.000Z");
    run(async {
        fx.add(1, "2026-11-10T09:00:00", Some("FREQ=DAILY"), "[]")
            .await;
        fx.set("2026-11-16T12:00:00.000Z");
        let report = fx.tick().await;
        assert_eq!(report.toasts, 1);
        assert_eq!(
            fx.toasts(),
            vec![Toast {
                title: "Rappel manqué : R1".to_owned(),
                body: "Prévu le 16/11 à 09:00 · 6 occurrences précédentes manquées".to_owned(),
                sound: "Reminder",
            }]
        );
        let delivery = fx
            .delivery(1, "2026-11-16T09:00:00")
            .await
            .expect("delivery");
        assert_eq!(delivery.outcome, Outcome::Late);
        assert_eq!(delivery.skipped_count, 6);
        let row = fx.reminder(1).await;
        assert_eq!(
            row.next_fire_at.as_deref(),
            Some("2026-11-17T08:00:00.000Z")
        );
        assert_eq!(row.next_fire_key.as_deref(), Some("2026-11-17T09:00:00"));
        assert_eq!(fx.deliveries().await, 1);
    });
}

#[test]
fn l6_an_old_one_off_is_recorded_missed_without_a_toast() {
    let fx = Fx::new("2026-11-01T07:00:00.000Z");
    run(async {
        fx.add(1, "2026-11-06T09:00:00", None, "[]").await;
        fx.set("2026-11-16T08:00:00.000Z");
        let report = fx.tick().await;
        assert_eq!(report.toasts, 0);
        assert!(fx.toasts().is_empty());
        let delivery = fx
            .delivery(1, "2026-11-06T09:00:00")
            .await
            .expect("delivery");
        assert_eq!(delivery.outcome, Outcome::Missed);
        assert_eq!(fx.reminder(1).await.next_fire_at, None);
    });
}

#[test]
fn l7_six_due_reminders_give_three_toasts_and_a_summary() {
    let fx = Fx::new("2026-11-16T07:00:00.000Z");
    run(async {
        for i in 0..6u32 {
            fx.add(i + 1, &format!("2026-11-16T09:0{i}:00"), None, "[]")
                .await;
        }
        // The first one is exactly 5 minutes late: still on time.
        fx.set("2026-11-16T08:05:00.000Z");
        let report = fx.tick().await;
        assert_eq!(report.reminders_processed, 6);
        assert_eq!(report.toasts, 4);
        let toasts = fx.toasts();
        let titles: Vec<&str> = toasts.iter().map(|t| t.title.as_str()).collect();
        assert_eq!(titles, ["R1", "R2", "R3", "Homebase"]);
        assert_eq!(
            toasts[3].body,
            "3 autres rappels. Ouvrez Homebase pour les voir."
        );
        assert_eq!(toasts[3].sound, "Default");
        assert_eq!(fx.deliveries().await, 6);
    });
}

#[test]
fn l8_the_autumn_fold_fires_once_then_waits_for_the_next_day() {
    let fx = Fx::new("2026-10-24T12:00:00.000Z");
    run(async {
        fx.add(1, "2026-10-24T02:30:00", Some("FREQ=DAILY"), "[]")
            .await;
        assert_eq!(
            fx.reminder(1).await.next_fire_at.as_deref(),
            Some("2026-10-25T00:30:00.000Z")
        );
        fx.set("2026-10-25T00:30:00.000Z");
        fx.tick().await;
        assert_eq!(fx.toasts().len(), 1);
        let row = fx.reminder(1).await;
        assert_eq!(
            row.next_fire_at.as_deref(),
            Some("2026-10-26T01:30:00.000Z")
        );
        // The repeated 02:30 (01:30Z) does not fire again.
        fx.set("2026-10-25T01:30:00.000Z");
        fx.tick().await;
        assert_eq!(fx.toasts().len(), 1);
        assert_eq!(fx.deliveries().await, 1);
    });
}

#[test]
fn l9_the_spring_gap_fires_at_the_shifted_instant_with_the_nominal_key() {
    let fx = Fx::new("2027-03-27T12:00:00.000Z");
    run(async {
        fx.add(1, "2027-03-27T02:30:00", Some("FREQ=DAILY"), "[]")
            .await;
        fx.set("2027-03-28T01:30:00.000Z");
        fx.tick().await;
        assert_eq!(fx.toasts().len(), 1);
        let delivery = fx
            .delivery(1, "2027-03-28T02:30:00")
            .await
            .expect("delivery");
        assert_eq!(delivery.due_at, "2027-03-28T01:30:00.000Z");
        assert_eq!(delivery.outcome, Outcome::OnTime);
    });
}

#[test]
fn l10_a_daily_nine_oclock_follows_the_offset_change() {
    let fx = Fx::new("2026-10-23T12:00:00.000Z");
    run(async {
        fx.add(1, "2026-10-24T09:00:00", Some("FREQ=DAILY"), "[]")
            .await;
        assert_eq!(
            fx.reminder(1).await.next_fire_at.as_deref(),
            Some("2026-10-24T07:00:00.000Z")
        );
        fx.set("2026-10-24T07:00:00.000Z");
        fx.tick().await;
        assert_eq!(
            fx.reminder(1).await.next_fire_at.as_deref(),
            Some("2026-10-25T08:00:00.000Z")
        );
        assert_eq!(fx.toasts().len(), 1);
    });
}

#[test]
fn l14_an_exception_on_the_next_occurrence_is_skipped() {
    let fx = Fx::new("2026-11-15T12:00:00.000Z");
    run(async {
        fx.add(
            1,
            "2026-11-10T09:00:00",
            Some("FREQ=DAILY"),
            r#"["2026-11-17T09:00:00"]"#,
        )
        .await;
        fx.set("2026-11-16T08:00:00.000Z");
        fx.tick().await;
        assert_eq!(fx.toasts().len(), 1);
        let row = fx.reminder(1).await;
        assert_eq!(
            row.next_fire_at.as_deref(),
            Some("2026-11-18T08:00:00.000Z")
        );
        assert_eq!(row.next_fire_key.as_deref(), Some("2026-11-18T09:00:00"));
    });
}

#[test]
fn l15_re_enabling_does_not_catch_up_the_disabled_period() {
    let fx = Fx::new("2026-11-10T07:00:00.000Z");
    run(async {
        fx.add(1, "2026-11-10T09:00:00", Some("FREQ=DAILY"), "[]")
            .await;
        // Disabled: the cache is cleared.
        let mut row = fx.reminder(1).await;
        row.enabled = false;
        row.next_fire_at = None;
        row.next_fire_key = None;
        let mut conn = fx.conn().await;
        assert!(store::replace_reminder(&mut conn, &row)
            .await
            .expect("disable"));
        store::close(conn).await;
        fx.set("2026-11-13T12:00:00.000Z");
        fx.tick().await;
        assert_eq!(fx.deliveries().await, 0);
        // Re-enabled three days later: the cache restarts from "now".
        row.enabled = true;
        let spec = spec_of(&row).expect("spec");
        let next = next_fire(&spec, at("2026-11-13T12:00:00.000Z"))
            .expect("next")
            .expect("some");
        let OccurrenceStart::Instant { at: when, .. } = next.start else {
            panic!("dated");
        };
        row.next_fire_at = Some(format_instant(when));
        row.next_fire_key = Some(next.key);
        let mut conn = fx.conn().await;
        assert!(store::replace_reminder(&mut conn, &row)
            .await
            .expect("enable"));
        store::close(conn).await;
        let report = fx.tick().await;
        assert_eq!(report.reminders_processed, 0);
        assert_eq!(fx.deliveries().await, 0);
        assert!(fx.toasts().is_empty());
    });
}

#[test]
fn l16_a_finished_series_has_no_cache() {
    let fx = Fx::new("2026-11-16T07:00:00.000Z");
    run(async {
        fx.add(1, "2026-11-16T09:00:00", Some("FREQ=DAILY;COUNT=2"), "[]")
            .await;
        fx.add(
            2,
            "2026-11-16T09:00:00",
            Some("FREQ=DAILY;UNTIL=20261117T225959Z"),
            "[]",
        )
        .await;
        fx.set("2026-11-16T08:00:00.000Z");
        fx.tick().await;
        fx.set("2026-11-17T08:00:00.000Z");
        let report = fx.tick().await;
        assert_eq!(report.next_due, None);
        for n in [1, 2] {
            let row = fx.reminder(n).await;
            assert_eq!(row.next_fire_at, None);
            assert_eq!(
                status_of(&row, at("2026-11-17T08:00:00.000Z")),
                ReminderStatus::Finished
            );
        }
        assert_eq!(fx.toasts().len(), 4);
    });
}

#[test]
fn l17_an_invalid_line_is_ignored_and_the_others_still_fire() {
    let fx = Fx::new("2026-11-16T07:00:00.000Z");
    run(async {
        fx.add(1, "2026-11-16T09:00:00", None, "[]").await;
        // Written outside the Rust: passes the SQL checks, not the rule parser.
        let mut bad = row_of(
            2,
            "Broken",
            "2026-11-16T09:00:00",
            Some("FREQ=BOGUS;INTERVAL=1"),
            "[]",
        );
        bad.next_fire_at = Some("2026-11-16T08:00:00.000Z".to_owned());
        bad.next_fire_key = Some("2026-11-16T09:00:00".to_owned());
        let mut conn = fx.conn().await;
        store::insert_reminder(&mut conn, &bad)
            .await
            .expect("insert");
        store::close(conn).await;

        fx.set("2026-11-16T08:00:00.000Z");
        let report = fx.tick().await;
        assert_eq!(report.invalid, 1);
        assert_eq!(report.reminders_processed, 1);
        assert_eq!(fx.toasts().len(), 1);
        assert_eq!(fx.toasts()[0].title, "R1");
        let row = fx.reminder(2).await;
        assert_eq!(row.next_fire_at, None);
        assert_eq!(
            status_of(&row, at("2026-11-16T08:00:00.000Z")),
            ReminderStatus::Invalid
        );
        // A later pass leaves it alone.
        let report = fx.tick().await;
        assert_eq!(report.invalid, 0);
    });
}

#[test]
fn startup_recomputes_a_wrong_cache_and_regular_does_not() {
    let fx = Fx::new("2026-11-16T12:00:00.000Z");
    run(async {
        fx.add(1, "2026-11-10T09:00:00", Some("FREQ=DAILY"), "[]")
            .await;
        let wrong = (
            Some("2026-11-20T08:00:00.000Z".to_owned()),
            Some("2026-11-20T09:00:00".to_owned()),
        );
        let mut row = fx.reminder(1).await;
        row.next_fire_at = wrong.0.clone();
        row.next_fire_key = wrong.1.clone();
        let mut conn = fx.conn().await;
        assert!(store::replace_reminder(&mut conn, &row)
            .await
            .expect("write"));
        store::close(conn).await;

        fx.tick().await;
        let kept = fx.reminder(1).await;
        assert_eq!((kept.next_fire_at, kept.next_fire_key), wrong);

        let report = tick(&fx.ctx, Phase::Startup).await.expect("tick");
        let fixed = fx.reminder(1).await;
        assert_eq!(
            fixed.next_fire_at.as_deref(),
            Some("2026-11-17T08:00:00.000Z")
        );
        assert_eq!(fixed.next_fire_key.as_deref(), Some("2026-11-17T09:00:00"));
        assert_eq!(report.next_due, Some(at("2026-11-17T08:00:00.000Z")));
        assert!(fx.toasts().is_empty());
    });
}

// ---------------------------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------------------------

#[test]
fn l20_a_timer_ended_while_the_app_was_closed_completes_at_its_own_end() {
    let fx = Fx::new("2026-11-16T10:00:00.000Z");
    run(async {
        fx.add_session(
            1,
            SessionKind::Countdown,
            "",
            "2026-11-16T10:00:00.000Z",
            "2026-11-16T10:25:00.000Z",
        )
        .await;
        fx.set("2026-11-16T12:25:00.000Z");
        let report = fx.tick().await;
        assert_eq!(report.sessions_completed, 1);
        let row = fx.session(1).await;
        assert_eq!(row.ended_at.as_deref(), Some("2026-11-16T10:25:00.000Z"));
        assert_eq!(row.end_reason.as_deref(), Some("completed"));
        assert_eq!(
            fx.toasts(),
            vec![Toast {
                title: "Minuteur terminé pendant l'absence".to_owned(),
                body: "Minuteur de 25 min · il y a 2 h".to_owned(),
                sound: "Alarm",
            }]
        );
        // Once only.
        fx.tick().await;
        assert_eq!(fx.toasts().len(), 1);
    });
}

#[test]
fn sessions_on_time_beyond_the_window_and_stopwatches() {
    let fx = Fx::new("2026-11-01T08:00:00.000Z");
    run(async {
        // Very old: completed, no toast.
        fx.add_session(
            1,
            SessionKind::Countdown,
            "Old",
            "2026-11-01T08:00:00.000Z",
            "2026-11-01T08:10:00.000Z",
        )
        .await;
        fx.add_session(
            2,
            SessionKind::PomodoroWork,
            "",
            "2026-11-16T07:35:00.000Z",
            "2026-11-16T08:00:00.000Z",
        )
        .await;
        // A stopwatch is never completed by a pass.
        let mut conn = fx.conn().await;
        let stopwatch = SessionRow {
            id: uuid(3),
            kind: SessionKind::Stopwatch,
            label: String::new(),
            started_at: "2026-11-01T08:00:00.000Z".to_owned(),
            ends_at: None,
            ended_at: None,
            end_reason: None,
            created_at: "2026-11-01T08:00:00.000Z".to_owned(),
            updated_at: "2026-11-01T08:00:00.000Z".to_owned(),
        };
        store::insert_session(&mut conn, &stopwatch, 20)
            .await
            .expect("insert");
        store::close(conn).await;

        fx.set("2026-11-16T08:00:00.000Z");
        let report = fx.tick().await;
        assert_eq!(report.sessions_completed, 2);
        assert_eq!(fx.session(1).await.end_reason.as_deref(), Some("completed"));
        assert_eq!(fx.session(3).await.ended_at, None);
        assert_eq!(
            fx.toasts(),
            vec![Toast {
                title: "Pomodoro terminé".to_owned(),
                body: "C'est l'heure de la pause.".to_owned(),
                sound: "Alarm",
            }]
        );
    });
}

#[test]
fn next_due_is_the_minimum_of_both_tables_and_an_empty_base_is_fine() {
    let fx = Fx::new("2026-11-16T12:00:00.000Z");
    run(async {
        let report = fx.tick().await;
        assert_eq!(
            report,
            TickReport {
                now: report.now,
                ..TickReport::default()
            }
        );
        fx.add(1, "2026-11-10T09:00:00", Some("FREQ=DAILY"), "[]")
            .await;
        assert_eq!(
            fx.tick().await.next_due,
            Some(at("2026-11-17T08:00:00.000Z"))
        );
        fx.add_session(
            2,
            SessionKind::Countdown,
            "x",
            "2026-11-16T12:00:00.000Z",
            "2026-11-16T13:00:00.000Z",
        )
        .await;
        assert_eq!(
            fx.tick().await.next_due,
            Some(at("2026-11-16T13:00:00.000Z"))
        );
    });
}

// ---------------------------------------------------------------------------------------------
// L35: busy database
// ---------------------------------------------------------------------------------------------

#[test]
fn l35_a_busy_database_fails_the_pass_without_partial_writes_then_recovers() {
    let fx = Fx::new("2026-11-16T07:00:00.000Z");
    run(async {
        fx.add(1, "2026-11-16T09:00:00", None, "[]").await;
        fx.set("2026-11-16T08:00:00.000Z");

        // Another connection holds the write lock.
        let mut holder = fx.conn().await;
        sqlx::query("BEGIN IMMEDIATE")
            .execute(&mut holder)
            .await
            .expect("lock");
        let result = tick(&fx.ctx, Phase::Regular).await;
        assert_eq!(result, Err(ScheduleError::Busy));
        assert!(fx.toasts().is_empty());
        sqlx::query("ROLLBACK")
            .execute(&mut holder)
            .await
            .expect("release");
        store::close(holder).await;
        assert_eq!(fx.deliveries().await, 0);
        assert_eq!(
            fx.reminder(1).await.next_fire_at.as_deref(),
            Some("2026-11-16T08:00:00.000Z")
        );

        // The retry succeeds.
        fx.tick().await;
        assert_eq!(fx.toasts().len(), 1);
        assert_eq!(fx.deliveries().await, 1);
    });
}

// ---------------------------------------------------------------------------------------------
// S5: no deadlock with a task holding the gate
// ---------------------------------------------------------------------------------------------

#[test]
fn a_pass_waits_for_the_gate_without_deadlock() {
    let fx = Fx::new("2026-11-16T12:00:00.000Z");
    let ctx = &fx.ctx;
    std::thread::scope(|scope| {
        let (held, is_held) = std::sync::mpsc::channel::<()>();
        scope.spawn(move || {
            run(async {
                let _gate = ctx.gate.lock().await;
                held.send(()).expect("signal");
                std::thread::sleep(std::time::Duration::from_millis(200));
            });
        });
        is_held.recv().expect("gate held");
        let start = std::time::Instant::now();
        let report = run(tick(ctx, Phase::Regular)).expect("tick");
        assert_eq!(
            report,
            TickReport {
                now: report.now,
                ..TickReport::default()
            }
        );
        assert!(start.elapsed() >= std::time::Duration::from_millis(100));
    });
}

#[test]
fn toasts_of_committed_deliveries_survive_a_later_error() {
    let fx = Fx::new("2026-11-16T07:00:00.000Z");
    run(async {
        fx.add(1, "2026-11-16T09:00:00", None, "[]").await;
        fx.add(2, "2026-11-16T09:01:00", None, "[]").await;
        let mut conn = fx.conn().await;
        sqlx::query(&format!(
            "CREATE TRIGGER boom BEFORE UPDATE ON reminders WHEN NEW.id = '{}' \
             BEGIN SELECT RAISE(ABORT, 'x'); END",
            uuid(2)
        ))
        .execute(&mut conn)
        .await
        .expect("trigger");
        store::close(conn).await;

        fx.set("2026-11-16T08:02:00.000Z");
        // A line in error no longer fails the pass: the others are still delivered.
        tick(&fx.ctx, Phase::Regular).await.expect("tick");
        let toasts = fx.toasts();
        assert_eq!(toasts.len(), 1);
        assert_eq!(toasts[0].title, "R1");
        assert_eq!(fx.deliveries().await, 1);
        assert!(fx.delivery(1, "2026-11-16T09:00:00").await.is_some());
    });
}

#[test]
fn a_failing_reminder_does_not_block_the_next_ones() {
    let fx = Fx::new("2026-11-16T07:00:00.000Z");
    run(async {
        // Reminder 1 is due first and always fails; reminder 2 must still be delivered.
        fx.add(1, "2026-11-16T09:00:00", None, "[]").await;
        fx.add(2, "2026-11-16T09:01:00", None, "[]").await;
        let mut conn = fx.conn().await;
        sqlx::query(&format!(
            "CREATE TRIGGER boom BEFORE UPDATE ON reminders WHEN NEW.id = '{}' \
             BEGIN SELECT RAISE(ABORT, 'x'); END",
            uuid(1)
        ))
        .execute(&mut conn)
        .await
        .expect("trigger");
        store::close(conn).await;

        fx.set("2026-11-16T08:02:00.000Z");
        let report = tick(&fx.ctx, Phase::Regular).await.expect("tick");
        assert_eq!(report.reminders_processed, 1);
        let toasts = fx.toasts();
        assert_eq!(toasts.len(), 1);
        assert_eq!(toasts[0].title, "R2");
        assert!(fx.delivery(1, "2026-11-16T09:00:00").await.is_none());
        assert!(fx.delivery(2, "2026-11-16T09:01:00").await.is_some());
    });
}

#[test]
fn l3_full_a_clock_set_back_and_a_startup_pass_never_double_notify() {
    let fx = Fx::new("2026-11-16T07:00:00.000Z");
    run(async {
        fx.add(1, "2026-11-16T09:00:00", None, "[]").await;
        fx.set("2026-11-16T08:00:00.000Z");
        fx.tick().await;
        assert_eq!(fx.toasts().len(), 1);
        assert_eq!(fx.reminder(1).await.next_fire_at, None);

        // The clock goes back: the startup pass puts the occurrence back in the cache.
        fx.set("2026-11-16T07:00:00.000Z");
        tick(&fx.ctx, Phase::Startup).await.expect("startup");
        let row = fx.reminder(1).await;
        assert_eq!(
            row.next_fire_at.as_deref(),
            Some("2026-11-16T08:00:00.000Z")
        );
        assert_eq!(row.next_fire_key.as_deref(), Some("2026-11-16T09:00:00"));

        // It fires again, but the delivery key stops the second toast.
        fx.set("2026-11-16T08:00:00.000Z");
        fx.tick().await;
        assert_eq!(fx.toasts().len(), 1);
        assert_eq!(fx.deliveries().await, 1);
        assert_eq!(fx.reminder(1).await.next_fire_at, None);
    });
}

#[test]
fn startup_computes_a_null_cache_and_clears_an_invalid_line() {
    let fx = Fx::new("2026-11-16T12:00:00.000Z");
    run(async {
        let mut conn = fx.conn().await;
        let empty = row_of(1, "Empty", "2026-11-10T09:00:00", Some("FREQ=DAILY"), "[]");
        store::insert_reminder(&mut conn, &empty)
            .await
            .expect("insert");
        let mut bad = row_of(
            2,
            "Bad",
            "2026-11-10T09:00:00",
            Some("FREQ=BOGUS;INTERVAL=1"),
            "[]",
        );
        bad.next_fire_at = Some("2026-11-20T08:00:00.000Z".to_owned());
        bad.next_fire_key = Some("2026-11-20T09:00:00".to_owned());
        store::insert_reminder(&mut conn, &bad)
            .await
            .expect("insert");
        store::close(conn).await;

        let report = tick(&fx.ctx, Phase::Startup).await.expect("startup");
        assert_eq!(report.invalid, 1);
        let computed = fx.reminder(1).await;
        assert_eq!(
            computed.next_fire_at.as_deref(),
            Some("2026-11-17T08:00:00.000Z")
        );
        assert_eq!(
            computed.next_fire_key.as_deref(),
            Some("2026-11-17T09:00:00")
        );
        assert_eq!(fx.reminder(2).await.next_fire_at, None);
        assert_eq!(report.next_due, Some(at("2026-11-17T08:00:00.000Z")));
        assert!(fx.toasts().is_empty());
    });
}
