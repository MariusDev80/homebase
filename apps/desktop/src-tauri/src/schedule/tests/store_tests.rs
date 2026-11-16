//! SQL storage on a real V7 database (spec 6.1, `store_tests`): temporary file migrated by
//! `make_database(path, 7, false)`.

use crate::backup::test_support::{make_database, run};
use crate::schedule::error::ScheduleError;
use crate::schedule::reminder::{Outcome, ReminderRow};
use crate::schedule::session::{SessionKind, SessionRow};
use crate::schedule::store::{self, DeliveryRow, HistoryCursor, SeenTarget};
use sqlx::SqliteConnection;
use tempfile::TempDir;

const AT: &str = "2026-11-01T00:00:00.000Z";
const DUE: &str = "2026-11-16T08:00:00.000Z";
const KEY: &str = "2026-11-16T09:00:00";

fn uuid(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012x}")
}

fn db() -> (TempDir, std::path::PathBuf) {
    let dir = TempDir::new().expect("tmp");
    let path = dir.path().join("homebase.db");
    make_database(&path, 7, false);
    (dir, path)
}

fn reminder(n: u32) -> ReminderRow {
    ReminderRow {
        id: uuid(n),
        title: format!("Rappel {n}"),
        start_local: "2026-11-01T09:00:00".to_owned(),
        time_zone: "Europe/Paris".to_owned(),
        rrule: Some("FREQ=DAILY".to_owned()),
        exdates: "[]".to_owned(),
        enabled: true,
        next_fire_at: Some(DUE.to_owned()),
        next_fire_key: Some(KEY.to_owned()),
        created_at: AT.to_owned(),
        updated_at: AT.to_owned(),
    }
}

fn countdown(n: u32, started: &str, ends: &str) -> SessionRow {
    SessionRow {
        id: uuid(n),
        kind: SessionKind::Countdown,
        label: format!("Minuteur {n}"),
        started_at: started.to_owned(),
        ends_at: Some(ends.to_owned()),
        ended_at: None,
        end_reason: None,
        created_at: started.to_owned(),
        updated_at: started.to_owned(),
    }
}

fn stopwatch(n: u32) -> SessionRow {
    SessionRow {
        kind: SessionKind::Stopwatch,
        ends_at: None,
        ..countdown(n, "2026-11-16T07:00:00.000Z", "2026-11-16T07:10:00.000Z")
    }
}

fn delivery(reminder_id: &str, key: &str, created_at: &str) -> DeliveryRow {
    DeliveryRow {
        reminder_id: reminder_id.to_owned(),
        occurrence_key: key.to_owned(),
        due_at: DUE.to_owned(),
        outcome: Outcome::Late,
        skipped_count: 6,
        seen_at: None,
        created_at: created_at.to_owned(),
        updated_at: created_at.to_owned(),
    }
}

async fn connect(path: &std::path::Path) -> SqliteConnection {
    store::connect(path).await.expect("connect")
}

/// Runs raw SQL and returns whether the database refused it with a constraint error.
async fn refused(conn: &mut SqliteConnection, sql: &str) -> bool {
    match sqlx::query(sql).execute(conn).await {
        Ok(_) => false,
        Err(e) => e.as_database_error().is_some_and(|d| {
            d.code()
                .is_some_and(|c| c.parse::<i64>().is_ok_and(|c| c & 0xFF == 19))
        }),
    }
}

#[test]
fn reminder_round_trip_replace_and_delete() {
    let (_dir, path) = db();
    run(async {
        let mut conn = connect(&path).await;
        let mut r = reminder(1);
        r.rrule = None;
        r.exdates = r#"["2026-11-17T09:00:00"]"#.to_owned();
        store::insert_reminder(&mut conn, &r).await.expect("insert");
        assert_eq!(
            store::get_reminder(&mut conn, &r.id).await.expect("get"),
            Some(r.clone())
        );
        assert_eq!(store::count_reminders(&mut conn).await.expect("count"), 1);

        let mut edited = r.clone();
        edited.title = "Autre".to_owned();
        edited.enabled = false;
        edited.next_fire_at = None;
        edited.next_fire_key = None;
        edited.created_at = "2030-01-01T00:00:00.000Z".to_owned(); // must be ignored
        edited.updated_at = "2026-11-02T00:00:00.000Z".to_owned();
        assert!(store::replace_reminder(&mut conn, &edited)
            .await
            .expect("replace"));
        let stored = store::get_reminder(&mut conn, &r.id)
            .await
            .expect("get")
            .expect("row");
        assert_eq!(stored.created_at, AT);
        assert_eq!(
            stored,
            ReminderRow {
                created_at: AT.to_owned(),
                ..edited
            }
        );
        assert!(!store::replace_reminder(&mut conn, &reminder(9))
            .await
            .expect("absent"));

        assert!(store::delete_reminder(&mut conn, &r.id).await.expect("del"));
        assert!(!store::delete_reminder(&mut conn, &r.id).await.expect("del"));
        assert_eq!(
            store::get_reminder(&mut conn, &r.id).await.expect("get"),
            None
        );
        store::close(conn).await;
    });
}

#[test]
fn duplicate_reminder_id_is_a_conflict() {
    let (_dir, path) = db();
    run(async {
        let mut conn = connect(&path).await;
        store::insert_reminder(&mut conn, &reminder(1))
            .await
            .expect("insert");
        assert_eq!(
            store::insert_reminder(&mut conn, &reminder(1)).await,
            Err(ScheduleError::Conflict)
        );
        store::close(conn).await;
    });
}

#[test]
fn list_orders_scheduled_first_then_by_title() {
    let (_dir, path) = db();
    run(async {
        let mut conn = connect(&path).await;
        let mut a = reminder(1);
        a.title = "zebre".to_owned();
        a.next_fire_at = Some("2026-11-20T08:00:00.000Z".to_owned());
        let mut b = reminder(2);
        b.title = "Alpha".to_owned();
        b.next_fire_at = Some("2026-11-18T08:00:00.000Z".to_owned());
        let mut c = reminder(3);
        c.title = "beta".to_owned();
        c.enabled = false;
        c.next_fire_at = None;
        c.next_fire_key = None;
        let mut d = reminder(4);
        d.title = "Alef".to_owned();
        d.enabled = false;
        d.next_fire_at = None;
        d.next_fire_key = None;
        for r in [&a, &b, &c, &d] {
            store::insert_reminder(&mut conn, r).await.expect("insert");
        }
        let ids: Vec<String> = store::list_reminders(&mut conn)
            .await
            .expect("list")
            .into_iter()
            .map(|r| r.id)
            .collect();
        assert_eq!(ids, [b.id, a.id, d.id, c.id]);
        store::close(conn).await;
    });
}

#[test]
fn due_reminders_selects_enabled_cached_rows_up_to_now() {
    let (_dir, path) = db();
    run(async {
        let mut conn = connect(&path).await;
        let mut early = reminder(1);
        early.next_fire_at = Some("2026-11-15T08:00:00.000Z".to_owned());
        let on_the_dot = reminder(2); // DUE
        let mut later = reminder(3);
        later.next_fire_at = Some("2026-11-16T08:00:00.001Z".to_owned());
        let mut disabled = reminder(4);
        disabled.enabled = false;
        disabled.next_fire_at = None;
        disabled.next_fire_key = None;
        for r in [&early, &on_the_dot, &later, &disabled] {
            store::insert_reminder(&mut conn, r).await.expect("insert");
        }
        let due = store::due_reminders(&mut conn, DUE, 10).await.expect("due");
        assert_eq!(
            due.iter().map(|r| r.id.clone()).collect::<Vec<_>>(),
            [early.id.clone(), on_the_dot.id.clone()]
        );
        let limited = store::due_reminders(&mut conn, DUE, 1).await.expect("due");
        assert_eq!(limited.len(), 1);
        assert_eq!(
            store::enabled_reminders(&mut conn)
                .await
                .expect("enabled")
                .len(),
            3
        );
        store::close(conn).await;
    });
}

#[test]
fn write_cache_is_a_compare_and_write_that_leaves_updated_at_alone() {
    let (_dir, path) = db();
    run(async {
        let mut conn = connect(&path).await;
        let r = reminder(1);
        store::insert_reminder(&mut conn, &r).await.expect("insert");
        let next = Some(("2026-11-17T08:00:00.000Z", "2026-11-17T09:00:00"));
        assert_eq!(
            store::write_cache(&mut conn, &r.id, Some("2026-01-01T00:00:00.000Z"), next)
                .await
                .expect("stale"),
            0
        );
        assert_eq!(
            store::write_cache(&mut conn, &r.id, Some(DUE), next)
                .await
                .expect("write"),
            1
        );
        let stored = store::get_reminder(&mut conn, &r.id)
            .await
            .expect("get")
            .expect("row");
        assert_eq!(stored.next_fire_at.as_deref(), next.map(|n| n.0));
        assert_eq!(stored.next_fire_key.as_deref(), next.map(|n| n.1));
        assert_eq!(stored.updated_at, AT);
        // Clearing the cache: expected is the current value, new value is NULL.
        assert_eq!(
            store::write_cache(&mut conn, &r.id, next.map(|n| n.0), None)
                .await
                .expect("clear"),
            1
        );
        // Writing over a NULL cache matches `IS NULL`.
        assert_eq!(
            store::write_cache(&mut conn, &r.id, None, next)
                .await
                .expect("refill"),
            1
        );
        store::close(conn).await;
    });
}

#[test]
fn record_firing_inserts_once_and_advances_the_cache() {
    let (_dir, path) = db();
    run(async {
        let mut conn = connect(&path).await;
        let r = reminder(1);
        store::insert_reminder(&mut conn, &r).await.expect("insert");
        let d = delivery(&r.id, KEY, "2026-11-16T08:00:01.000Z");
        let next = Some(("2026-11-17T08:00:00.000Z", "2026-11-17T09:00:00"));

        assert!(
            store::record_firing(&mut conn, &r.id, Some(DUE), Some(&d), next)
                .await
                .expect("first")
        );
        assert_eq!(
            store::get_delivery(&mut conn, &r.id, KEY)
                .await
                .expect("get"),
            Some(d.clone())
        );
        let after = store::get_reminder(&mut conn, &r.id)
            .await
            .expect("get")
            .expect("row");
        assert_eq!(after.next_fire_at.as_deref(), next.map(|n| n.0));
        assert_eq!(after.updated_at, AT);

        // The same occurrence again (cache restored by hand): ON CONFLICT DO NOTHING, no toast.
        store::write_cache(&mut conn, &r.id, next.map(|n| n.0), Some((DUE, KEY)))
            .await
            .expect("rewind");
        assert!(
            !store::record_firing(&mut conn, &r.id, Some(DUE), Some(&d), next)
                .await
                .expect("second")
        );
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM reminder_deliveries")
            .fetch_one(&mut conn)
            .await
            .expect("count");
        assert_eq!(count, 1);
        store::close(conn).await;
    });
}

#[test]
fn record_firing_writes_nothing_when_the_cache_moved() {
    let (_dir, path) = db();
    run(async {
        let mut conn = connect(&path).await;
        let r = reminder(1);
        store::insert_reminder(&mut conn, &r).await.expect("insert");
        let d = delivery(&r.id, KEY, "2026-11-16T08:00:01.000Z");
        assert!(!store::record_firing(
            &mut conn,
            &r.id,
            Some("2026-01-01T00:00:00.000Z"),
            Some(&d),
            None
        )
        .await
        .expect("stale"));
        assert_eq!(
            store::get_delivery(&mut conn, &r.id, KEY)
                .await
                .expect("get"),
            None
        );
        // Without a delivery the cache still advances, and no toast is due.
        assert!(
            !store::record_firing(&mut conn, &r.id, Some(DUE), None, None)
                .await
                .expect("cache only")
        );
        let stored = store::get_reminder(&mut conn, &r.id)
            .await
            .expect("get")
            .expect("row");
        assert_eq!(stored.next_fire_at, None);
        store::close(conn).await;
    });
}

#[test]
fn unseen_deliveries_mark_seen_and_cascade() {
    let (_dir, path) = db();
    run(async {
        let mut conn = connect(&path).await;
        let r = reminder(1);
        store::insert_reminder(&mut conn, &r).await.expect("insert");
        let keys = [
            ("2026-11-14T09:00:00", "2026-11-14T08:00:01.000Z"),
            ("2026-11-15T09:00:00", "2026-11-15T08:00:01.000Z"),
            ("2026-11-16T09:00:00", "2026-11-16T08:00:01.000Z"),
        ];
        for (key, created) in keys {
            let d = delivery(&r.id, key, created);
            store::record_firing(&mut conn, &r.id, Some(DUE), Some(&d), Some((DUE, KEY)))
                .await
                .expect("firing");
        }
        let unseen = store::unseen_deliveries(&mut conn, 10)
            .await
            .expect("unseen");
        assert_eq!(
            unseen
                .iter()
                .map(|u| u.occurrence_key.as_str())
                .collect::<Vec<_>>(),
            [
                "2026-11-16T09:00:00",
                "2026-11-15T09:00:00",
                "2026-11-14T09:00:00"
            ]
        );
        assert_eq!(unseen[0].title, "Rappel 1");
        assert_eq!(unseen[0].time_zone, "Europe/Paris");
        assert_eq!(unseen[0].outcome, Outcome::Late);
        assert_eq!(unseen[0].skipped_count, 6);
        assert_eq!(
            store::unseen_deliveries(&mut conn, 2)
                .await
                .expect("limit")
                .len(),
            2
        );

        let now = "2026-11-16T10:00:00.000Z";
        assert_eq!(
            store::mark_seen(
                &mut conn,
                SeenTarget::One {
                    reminder_id: &r.id,
                    occurrence_key: "2026-11-15T09:00:00"
                },
                now
            )
            .await
            .expect("one"),
            1
        );
        let seen = store::get_delivery(&mut conn, &r.id, "2026-11-15T09:00:00")
            .await
            .expect("get")
            .expect("row");
        assert_eq!(seen.seen_at.as_deref(), Some(now));
        assert_eq!(seen.updated_at, now);
        assert_eq!(
            store::mark_seen(&mut conn, SeenTarget::All, now)
                .await
                .expect("all"),
            2
        );
        assert_eq!(
            store::mark_seen(&mut conn, SeenTarget::All, now)
                .await
                .expect("again"),
            0
        );
        assert!(store::unseen_deliveries(&mut conn, 10)
            .await
            .expect("unseen")
            .is_empty());

        assert!(store::delete_reminder(&mut conn, &r.id).await.expect("del"));
        let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM reminder_deliveries")
            .fetch_one(&mut conn)
            .await
            .expect("count");
        assert_eq!(left, 0);
        store::close(conn).await;
    });
}

#[test]
fn a_delivery_for_a_deleted_reminder_writes_nothing() {
    let (_dir, path) = db();
    run(async {
        let mut conn = connect(&path).await;
        let d = delivery(&uuid(77), KEY, AT);
        // The compare-and-write matches no row: rollback, no delivery, no toast.
        assert_eq!(
            store::record_firing(&mut conn, &uuid(77), None, Some(&d), None).await,
            Ok(false)
        );
        store::close(conn).await;
    });
}

#[test]
fn session_round_trip_complete_stop_rename_delete() {
    let (_dir, path) = db();
    run(async {
        let mut conn = connect(&path).await;
        let timer = countdown(1, "2026-11-16T07:00:00.000Z", "2026-11-16T07:10:00.000Z");
        let watch = stopwatch(2);
        store::insert_session(&mut conn, &timer, 20)
            .await
            .expect("timer");
        store::insert_session(&mut conn, &watch, 20)
            .await
            .expect("watch");
        assert_eq!(
            store::get_session(&mut conn, &timer.id).await.expect("get"),
            Some(timer.clone())
        );
        assert_eq!(
            store::insert_session(&mut conn, &timer, 20).await,
            Err(ScheduleError::Conflict)
        );
        let running = store::list_running_sessions(&mut conn)
            .await
            .expect("running");
        assert_eq!(running.len(), 2);

        // Not due yet, then due.
        assert!(
            store::due_sessions(&mut conn, "2026-11-16T07:09:59.999Z", 10)
                .await
                .expect("due")
                .is_empty()
        );
        let due = store::due_sessions(&mut conn, "2026-11-16T07:10:00.000Z", 10)
            .await
            .expect("due");
        assert_eq!(due, vec![timer.clone()]);

        let now = "2026-11-16T09:00:00.000Z";
        assert!(store::complete_session(&mut conn, &timer.id, now)
            .await
            .expect("complete"));
        assert!(!store::complete_session(&mut conn, &timer.id, now)
            .await
            .expect("again"));
        let done = store::get_session(&mut conn, &timer.id)
            .await
            .expect("get")
            .expect("row");
        assert_eq!(done.ended_at, timer.ends_at);
        assert_eq!(done.end_reason.as_deref(), Some("completed"));
        assert_eq!(done.updated_at, now);

        // A stopwatch is never completed by the scheduler.
        assert!(!store::complete_session(&mut conn, &watch.id, now)
            .await
            .expect("stopwatch"));
        assert!(store::stop_session(&mut conn, &watch.id, now, now)
            .await
            .expect("stop"));
        assert!(!store::stop_session(&mut conn, &watch.id, now, now)
            .await
            .expect("stop twice"));
        let stopped = store::get_session(&mut conn, &watch.id)
            .await
            .expect("get")
            .expect("row");
        assert_eq!(stopped.end_reason.as_deref(), Some("stopped"));
        assert_eq!(stopped.ended_at.as_deref(), Some(now));

        assert!(store::rename_session(&mut conn, &watch.id, "Nouveau", now)
            .await
            .expect("rename"));
        assert!(!store::rename_session(&mut conn, &uuid(50), "x", now)
            .await
            .expect("absent"));
        assert!(store::delete_session(&mut conn, &watch.id)
            .await
            .expect("del"));
        assert!(!store::delete_session(&mut conn, &watch.id)
            .await
            .expect("del"));
        store::close(conn).await;
    });
}

#[test]
fn running_sessions_are_capped_and_a_single_pomodoro_runs() {
    let (_dir, path) = db();
    run(async {
        let mut conn = connect(&path).await;
        for n in 1..=3 {
            store::insert_session(&mut conn, &stopwatch(n), 3)
                .await
                .expect("insert");
        }
        assert_eq!(
            store::insert_session(&mut conn, &stopwatch(4), 3).await,
            Err(ScheduleError::LimitReached)
        );
        assert_eq!(
            store::list_running_sessions(&mut conn)
                .await
                .expect("l")
                .len(),
            3
        );

        let pomodoro = |n| SessionRow {
            kind: SessionKind::PomodoroWork,
            ..countdown(n, "2026-11-16T07:00:00.000Z", "2026-11-16T07:25:00.000Z")
        };
        store::insert_session(&mut conn, &pomodoro(10), 20)
            .await
            .expect("first pomodoro");
        assert_eq!(
            store::insert_session(&mut conn, &pomodoro(11), 20).await,
            Err(ScheduleError::AlreadyRunning)
        );
        // A countdown is not a pomodoro.
        store::insert_session(
            &mut conn,
            &countdown(12, AT, "2026-11-01T00:10:00.000Z"),
            20,
        )
        .await
        .expect("countdown");
        // Once finished, the next pomodoro may start.
        store::stop_session(&mut conn, &uuid(10), AT, AT)
            .await
            .expect("stop");
        store::insert_session(&mut conn, &pomodoro(13), 20)
            .await
            .expect("next pomodoro");
        store::close(conn).await;
    });
}

#[test]
fn history_is_newest_first_with_a_keyset_cursor() {
    let (_dir, path) = db();
    run(async {
        let mut conn = connect(&path).await;
        // Two sessions share a start instant: the id breaks the tie (descending).
        let starts = [
            (1, "2026-11-10T07:00:00.000Z"),
            (2, "2026-11-11T07:00:00.000Z"),
            (3, "2026-11-11T07:00:00.000Z"),
            (4, "2026-11-12T07:00:00.000Z"),
        ];
        for (n, started) in starts {
            let row = countdown(n, started, &started.replace("07:00", "07:05"));
            store::insert_session(&mut conn, &row, 20)
                .await
                .expect("insert");
            store::stop_session(&mut conn, &row.id, started, started)
                .await
                .expect("stop");
        }
        // A running session never appears in the history.
        store::insert_session(&mut conn, &stopwatch(9), 20)
            .await
            .expect("running");

        let ids = |rows: Vec<SessionRow>| rows.into_iter().map(|r| r.id).collect::<Vec<_>>();
        let first = store::session_history(&mut conn, None, 2)
            .await
            .expect("page 1");
        assert_eq!(ids(first.clone()), [uuid(4), uuid(3)]);
        let last = first.last().expect("last");
        let second = store::session_history(
            &mut conn,
            Some(HistoryCursor {
                started_at: &last.started_at,
                id: &last.id,
            }),
            2,
        )
        .await
        .expect("page 2");
        assert_eq!(ids(second.clone()), [uuid(2), uuid(1)]);
        let end = second.last().expect("last");
        let third = store::session_history(
            &mut conn,
            Some(HistoryCursor {
                started_at: &end.started_at,
                id: &end.id,
            }),
            2,
        )
        .await
        .expect("page 3");
        assert!(third.is_empty());
        store::close(conn).await;
    });
}

#[test]
fn next_due_is_the_earliest_of_both_tables_and_none_on_an_empty_base() {
    let (_dir, path) = db();
    run(async {
        let mut conn = connect(&path).await;
        assert_eq!(store::next_due(&mut conn).await.expect("empty"), None);
        assert!(store::due_reminders(&mut conn, DUE, 10)
            .await
            .expect("d")
            .is_empty());
        assert!(store::due_sessions(&mut conn, DUE, 10)
            .await
            .expect("d")
            .is_empty());
        assert!(store::list_reminders(&mut conn)
            .await
            .expect("l")
            .is_empty());
        assert!(store::list_running_sessions(&mut conn)
            .await
            .expect("l")
            .is_empty());

        store::insert_reminder(&mut conn, &reminder(1))
            .await
            .expect("r"); // 08:00
        assert_eq!(
            store::next_due(&mut conn).await.expect("one").as_deref(),
            Some(DUE)
        );
        let sooner = countdown(1, "2026-11-16T07:00:00.000Z", "2026-11-16T07:30:00.000Z");
        store::insert_session(&mut conn, &sooner, 20)
            .await
            .expect("s");
        assert_eq!(
            store::next_due(&mut conn).await.expect("two").as_deref(),
            sooner.ends_at.as_deref()
        );
        // A finished session no longer counts; a disabled reminder has no cache.
        store::stop_session(&mut conn, &sooner.id, AT, AT)
            .await
            .expect("stop");
        assert_eq!(
            store::next_due(&mut conn).await.expect("back").as_deref(),
            Some(DUE)
        );
        store::close(conn).await;
    });
}

#[test]
fn check_constraints_of_v7_hold() {
    let (_dir, path) = db();
    run(async {
        let mut conn = connect(&path).await;
        let id = uuid(1);
        let insert_reminder = |extra: &str, values: &str| {
            format!(
                "INSERT INTO reminders (id, title, start_local, time_zone, rrule, exdates, enabled, \
                 next_fire_at, next_fire_key, created_at, updated_at) VALUES ('{id}', 'T', \
                 '2026-11-16T09:00:00', 'Europe/Paris', NULL, {extra}, {values}, '{AT}', '{AT}')"
            )
        };
        let due = "'2026-11-16T08:00:00.000Z'";
        let key = "'2026-11-16T09:00:00'";
        // enabled = 0 with a cache.
        assert!(
            refused(
                &mut conn,
                &insert_reminder("'[]'", &format!("0, {due}, {key}"))
            )
            .await
        );
        // A cache timestamp without its key, and the reverse.
        assert!(
            refused(
                &mut conn,
                &insert_reminder("'[]'", &format!("1, {due}, NULL"))
            )
            .await
        );
        assert!(
            refused(
                &mut conn,
                &insert_reminder("'[]'", &format!("1, NULL, {key}"))
            )
            .await
        );
        // exdates that is not a JSON array.
        assert!(
            refused(
                &mut conn,
                &insert_reminder("'x'", &format!("1, {due}, {key}"))
            )
            .await
        );
        assert!(
            refused(
                &mut conn,
                &insert_reminder("'{}'", &format!("1, {due}, {key}"))
            )
            .await
        );
        // A valid row goes through.
        assert!(
            !refused(
                &mut conn,
                &insert_reminder("'[]'", &format!("1, {due}, {key}"))
            )
            .await
        );
        // Malformed identifier, empty title.
        assert!(
            refused(
                &mut conn,
                &format!(
                    "INSERT INTO reminders (id, title, start_local, time_zone, rrule, exdates, \
                     enabled, next_fire_at, next_fire_key, created_at, updated_at) VALUES \
                     ('BAD', 'T', '2026-11-16T09:00:00', 'Europe/Paris', NULL, '[]', 0, NULL, \
                     NULL, '{AT}', '{AT}')"
                )
            )
            .await
        );

        let session = |kind: &str, ends: &str, ended: &str, reason: &str| {
            format!(
                "INSERT INTO time_sessions (id, kind, label, started_at, ends_at, ended_at, \
                 end_reason, created_at, updated_at) VALUES ('{}', '{kind}', '', \
                 '2026-11-16T07:00:00.000Z', {ends}, {ended}, {reason}, '{AT}', '{AT}')",
                uuid(2)
            )
        };
        // A stopwatch with an end, a countdown without one.
        assert!(
            refused(
                &mut conn,
                &session("stopwatch", "'2026-11-16T07:10:00.000Z'", "NULL", "NULL")
            )
            .await
        );
        assert!(refused(&mut conn, &session("countdown", "NULL", "NULL", "NULL")).await);
        // `ends_at` must be after `started_at`.
        assert!(
            refused(
                &mut conn,
                &session("countdown", "'2026-11-16T07:00:00.000Z'", "NULL", "NULL")
            )
            .await
        );
        // `completed` with an `ended_at` different from `ends_at`.
        assert!(
            refused(
                &mut conn,
                &session(
                    "countdown",
                    "'2026-11-16T07:10:00.000Z'",
                    "'2026-11-16T07:11:00.000Z'",
                    "'completed'"
                )
            )
            .await
        );
        // `ended_at` and `end_reason` go together; unknown kind and reason are refused.
        assert!(
            refused(
                &mut conn,
                &session(
                    "countdown",
                    "'2026-11-16T07:10:00.000Z'",
                    "'2026-11-16T07:10:00.000Z'",
                    "NULL"
                )
            )
            .await
        );
        assert!(
            refused(
                &mut conn,
                &session("alarm", "'2026-11-16T07:10:00.000Z'", "NULL", "NULL")
            )
            .await
        );
        assert!(
            refused(
                &mut conn,
                &session(
                    "countdown",
                    "'2026-11-16T07:10:00.000Z'",
                    "'2026-11-16T07:10:00.000Z'",
                    "'done'"
                )
            )
            .await
        );
        // Valid rows.
        assert!(
            !refused(
                &mut conn,
                &session(
                    "countdown",
                    "'2026-11-16T07:10:00.000Z'",
                    "'2026-11-16T07:10:00.000Z'",
                    "'completed'"
                )
            )
            .await
        );

        // Deliveries: unknown outcome, negative skipped count.
        let delivery_sql = |outcome: &str, skipped: i64| {
            format!(
                "INSERT INTO reminder_deliveries (reminder_id, occurrence_key, due_at, outcome, \
                 skipped_count, seen_at, created_at, updated_at) VALUES ('{id}', {key}, {due}, \
                 '{outcome}', {skipped}, NULL, '{AT}', '{AT}')"
            )
        };
        assert!(refused(&mut conn, &delivery_sql("skipped", 0)).await);
        assert!(refused(&mut conn, &delivery_sql("late", -1)).await);
        assert!(refused(&mut conn, &delivery_sql("late", 1001)).await);
        assert!(!refused(&mut conn, &delivery_sql("late", 1000)).await);
        // The key is the primary key.
        assert!(refused(&mut conn, &delivery_sql("on_time", 0)).await);
        store::close(conn).await;
    });
}

#[test]
fn a_busy_database_maps_to_busy() {
    let (_dir, path) = db();
    run(async {
        let mut holder = connect(&path).await;
        sqlx::query("BEGIN IMMEDIATE")
            .execute(&mut holder)
            .await
            .expect("lock");
        // A second connection with a very short busy timeout.
        let options = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(false)
            .busy_timeout(std::time::Duration::from_millis(50));
        let mut other = sqlx::Connection::connect_with(&options)
            .await
            .expect("open");
        let result = store::record_firing(&mut other, &uuid(1), None, None, None).await;
        assert_eq!(result, Err(ScheduleError::Busy));
        sqlx::query("ROLLBACK")
            .execute(&mut holder)
            .await
            .expect("unlock");
        store::close(holder).await;
    });
}

#[test]
fn the_database_itself_refuses_a_second_running_pomodoro() {
    let (_dir, path) = db();
    run(async {
        let mut conn = connect(&path).await;
        let raw = |n: u32, kind: &str, ended: bool| {
            let (ended_at, reason) = if ended {
                ("'2026-11-16T07:25:00.000Z'", "'completed'")
            } else {
                ("NULL", "NULL")
            };
            format!(
                "INSERT INTO time_sessions (id, kind, label, started_at, ends_at, ended_at, \
                 end_reason, created_at, updated_at) VALUES ('{}', '{kind}', '', \
                 '2026-11-16T07:00:00.000Z', '2026-11-16T07:25:00.000Z', {ended_at}, {reason}, \
                 '{AT}', '{AT}')",
                uuid(n)
            )
        };
        assert!(!refused(&mut conn, &raw(1, "pomodoro_work", false)).await);
        assert!(refused(&mut conn, &raw(2, "pomodoro_short_break", false)).await);
        assert!(refused(&mut conn, &raw(3, "pomodoro_long_break", false)).await);
        // Finished pomodoros and other kinds are not concerned.
        assert!(!refused(&mut conn, &raw(4, "pomodoro_work", true)).await);
        assert!(!refused(&mut conn, &raw(5, "countdown", false)).await);
        assert!(!refused(&mut conn, &raw(6, "countdown", false)).await);
        store::close(conn).await;
    });
}
