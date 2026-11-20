//! SQL storage of habits on a real database at the latest schema (spec habits 4.2, lot H1,
//! `habit_store_tests`): the reminders owned by a habit stay out of the generic reminder functions.

use crate::backup::sqlite::supported_schema_version;
use crate::backup::test_support::{make_database, run};
use crate::schedule::error::ScheduleError;
use crate::schedule::habit::{HabitRow, HabitSchedule};
use crate::schedule::habit_store as habits;
use crate::schedule::reminder::{Outcome, ReminderRow};
use crate::schedule::store::{self, DeliveryRow};
use sqlx::SqliteConnection;
use tempfile::TempDir;

const AT: &str = "2026-11-01T00:00:00.000Z";
const LATER: &str = "2026-11-02T00:00:00.000Z";
const DUE: &str = "2026-11-16T08:00:00.000Z";
const KEY: &str = "2026-11-16T09:00:00";

fn uuid(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012x}")
}

fn db() -> (TempDir, std::path::PathBuf) {
    let dir = TempDir::new().expect("tmp");
    let path = dir.path().join("homebase.db");
    make_database(&path, supported_schema_version(), false);
    (dir, path)
}

async fn connect(path: &std::path::Path) -> SqliteConnection {
    store::connect(path).await.expect("connect")
}

fn habit(n: u32) -> HabitRow {
    HabitRow {
        id: uuid(n),
        title: format!("Habitude {n}"),
        schedule: HabitSchedule::Days { mask: 0b001_0101 },
        start_on: "2026-11-02".to_owned(),
        archived_at: None,
        // Ordered by creation: a later `n` is created later.
        created_at: format!("2026-11-01T00:00:{n:02}.000Z"),
        updated_at: format!("2026-11-01T00:00:{n:02}.000Z"),
    }
}

/// A reminder owned by habit `owner` (reminder id `100 + owner`).
fn habit_reminder(owner: u32) -> ReminderRow {
    ReminderRow {
        id: uuid(100 + owner),
        title: format!("Habitude {owner}"),
        start_local: "2026-11-02T20:00:00".to_owned(),
        time_zone: "Europe/Paris".to_owned(),
        rrule: Some("FREQ=DAILY".to_owned()),
        exdates: "[]".to_owned(),
        enabled: true,
        next_fire_at: Some(DUE.to_owned()),
        next_fire_key: Some(KEY.to_owned()),
        habit_id: Some(uuid(owner)),
        created_at: AT.to_owned(),
        updated_at: AT.to_owned(),
    }
}

fn plain_reminder(n: u32) -> ReminderRow {
    ReminderRow {
        id: uuid(n),
        title: format!("Rappel {n}"),
        habit_id: None,
        ..habit_reminder(1)
    }
}

async fn count(conn: &mut SqliteConnection, table: &str) -> i64 {
    let sql = format!("SELECT COUNT(*) FROM {table}");
    sqlx::query_scalar(&sql)
        .fetch_one(conn)
        .await
        .expect("count")
}

#[test]
fn habit_round_trip_replace_archive_and_delete() {
    let (_dir, path) = db();
    run(async {
        let mut conn = connect(&path).await;
        let days = habit(1);
        let weekly = HabitRow {
            schedule: HabitSchedule::Weekly { target: 3 },
            ..habit(2)
        };
        habits::insert_habit(&mut conn, &days)
            .await
            .expect("insert");
        habits::insert_habit(&mut conn, &weekly)
            .await
            .expect("insert");
        assert_eq!(habits::count_habits(&mut conn).await.expect("count"), 2);
        assert_eq!(
            habits::get_habit(&mut conn, &days.id).await.expect("get"),
            Some(days.clone())
        );
        assert_eq!(
            habits::get_habit(&mut conn, &weekly.id).await.expect("get"),
            Some(weekly.clone())
        );
        assert_eq!(
            habits::get_habit(&mut conn, &uuid(9)).await.expect("get"),
            None
        );
        assert_eq!(
            habits::list_habits(&mut conn).await.expect("list"),
            vec![days.clone(), weekly.clone()]
        );

        // Replace keeps created_at and archived_at.
        let edited = HabitRow {
            title: "Autre".to_owned(),
            schedule: HabitSchedule::Weekly { target: 5 },
            start_on: "2026-11-09".to_owned(),
            created_at: "2030-01-01T00:00:00.000Z".to_owned(), // must be ignored
            updated_at: LATER.to_owned(),
            ..days.clone()
        };
        assert!(habits::replace_habit(&mut conn, &edited)
            .await
            .expect("replace"));
        assert_eq!(
            habits::get_habit(&mut conn, &days.id).await.expect("get"),
            Some(HabitRow {
                created_at: days.created_at.clone(),
                ..edited.clone()
            })
        );
        assert!(!habits::replace_habit(&mut conn, &habit(9))
            .await
            .expect("absent"));

        // Archive keeps the first date, restore clears it.
        assert!(
            habits::set_archived(&mut conn, &days.id, Some(LATER), LATER)
                .await
                .expect("archive")
        );
        assert!(habits::set_archived(
            &mut conn,
            &days.id,
            Some("2026-11-03T00:00:00.000Z"),
            "2026-11-03T00:00:00.000Z"
        )
        .await
        .expect("archive again"));
        let archived = habits::get_habit(&mut conn, &days.id)
            .await
            .expect("get")
            .expect("row");
        // Archiving an archived habit changes nothing, updated_at included.
        assert_eq!(archived.archived_at.as_deref(), Some(LATER));
        assert_eq!(archived.updated_at, LATER);
        assert!(habits::set_archived(&mut conn, &days.id, None, LATER)
            .await
            .expect("restore"));
        assert_eq!(
            habits::get_habit(&mut conn, &days.id)
                .await
                .expect("get")
                .expect("row")
                .archived_at,
            None
        );
        assert!(!habits::set_archived(&mut conn, &uuid(9), None, LATER)
            .await
            .expect("absent"));

        assert!(habits::delete_habit(&mut conn, &days.id)
            .await
            .expect("del"));
        assert!(!habits::delete_habit(&mut conn, &days.id)
            .await
            .expect("del"));
        assert_eq!(habits::count_habits(&mut conn).await.expect("count"), 1);
        store::close(conn).await;
    });
}

#[test]
fn an_existing_habit_id_is_a_conflict() {
    let (_dir, path) = db();
    run(async {
        let mut conn = connect(&path).await;
        habits::insert_habit(&mut conn, &habit(1))
            .await
            .expect("insert");
        assert_eq!(
            habits::insert_habit(&mut conn, &habit(1)).await,
            Err(ScheduleError::Conflict)
        );
        store::close(conn).await;
    });
}

#[test]
fn an_unreadable_habit_row_is_ignored() {
    let (_dir, path) = db();
    run(async {
        let mut conn = connect(&path).await;
        habits::insert_habit(&mut conn, &habit(1))
            .await
            .expect("insert");
        // A mask out of bounds can only come from a write that skipped the CHECK.
        sqlx::query("PRAGMA ignore_check_constraints = ON")
            .execute(&mut conn)
            .await
            .expect("pragma");
        sqlx::query(
            "INSERT INTO habits (id, title, kind, days_mask, weekly_target, start_on, \
             archived_at, created_at, updated_at) \
             VALUES (?1, 'Cassee', 'days', 200, NULL, '2026-11-02', NULL, ?2, ?2)",
        )
        .bind(uuid(2))
        .bind(AT)
        .execute(&mut conn)
        .await
        .expect("raw insert");
        assert_eq!(count(&mut conn, "habits").await, 2);
        assert_eq!(
            habits::list_habits(&mut conn).await.expect("list"),
            vec![habit(1)]
        );
        assert_eq!(
            habits::get_habit(&mut conn, &uuid(2)).await.expect("get"),
            None
        );
        store::close(conn).await;
    });
}

#[test]
fn checks_are_idempotent_and_ranges_are_ordered_and_bounded() {
    let (_dir, path) = db();
    run(async {
        let mut conn = connect(&path).await;
        let (a, b) = (habit(1), habit(2));
        habits::insert_habit(&mut conn, &a).await.expect("insert");
        habits::insert_habit(&mut conn, &b).await.expect("insert");

        assert!(habits::insert_check(&mut conn, &a.id, "2026-11-04", AT)
            .await
            .expect("check"));
        assert!(!habits::insert_check(&mut conn, &a.id, "2026-11-04", LATER)
            .await
            .expect("twice"));
        for day in ["2026-11-06", "2026-11-02", "2026-11-10"] {
            assert!(habits::insert_check(&mut conn, &a.id, day, AT)
                .await
                .expect("check"));
        }
        assert!(habits::insert_check(&mut conn, &b.id, "2026-11-04", AT)
            .await
            .expect("check"));
        // The first write wins: the repeated call changed nothing.
        let created: String = sqlx::query_scalar(
            "SELECT created_at FROM habit_checks WHERE habit_id = ?1 AND day_on = '2026-11-04'",
        )
        .bind(&a.id)
        .fetch_one(&mut conn)
        .await
        .expect("created_at");
        assert_eq!(created, AT);

        let all = habits::checks_between(&mut conn, "2026-11-02", "2026-11-10", 100)
            .await
            .expect("range");
        let pairs: Vec<(&str, &str)> = all
            .iter()
            .map(|c| (c.habit_id.as_str(), c.day_on.as_str()))
            .collect();
        assert_eq!(
            pairs,
            [
                (a.id.as_str(), "2026-11-02"),
                (a.id.as_str(), "2026-11-04"),
                (a.id.as_str(), "2026-11-06"),
                (a.id.as_str(), "2026-11-10"),
                (b.id.as_str(), "2026-11-04"),
            ]
        );
        // Bounds are inclusive; the limit applies.
        assert_eq!(
            habits::checks_between(&mut conn, "2026-11-03", "2026-11-06", 100)
                .await
                .expect("range")
                .len(),
            3
        );
        assert_eq!(
            habits::checks_between(&mut conn, "2026-11-02", "2026-11-10", 2)
                .await
                .expect("range")
                .len(),
            2
        );
        assert_eq!(
            habits::checked_days(&mut conn, &a.id, "2026-11-03", "2026-11-10")
                .await
                .expect("days"),
            ["2026-11-04", "2026-11-06", "2026-11-10"]
        );

        assert!(habits::delete_check(&mut conn, &a.id, "2026-11-04")
            .await
            .expect("uncheck"));
        assert!(!habits::delete_check(&mut conn, &a.id, "2026-11-04")
            .await
            .expect("uncheck twice"));
        store::close(conn).await;
    });
}

#[test]
fn deleting_a_habit_removes_checks_reminder_and_deliveries() {
    let (_dir, path) = db();
    run(async {
        let mut conn = connect(&path).await;
        let (a, b) = (habit(1), habit(2));
        habits::insert_habit(&mut conn, &a).await.expect("insert");
        habits::insert_habit(&mut conn, &b).await.expect("insert");
        for (h, day) in [(&a, "2026-11-04"), (&a, "2026-11-05"), (&b, "2026-11-04")] {
            habits::insert_check(&mut conn, &h.id, day, AT)
                .await
                .expect("check");
        }
        for owner in [1, 2] {
            let r = habit_reminder(owner);
            store::insert_reminder(&mut conn, &r)
                .await
                .expect("reminder");
            let d = DeliveryRow {
                reminder_id: r.id.clone(),
                occurrence_key: KEY.to_owned(),
                due_at: DUE.to_owned(),
                outcome: Outcome::OnTime,
                skipped_count: 0,
                seen_at: None,
                created_at: AT.to_owned(),
                updated_at: AT.to_owned(),
            };
            assert!(
                store::record_firing(&mut conn, &r.id, Some(DUE), Some(&d), None)
                    .await
                    .expect("firing")
            );
        }
        assert_eq!(count(&mut conn, "reminder_deliveries").await, 2);

        assert!(habits::delete_habit(&mut conn, &a.id)
            .await
            .expect("delete"));

        assert_eq!(count(&mut conn, "habit_checks").await, 1);
        assert_eq!(count(&mut conn, "reminders").await, 1);
        assert_eq!(count(&mut conn, "reminder_deliveries").await, 1);
        assert_eq!(
            store::get_habit_reminder(&mut conn, &a.id)
                .await
                .expect("get"),
            None
        );
        assert_eq!(
            store::get_habit_reminder(&mut conn, &b.id)
                .await
                .expect("get")
                .map(|r| r.id),
            Some(uuid(102))
        );
        store::close(conn).await;
    });
}

#[test]
fn a_habit_has_at_most_one_reminder() {
    let (_dir, path) = db();
    run(async {
        let mut conn = connect(&path).await;
        habits::insert_habit(&mut conn, &habit(1))
            .await
            .expect("insert");
        store::insert_reminder(&mut conn, &habit_reminder(1))
            .await
            .expect("first");
        let second = ReminderRow {
            id: uuid(77),
            ..habit_reminder(1)
        };
        assert_eq!(
            store::insert_reminder(&mut conn, &second).await,
            Err(ScheduleError::Conflict)
        );
        // An unknown owner is refused by the foreign key.
        assert_eq!(
            store::insert_reminder(&mut conn, &habit_reminder(5)).await,
            Err(ScheduleError::Database)
        );
        // Plain reminders are not limited by the index.
        store::insert_reminder(&mut conn, &plain_reminder(1))
            .await
            .expect("plain");
        store::insert_reminder(&mut conn, &plain_reminder(2))
            .await
            .expect("plain");
        store::close(conn).await;
    });
}

#[test]
fn generic_reminder_functions_do_not_see_habit_reminders() {
    let (_dir, path) = db();
    run(async {
        let mut conn = connect(&path).await;
        habits::insert_habit(&mut conn, &habit(1))
            .await
            .expect("insert");
        let owned = habit_reminder(1);
        let plain = plain_reminder(2);
        store::insert_reminder(&mut conn, &owned)
            .await
            .expect("owned");
        store::insert_reminder(&mut conn, &plain)
            .await
            .expect("plain");
        // The stored row carries its owner, and only the habit accessor reads it.
        assert_eq!(
            store::get_habit_reminder(&mut conn, &uuid(1))
                .await
                .expect("get"),
            Some(owned.clone())
        );
        assert_eq!(
            store::get_reminder(&mut conn, &owned.id)
                .await
                .expect("get"),
            None
        );
        assert_eq!(
            store::get_reminder(&mut conn, &plain.id)
                .await
                .expect("get"),
            Some(plain.clone())
        );

        // list_reminders.
        let listed = store::list_reminders(&mut conn).await.expect("list");
        assert_eq!(listed, vec![plain.clone()]);
        // The scheduler still sees both.
        let due = store::due_reminders(&mut conn, DUE, 10).await.expect("due");
        assert_eq!(due.len(), 2);
        assert_eq!(
            store::enabled_reminders(&mut conn)
                .await
                .expect("enabled")
                .len(),
            2
        );
        assert_eq!(store::count_reminders(&mut conn).await.expect("count"), 2);

        // unseen_deliveries.
        for r in [&owned, &plain] {
            let d = DeliveryRow {
                reminder_id: r.id.clone(),
                occurrence_key: KEY.to_owned(),
                due_at: DUE.to_owned(),
                outcome: Outcome::OnTime,
                skipped_count: 0,
                seen_at: None,
                created_at: AT.to_owned(),
                updated_at: AT.to_owned(),
            };
            store::record_firing(&mut conn, &r.id, Some(DUE), Some(&d), None)
                .await
                .expect("firing");
        }
        let unseen = store::unseen_deliveries(&mut conn, 10)
            .await
            .expect("unseen");
        assert_eq!(unseen.len(), 1);
        assert_eq!(unseen[0].reminder_id, plain.id);

        // replace_reminder and delete_reminder have no effect on the owned reminder.
        let edited = ReminderRow {
            title: "Piratage".to_owned(),
            habit_id: None,
            updated_at: LATER.to_owned(),
            ..owned.clone()
        };
        assert!(!store::replace_reminder(&mut conn, &edited)
            .await
            .expect("replace"));
        assert!(!store::delete_reminder(&mut conn, &owned.id)
            .await
            .expect("delete"));
        let still = store::get_habit_reminder(&mut conn, &uuid(1))
            .await
            .expect("get")
            .expect("row");
        assert_eq!(still.title, owned.title);
        assert_eq!(still.habit_id, owned.habit_id);
        // The plain one is still editable and deletable.
        assert!(store::replace_reminder(
            &mut conn,
            &ReminderRow {
                title: "Autre".to_owned(),
                updated_at: LATER.to_owned(),
                ..plain.clone()
            }
        )
        .await
        .expect("replace plain"));
        assert!(store::delete_reminder(&mut conn, &plain.id)
            .await
            .expect("delete plain"));
        store::close(conn).await;
    });
}

#[test]
fn habit_reminder_functions_read_replace_disable_and_delete() {
    let (_dir, path) = db();
    run(async {
        let mut conn = connect(&path).await;
        for n in [1, 2] {
            habits::insert_habit(&mut conn, &habit(n))
                .await
                .expect("insert");
            store::insert_reminder(&mut conn, &habit_reminder(n))
                .await
                .expect("reminder");
        }
        store::insert_reminder(&mut conn, &plain_reminder(3))
            .await
            .expect("plain");
        assert_eq!(
            store::list_habit_reminders(&mut conn)
                .await
                .expect("list")
                .into_iter()
                .map(|r| r.id)
                .collect::<Vec<_>>(),
            [uuid(101), uuid(102)]
        );

        // replace_habit_reminder: only the reminder of its owner.
        let edited = ReminderRow {
            title: "Nouveau titre".to_owned(),
            rrule: Some("FREQ=WEEKLY;BYDAY=MO".to_owned()),
            created_at: "2030-01-01T00:00:00.000Z".to_owned(), // must be ignored
            updated_at: LATER.to_owned(),
            ..habit_reminder(1)
        };
        assert!(store::replace_habit_reminder(&mut conn, &edited)
            .await
            .expect("replace"));
        let stored = store::get_habit_reminder(&mut conn, &uuid(1))
            .await
            .expect("get")
            .expect("row");
        assert_eq!(
            stored,
            ReminderRow {
                created_at: AT.to_owned(),
                ..edited.clone()
            }
        );
        let wrong_owner = ReminderRow {
            habit_id: Some(uuid(2)),
            ..edited.clone()
        };
        assert!(!store::replace_habit_reminder(&mut conn, &wrong_owner)
            .await
            .expect("wrong owner"));
        let unowned = ReminderRow {
            habit_id: None,
            ..plain_reminder(3)
        };
        assert!(!store::replace_habit_reminder(&mut conn, &unowned)
            .await
            .expect("unowned"));

        // write_reminder_exdates never touches a reminder without an owner.
        assert_eq!(
            store::write_reminder_exdates(&mut conn, &uuid(3), "[]", Some(DUE), None)
                .await
                .expect("plain"),
            0
        );
        assert_eq!(
            store::get_reminder(&mut conn, &uuid(3))
                .await
                .expect("get")
                .map(|r| r.next_fire_at),
            Some(Some(DUE.to_owned()))
        );

        // write_reminder_exdates: compare-and-write on the cache; updated_at untouched.
        let key = r#"["2026-11-16T20:00:00"]"#;
        assert_eq!(
            store::write_reminder_exdates(
                &mut conn,
                &uuid(101),
                key,
                Some("2000-01-01T00:00:00.000Z"),
                None
            )
            .await
            .expect("stale"),
            0
        );
        assert_eq!(
            store::write_reminder_exdates(
                &mut conn,
                &uuid(101),
                key,
                Some(DUE),
                Some(("2026-11-17T19:00:00.000Z", "2026-11-17T20:00:00"))
            )
            .await
            .expect("write"),
            1
        );
        let written = store::get_habit_reminder(&mut conn, &uuid(1))
            .await
            .expect("get")
            .expect("row");
        assert_eq!(written.exdates, key);
        assert_eq!(
            written.next_fire_at.as_deref(),
            Some("2026-11-17T19:00:00.000Z")
        );
        assert_eq!(
            written.next_fire_key.as_deref(),
            Some("2026-11-17T20:00:00")
        );
        assert_eq!(written.updated_at, LATER);

        // disable_habit_reminder.
        assert!(
            store::disable_habit_reminder(&mut conn, &uuid(1), "2026-11-03T00:00:00.000Z")
                .await
                .expect("disable")
        );
        let off = store::get_habit_reminder(&mut conn, &uuid(1))
            .await
            .expect("get")
            .expect("row");
        assert!(!off.enabled);
        assert_eq!(off.updated_at, "2026-11-03T00:00:00.000Z");
        assert_eq!((off.next_fire_at, off.next_fire_key), (None, None));
        assert!(!store::disable_habit_reminder(&mut conn, &uuid(9), LATER)
            .await
            .expect("none"));

        // delete_habit_reminder leaves the habit and the other reminders alone.
        assert!(store::delete_habit_reminder(&mut conn, &uuid(1))
            .await
            .expect("delete"));
        assert!(!store::delete_habit_reminder(&mut conn, &uuid(1))
            .await
            .expect("delete twice"));
        assert!(habits::get_habit(&mut conn, &uuid(1))
            .await
            .expect("get")
            .is_some());
        assert_eq!(count(&mut conn, "reminders").await, 2);
        store::close(conn).await;
    });
}
