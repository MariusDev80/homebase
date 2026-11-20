//! The habit commands on a real database at the latest schema (spec habits 6, lot H2,
//! `habit_commands_tests`): every row of the table of 4.3, the exact serialisations (S1), the
//! bounds checked before any disk access, the silence of a checked day seen by the real `tick`
//! (L1 to L6), the wake-ups after a commit and the gate shared with the scheduler thread.

use crate::backup::sqlite::supported_schema_version;
use crate::backup::test_support::{make_database, run};
use crate::schedule::commands::{delete_reminder, list_reminders, unseen_deliveries};
use crate::schedule::error::ScheduleError;
use crate::schedule::habit::{HabitRow, HabitSchedule};
use crate::schedule::habit_commands::{
    create_habit, delete_habit, habit_checks_between, list_habits, set_habit_archived,
    set_habit_check, update_habit, HabitCheckDto, HabitCreateDto, HabitDto, HabitInputDto,
    HabitReminderInputDto, HabitScheduleDto,
};
use crate::schedule::habit_store;
use crate::schedule::notifier::RecordingNotifier;
use crate::schedule::reminder::ReminderRow;
use crate::schedule::store;
use crate::schedule::text::check_id;
use crate::schedule::tick::{tick, Phase};
use crate::schedule::worker::{self, WakeSignal};
use crate::schedule::{SchedulerCtx, SchedulerState};
use crate::time::clock::FixedClock;
use crate::time::formats::parse_instant;
use std::fmt::Debug;
use std::sync::Arc;
use std::time::Duration;
use tempfile::TempDir;

/// Monday 09:00 in Paris (CET).
const NOW: &str = "2026-11-16T08:00:00.000Z";
/// The same day, 20:00 in Paris, and 20:03.
const EVENING_Z: &str = "2026-11-16T19:00:30.000Z";
const PARIS: &str = "Europe/Paris";
const TODAY: &str = "2026-11-16";
const START: &str = "2026-11-09";
const WEEK: [&str; 7] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

fn uuid(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012x}")
}

struct Fx {
    _dir: TempDir,
    ctx: Arc<SchedulerCtx>,
    clock: Arc<FixedClock>,
    notifier: Arc<RecordingNotifier>,
}

impl Fx {
    fn new() -> Self {
        let dir = TempDir::new().expect("tmp");
        let db = dir.path().join("homebase.db");
        make_database(&db, supported_schema_version(), false);
        Self::with_db(dir, db)
    }

    /// A context whose database file does not exist: any command that reached the disk fails
    /// with `Database`, so an `InvalidInput` proves the check came first.
    fn without_database() -> Self {
        let dir = TempDir::new().expect("tmp");
        let db = dir.path().join("missing.db");
        Self::with_db(dir, db)
    }

    fn with_db(dir: TempDir, db: std::path::PathBuf) -> Self {
        let clock = Arc::new(FixedClock::new(parse_instant(NOW).expect("instant")));
        let notifier = Arc::new(RecordingNotifier::default());
        let ctx = Arc::new(SchedulerCtx {
            db,
            clock: clock.clone(),
            notifier: notifier.clone(),
            gate: tokio::sync::Mutex::new(()),
            busy_timeout: Duration::from_millis(200),
            signal: WakeSignal::default(),
        });
        Self {
            _dir: dir,
            ctx,
            clock,
            notifier,
        }
    }

    fn set(&self, now: &str) {
        self.clock.set(parse_instant(now).expect("instant"));
    }

    fn wakes(&self) -> usize {
        self.ctx.signal.wake_count()
    }

    fn toast_titles(&self) -> Vec<String> {
        self.notifier
            .shown
            .lock()
            .expect("lock")
            .iter()
            .map(|t| t.title.clone())
            .collect()
    }

    async fn tick(&self) {
        tick(&self.ctx, Phase::Regular).await.expect("tick");
    }

    /// A daily habit `n` with a reminder at `time` every day.
    async fn make(&self, n: u32, time: &str) -> HabitDto {
        create_habit(&self.ctx, create_dto(n, reminder(time, &WEEK, true)))
            .await
            .expect("create")
    }

    async fn reminder_row(&self, n: u32) -> ReminderRow {
        let mut conn = store::connect(&self.ctx.db).await.expect("connect");
        let row = store::get_habit_reminder(&mut conn, &uuid(n))
            .await
            .expect("get");
        store::close(conn).await;
        row.expect("the habit has a reminder")
    }

    async fn count(&self, table: &str) -> i64 {
        let mut conn = store::connect(&self.ctx.db).await.expect("connect");
        let sql = format!("SELECT COUNT(*) FROM {table}");
        let n = sqlx::query_scalar(&sql)
            .fetch_one(&mut conn)
            .await
            .expect("count");
        store::close(conn).await;
        n
    }

    async fn exec(&self, sql: &str) {
        let mut conn = store::connect(&self.ctx.db).await.expect("connect");
        sqlx::query(sql).execute(&mut conn).await.expect("exec");
        store::close(conn).await;
    }

    async fn check(&self, n: u32, day: &str, done: bool) -> bool {
        set_habit_check(&self.ctx, uuid(n), day.to_owned(), done)
            .await
            .expect("check")
    }
}

fn strs(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| (*s).to_owned()).collect()
}

fn days(list: &[&str]) -> HabitScheduleDto {
    HabitScheduleDto::Days { days: strs(list) }
}

fn reminder(time: &str, list: &[&str], enabled: bool) -> Option<HabitReminderInputDto> {
    static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(50_000);
    Some(HabitReminderInputDto {
        id: uuid(NEXT.fetch_add(1, std::sync::atomic::Ordering::SeqCst)),
        time: time.to_owned(),
        days: strs(list),
        time_zone: PARIS.to_owned(),
        enabled,
    })
}

fn create_dto(n: u32, reminder: Option<HabitReminderInputDto>) -> HabitCreateDto {
    HabitCreateDto {
        id: uuid(n),
        title: "Méditer".to_owned(),
        schedule: days(&WEEK),
        start_on: START.to_owned(),
        reminder,
    }
}

fn input_dto(title: &str, reminder: Option<HabitReminderInputDto>) -> HabitInputDto {
    HabitInputDto {
        title: title.to_owned(),
        schedule: days(&WEEK),
        start_on: START.to_owned(),
        reminder,
    }
}

fn err<T: Debug>(result: Result<T, ScheduleError>) -> ScheduleError {
    result.expect_err("an error")
}

fn invalid(field: &str) -> ScheduleError {
    ScheduleError::invalid(field)
}

fn json<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_string(value).expect("json")
}

// ---------------------------------------------------------------------------------------------
// DTO and serialisations (CA-H2-2, S1)
// ---------------------------------------------------------------------------------------------

#[test]
fn the_schedule_dto_has_the_exact_shape_and_refuses_unknown_fields() {
    // S1: `deny_unknown_fields` reaches the fields of an internally tagged struct variant.
    let parse = |text: &str| serde_json::from_str::<HabitScheduleDto>(text);
    assert_eq!(
        parse(r#"{"kind":"days","days":["MO"]}"#).expect("days"),
        days(&["MO"])
    );
    assert_eq!(
        parse(r#"{"kind":"weekly","target":3}"#).expect("weekly"),
        HabitScheduleDto::Weekly { target: 3 }
    );
    assert!(parse(r#"{"kind":"days","days":["MO"],"extra":1}"#).is_err());
    assert!(parse(r#"{"kind":"weekly","target":3,"days":["MO"]}"#).is_err());
    assert!(parse(r#"{"kind":"weekly","target":3,"extra":true}"#).is_err());
    assert!(parse(r#"{"kind":"monthly","target":3}"#).is_err());
    assert!(parse(r#"{"kind":"days"}"#).is_err());
    assert!(parse(r#"{"days":["MO"]}"#).is_err());
    assert_eq!(json(&days(&["MO"])), r#"{"kind":"days","days":["MO"]}"#);
    assert_eq!(
        json(&HabitScheduleDto::Weekly { target: 3 }),
        r#"{"kind":"weekly","target":3}"#
    );
}

#[test]
fn input_dtos_are_camel_case_and_refuse_unknown_fields() {
    let reminder = r#"{"id":"00000000-0000-4000-8000-000000000001","time":"20:00","days":["MO"],"timeZone":"Europe/Paris","enabled":true}"#;
    let input = |extra: &str, reminder: &str| {
        format!(
            r#"{{"title":"t","schedule":{{"kind":"days","days":["MO"]}},"startOn":"2026-11-09","reminder":{reminder}{extra}}}"#
        )
    };
    let parsed: HabitInputDto = serde_json::from_str(&input("", reminder)).expect("input");
    assert_eq!(parsed.start_on, "2026-11-09");
    assert_eq!(parsed.reminder.expect("reminder").time_zone, PARIS);
    assert!(serde_json::from_str::<HabitInputDto>(&input("", "null")).is_ok());
    assert!(serde_json::from_str::<HabitInputDto>(&input(r#","extra":1"#, reminder)).is_err());
    // Unknown field in the nested reminder, snake_case names, missing field.
    let nested = reminder.replace("}", r#","extra":1}"#);
    assert!(serde_json::from_str::<HabitInputDto>(&input("", &nested)).is_err());
    assert!(serde_json::from_str::<HabitInputDto>(
        r#"{"title":"t","schedule":{"kind":"weekly","target":3},"start_on":"2026-11-09","reminder":null}"#
    )
    .is_err());
    assert!(serde_json::from_str::<HabitInputDto>(
        r#"{"title":"t","schedule":{"kind":"weekly","target":3,"x":1},"startOn":"2026-11-09","reminder":null}"#
    )
    .is_err());
    // `reminder` is required in an update: a missing key is not a deletion.
    assert!(serde_json::from_str::<HabitInputDto>(
        r#"{"title":"t","schedule":{"kind":"weekly","target":3},"startOn":"2026-11-09"}"#
    )
    .is_err());

    let create = r#"{"id":"x","title":"t","schedule":{"kind":"weekly","target":2},"startOn":"2026-11-09","reminder":null}"#;
    assert!(serde_json::from_str::<HabitCreateDto>(create).is_ok());
    let with_extra = create.replace(r#""reminder":null"#, r#""reminder":null,"z":1"#);
    assert!(serde_json::from_str::<HabitCreateDto>(&with_extra).is_err());
}

#[test]
fn output_dtos_are_camel_case() {
    let fx = Fx::new();
    run(async {
        let dto = fx.make(1, "20:00").await;
        let reminder_id = dto.reminder.as_ref().expect("reminder").reminder_id.clone();
        assert!(check_id(&reminder_id).is_ok(), "{reminder_id}");
        assert_ne!(reminder_id, uuid(1));
        assert_eq!(
            serde_json::to_value(&dto).expect("json"),
            serde_json::json!({
                "id": uuid(1),
                "title": "Méditer",
                "schedule": {"kind": "days", "days": WEEK},
                "startOn": START,
                "archivedAt": null,
                "reminder": {
                    "reminderId": reminder_id,
                    "time": "20:00",
                    "days": WEEK,
                    "timeZone": PARIS,
                    "enabled": true,
                    "nextFireAt": "2026-11-16T19:00:00.000Z",
                    "nextFireKey": "2026-11-16T20:00:00",
                    "status": "scheduled"
                },
                "createdAt": NOW,
                "updatedAt": NOW
            })
        );
        let plain = create_habit(
            &fx.ctx,
            HabitCreateDto {
                schedule: HabitScheduleDto::Weekly { target: 3 },
                ..create_dto(2, None)
            },
        )
        .await
        .expect("create");
        let value = serde_json::to_value(&plain).expect("json");
        assert_eq!(
            value["schedule"],
            serde_json::json!({"kind":"weekly","target":3})
        );
        assert_eq!(value["reminder"], serde_json::Value::Null);
        assert_eq!(
            json(&HabitCheckDto {
                habit_id: "h".to_owned(),
                day_on: "2026-11-16".to_owned()
            }),
            r#"{"habitId":"h","dayOn":"2026-11-16"}"#
        );
    });
}

// ---------------------------------------------------------------------------------------------
// Bounds checked before any disk access
// ---------------------------------------------------------------------------------------------

#[test]
fn inputs_are_refused_before_the_disk_is_touched() {
    let fx = Fx::without_database();
    run(async {
        let ctx = &fx.ctx;
        // Control: a valid call reaches the (missing) disk.
        assert_eq!(
            err(create_habit(ctx, create_dto(1, None)).await),
            ScheduleError::Database
        );

        let create = |edit: &dyn Fn(&mut HabitCreateDto)| {
            let mut dto = create_dto(1, reminder("20:00", &["MO"], true));
            edit(&mut dto);
            dto
        };
        let cases: Vec<(&str, HabitCreateDto)> = vec![
            ("id", create(&|d| d.id = "not-a-uuid".to_owned())),
            ("title", create(&|d| d.title = String::new())),
            ("title", create(&|d| d.title = "   ".to_owned())),
            ("title", create(&|d| d.title = "x".repeat(201))),
            ("title", create(&|d| d.title = "x".repeat(100_000))),
            ("title", create(&|d| d.title = "a\nb".to_owned())),
            ("title", create(&|d| d.title = "a\u{202E}b".to_owned())),
            ("schedule.days", create(&|d| d.schedule = days(&[]))),
            (
                "schedule.days",
                create(&|d| d.schedule = days(&["MO", "MO"])),
            ),
            ("schedule.days", create(&|d| d.schedule = days(&["mo"]))),
            (
                "schedule.days",
                create(&|d| d.schedule = days(&["MO", "TU", "WE", "TH", "FR", "SA", "SU", "MO"])),
            ),
            (
                "schedule.target",
                create(&|d| d.schedule = HabitScheduleDto::Weekly { target: 0 }),
            ),
            (
                "schedule.target",
                create(&|d| d.schedule = HabitScheduleDto::Weekly { target: 8 }),
            ),
            ("startOn", create(&|d| d.start_on = "2026-11-18".to_owned())),
            ("startOn", create(&|d| d.start_on = "2026-02-30".to_owned())),
            ("startOn", create(&|d| d.start_on = "1899-12-31".to_owned())),
            ("startOn", create(&|d| d.start_on = "2026-1-5".to_owned())),
            ("startOn", create(&|d| d.start_on = "9".repeat(10_000))),
            (
                "reminder.time",
                create(&|d| d.reminder = reminder("24:00", &["MO"], true)),
            ),
            (
                "reminder.time",
                create(&|d| d.reminder = reminder("7:00", &["MO"], true)),
            ),
            (
                "reminder.days",
                create(&|d| d.reminder = reminder("20:00", &[], true)),
            ),
            (
                "reminder.days",
                create(&|d| d.reminder = reminder("20:00", &["MO", "MO"], true)),
            ),
            (
                "reminder.timeZone",
                create(&|d| {
                    d.reminder = Some(HabitReminderInputDto {
                        time_zone: "Mars/Phobos".to_owned(),
                        ..reminder("20:00", &["MO"], true).expect("some")
                    });
                }),
            ),
            (
                "reminder.timeZone",
                create(&|d| {
                    d.reminder = Some(HabitReminderInputDto {
                        time_zone: "E".repeat(10_000),
                        ..reminder("20:00", &["MO"], true).expect("some")
                    });
                }),
            ),
        ];
        for (field, dto) in cases {
            let at = format!("{field} {}", dto.title.chars().take(8).collect::<String>());
            assert_eq!(err(create_habit(ctx, dto).await), invalid(field), "{at}");
        }

        // The same checks guard the update (same function), with the id first.
        assert_eq!(
            err(update_habit(ctx, "x".to_owned(), input_dto("t", None)).await),
            invalid("id")
        );
        assert_eq!(
            err(update_habit(ctx, uuid(1), input_dto("", None)).await),
            invalid("title")
        );
        assert_eq!(
            err(update_habit(ctx, uuid(1), input_dto("t", reminder("20:00", &[], true))).await),
            invalid("reminder.days")
        );
        assert_eq!(
            err(set_habit_archived(ctx, "x".to_owned(), true).await),
            invalid("id")
        );
        assert_eq!(err(delete_habit(ctx, "x".to_owned()).await), invalid("id"));

        // Ranges of checks.
        let range =
            |from: &str, to: &str| habit_checks_between(ctx, from.to_owned(), to.to_owned());
        assert_eq!(err(range("2026-02-30", TODAY).await), invalid("from"));
        assert_eq!(err(range(TODAY, "nope").await), invalid("to"));
        assert_eq!(err(range(&"1".repeat(5000), TODAY).await), invalid("from"));
        assert_eq!(err(range("2026-11-17", TODAY).await), invalid("to"));
        // 399 days apart is the widest range (400 days, bounds included): it reaches the disk.
        assert_eq!(
            err(range("2026-01-01", "2027-02-04").await),
            ScheduleError::Database
        );
        assert_eq!(err(range("2026-01-01", "2027-02-05").await), invalid("to"));
        assert_eq!(err(range("1900-01-01", "2199-12-31").await), invalid("to"));

        // A single check.
        let check = |habit: String, day: &str| set_habit_check(ctx, habit, day.to_owned(), true);
        assert_eq!(err(check("x".to_owned(), TODAY).await), invalid("habitId"));
        assert_eq!(err(check(uuid(1), "2026-11-18").await), invalid("dayOn"));
        assert_eq!(err(check(uuid(1), "2026-13-01").await), invalid("dayOn"));
        assert_eq!(err(check(uuid(1), "1899-12-31").await), invalid("dayOn"));
        assert_eq!(
            err(check(uuid(1), &"9".repeat(5000)).await),
            invalid("dayOn")
        );
        assert_eq!(
            err(check(uuid(1), "2026-11-17").await),
            ScheduleError::Database
        );
        assert_eq!(fx.wakes(), 0, "nothing was committed, nobody was woken");
    });
}

// ---------------------------------------------------------------------------------------------
// The table of 4.3, command by command
// ---------------------------------------------------------------------------------------------

#[test]
fn create_stores_the_habit_and_its_reminder_in_the_canonical_form() {
    let fx = Fx::new();
    run(async {
        let dto = fx.make(1, "20:00").await;
        assert_eq!(dto.title, "Méditer");
        assert_eq!(fx.wakes(), 1);

        let row = fx.reminder_row(1).await;
        assert_eq!(row.habit_id, Some(uuid(1)));
        assert_eq!(row.title, "Méditer");
        assert_eq!(row.start_local, "2026-11-16T20:00:00");
        assert_eq!(row.time_zone, PARIS);
        assert_eq!(row.rrule.as_deref(), Some("FREQ=DAILY"));
        assert_eq!(row.exdates, "[]");
        assert!(row.enabled);
        assert_eq!(row.created_at, NOW);

        // Without a reminder: nothing is written for it, nobody is woken.
        let before = fx.wakes();
        let plain = create_habit(&fx.ctx, create_dto(2, None))
            .await
            .expect("create");
        assert!(plain.reminder.is_none());
        assert_eq!(fx.wakes(), before);
        assert_eq!(fx.count("reminders").await, 1);

        // Some days of the week give a weekly rule; a disabled reminder has no cache.
        let weekly = create_habit(
            &fx.ctx,
            create_dto(3, reminder("07:30", &["WE", "MO", "FR"], false)),
        )
        .await
        .expect("create");
        let reminder_dto = weekly.reminder.expect("reminder");
        assert_eq!(reminder_dto.days, ["MO", "WE", "FR"]);
        assert_eq!(reminder_dto.time, "07:30");
        assert!(!reminder_dto.enabled);
        assert_eq!(reminder_dto.next_fire_at, None);
        let row = fx.reminder_row(3).await;
        assert_eq!(row.rrule.as_deref(), Some("FREQ=WEEKLY;BYDAY=MO,WE,FR"));
    });
}

#[test]
fn create_refuses_an_existing_id_and_a_full_table_without_writing() {
    let fx = Fx::new();
    run(async {
        fx.make(1, "20:00").await;
        let wakes = fx.wakes();
        assert_eq!(
            err(create_habit(&fx.ctx, create_dto(1, reminder("21:00", &WEEK, true))).await),
            ScheduleError::Conflict
        );
        assert_eq!(fx.count("habits").await, 1);
        assert_eq!(fx.count("reminders").await, 1);
        assert_eq!(fx.wakes(), wakes, "a refused creation wakes nobody");

        // L17: the 101st habit.
        let mut conn = store::connect(&fx.ctx.db).await.expect("connect");
        for n in 2..=100 {
            let stamp = NOW.to_owned();
            let row = HabitRow {
                id: uuid(n),
                title: format!("H{n}"),
                schedule: HabitSchedule::Weekly { target: 1 },
                start_on: START.to_owned(),
                archived_at: None,
                created_at: stamp.clone(),
                updated_at: stamp,
            };
            habit_store::insert_habit(&mut conn, &row)
                .await
                .expect("insert");
        }
        store::close(conn).await;
        assert_eq!(
            err(create_habit(&fx.ctx, create_dto(500, reminder("21:00", &WEEK, true))).await),
            ScheduleError::LimitReached
        );
        assert_eq!(fx.count("habits").await, 100);
        assert_eq!(fx.count("reminders").await, 1);
        assert_eq!(fx.wakes(), wakes);
    });
}

#[test]
fn a_full_reminder_table_refuses_the_habit_as_a_whole() {
    let fx = Fx::new();
    run(async {
        // L17: the 1001st reminder; the habit itself is not written either.
        let mut conn = store::connect(&fx.ctx.db).await.expect("connect");
        let mut tx = sqlx::Connection::begin(&mut conn).await.expect("begin");
        for n in 0..1000u32 {
            let row = ReminderRow {
                id: uuid(10_000 + n),
                title: "R".to_owned(),
                start_local: "2026-11-20T09:00:00".to_owned(),
                time_zone: PARIS.to_owned(),
                rrule: None,
                exdates: "[]".to_owned(),
                enabled: false,
                next_fire_at: None,
                next_fire_key: None,
                habit_id: None,
                created_at: NOW.to_owned(),
                updated_at: NOW.to_owned(),
            };
            store::insert_reminder(&mut tx, &row).await.expect("insert");
        }
        tx.commit().await.expect("commit");
        store::close(conn).await;

        assert_eq!(
            err(create_habit(&fx.ctx, create_dto(1, reminder("20:00", &WEEK, true))).await),
            ScheduleError::LimitReached
        );
        assert_eq!(fx.count("habits").await, 0);
        assert_eq!(fx.count("reminders").await, 1000);
        assert_eq!(fx.wakes(), 0);
        // Without a reminder the habit is accepted.
        create_habit(&fx.ctx, create_dto(1, None))
            .await
            .expect("create");
    });
}

#[test]
fn list_returns_every_habit_in_creation_order_with_its_reminder() {
    let fx = Fx::new();
    run(async {
        assert!(list_habits(&fx.ctx).await.expect("list").is_empty());
        fx.make(2, "20:00").await;
        fx.set("2026-11-16T08:00:01.000Z");
        create_habit(&fx.ctx, create_dto(1, None))
            .await
            .expect("create");
        fx.set("2026-11-16T08:00:02.000Z");
        create_habit(&fx.ctx, create_dto(3, reminder("07:00", &["MO"], false)))
            .await
            .expect("create");
        set_habit_archived(&fx.ctx, uuid(1), true)
            .await
            .expect("archive");
        let wakes = fx.wakes();

        let listed = list_habits(&fx.ctx).await.expect("list");
        let ids: Vec<&str> = listed.iter().map(|h| h.id.as_str()).collect();
        assert_eq!(ids, [uuid(2), uuid(1), uuid(3)]);
        assert!(listed[0].reminder.is_some());
        assert!(listed[1].reminder.is_none());
        assert!(listed[1].archived_at.is_some(), "archived ones are listed");
        let third = listed[2].reminder.as_ref().expect("reminder");
        assert_eq!(json(&third.status), r#""disabled""#);
        assert_eq!(fx.wakes(), wakes, "a read wakes nobody");

        // A rule that left the two forms (written outside the Rust) is `invalid`, with no days.
        fx.exec("UPDATE reminders SET rrule = 'FREQ=MONTHLY;BYMONTHDAY=3'")
            .await;
        let listed = list_habits(&fx.ctx).await.expect("list");
        let broken = listed[0].reminder.as_ref().expect("reminder");
        assert_eq!(json(&broken.status), r#""invalid""#);
        assert!(broken.days.is_empty());
    });
}

#[test]
fn update_replaces_the_habit_and_creates_changes_or_removes_the_reminder() {
    let fx = Fx::new();
    run(async {
        let plain = create_habit(&fx.ctx, create_dto(1, None))
            .await
            .expect("create");
        assert_eq!(
            err(update_habit(&fx.ctx, uuid(9), input_dto("t", None)).await),
            ScheduleError::NotFound
        );
        assert_eq!(fx.wakes(), 0);

        // A title change alone does not touch a reminder: no wake.
        fx.set("2026-11-16T08:30:00.000Z");
        let renamed = update_habit(&fx.ctx, uuid(1), input_dto("Lire", None))
            .await
            .expect("update");
        assert_eq!(renamed.title, "Lire");
        assert_eq!(renamed.created_at, plain.created_at);
        assert_eq!(renamed.updated_at, "2026-11-16T08:30:00.000Z");
        assert_eq!(fx.wakes(), 0);

        // The reminder is created, with the habit's title.
        let mut dto = input_dto("Lire", reminder("20:00", &["MO", "TH"], true));
        dto.schedule = HabitScheduleDto::Weekly { target: 2 };
        dto.start_on = "2026-11-10".to_owned();
        let updated = update_habit(&fx.ctx, uuid(1), dto).await.expect("update");
        assert_eq!(
            serde_json::to_value(&updated.schedule).expect("json"),
            serde_json::json!({"kind":"weekly","target":2})
        );
        assert_eq!(updated.start_on, "2026-11-10");
        assert_eq!(fx.wakes(), 1);
        let first = fx.reminder_row(1).await;
        assert_eq!(first.title, "Lire");
        assert_eq!(first.rrule.as_deref(), Some("FREQ=WEEKLY;BYDAY=MO,TH"));
        assert_eq!(first.start_local, "2026-11-16T20:00:00");

        // Two days later, same time: the anchor is kept; the zone of the form is ignored.
        fx.set("2026-11-18T08:00:00.000Z");
        let mut same = input_dto("Lire plus", reminder("20:00", &["MO", "TH"], true));
        if let Some(r) = same.reminder.as_mut() {
            r.time_zone = "America/Montreal".to_owned();
        }
        update_habit(&fx.ctx, uuid(1), same).await.expect("update");
        let kept = fx.reminder_row(1).await;
        assert_eq!(kept.id, first.id);
        assert_eq!(kept.start_local, "2026-11-16T20:00:00");
        assert_eq!(kept.time_zone, PARIS);
        assert_eq!(kept.title, "Lire plus");
        assert_eq!(kept.created_at, first.created_at);
        assert_eq!(fx.wakes(), 2);

        // Another time: the anchor is today's date at the new time.
        update_habit(
            &fx.ctx,
            uuid(1),
            input_dto("Lire plus", reminder("21:15", &WEEK, true)),
        )
        .await
        .expect("update");
        let moved = fx.reminder_row(1).await;
        assert_eq!(moved.start_local, "2026-11-18T21:15:00");
        assert_eq!(moved.rrule.as_deref(), Some("FREQ=DAILY"));
        assert_eq!(fx.count("reminders").await, 1);

        // No reminder in the input removes it.
        update_habit(&fx.ctx, uuid(1), input_dto("Lire plus", None))
            .await
            .expect("update");
        assert_eq!(fx.count("reminders").await, 0);
        assert_eq!(fx.wakes(), 4);
    });
}

#[test]
fn update_never_enables_the_reminder_of_an_archived_habit() {
    let fx = Fx::new();
    run(async {
        fx.make(1, "20:00").await;
        set_habit_archived(&fx.ctx, uuid(1), true)
            .await
            .expect("archive");
        let dto = update_habit(
            &fx.ctx,
            uuid(1),
            input_dto("Méditer", reminder("20:00", &WEEK, true)),
        )
        .await
        .expect("update");
        let reminder_dto = dto.reminder.expect("reminder");
        assert!(!reminder_dto.enabled);
        assert_eq!(reminder_dto.next_fire_at, None);
        assert!(dto.archived_at.is_some(), "the archive date is kept");
    });
}

#[test]
fn archive_disables_the_reminder_and_restore_leaves_it_disabled() {
    let fx = Fx::new();
    run(async {
        // L14.
        fx.make(1, "20:00").await;
        fx.check(1, "2026-11-15", true).await;
        assert_eq!(
            err(set_habit_archived(&fx.ctx, uuid(9), true).await),
            ScheduleError::NotFound
        );
        let wakes = fx.wakes();

        fx.set("2026-11-16T09:00:00.000Z");
        let archived = set_habit_archived(&fx.ctx, uuid(1), true)
            .await
            .expect("archive");
        assert_eq!(
            archived.archived_at.as_deref(),
            Some("2026-11-16T09:00:00.000Z")
        );
        let reminder_dto = archived.reminder.expect("reminder");
        assert!(!reminder_dto.enabled);
        assert_eq!(reminder_dto.next_fire_at, None);
        assert_eq!(json(&reminder_dto.status), r#""disabled""#);
        assert_eq!(fx.wakes(), wakes + 1);

        // Archiving again keeps the first date.
        fx.set("2026-11-16T10:00:00.000Z");
        let again = set_habit_archived(&fx.ctx, uuid(1), true)
            .await
            .expect("archive");
        assert_eq!(
            again.archived_at.as_deref(),
            Some("2026-11-16T09:00:00.000Z")
        );

        // No toast while archived.
        fx.set(EVENING_Z);
        fx.tick().await;
        assert!(fx.toast_titles().is_empty());

        // Restore: the reminder stays disabled, the checks are kept; nobody is woken for it.
        let wakes = fx.wakes();
        let restored = set_habit_archived(&fx.ctx, uuid(1), false)
            .await
            .expect("restore");
        assert_eq!(restored.archived_at, None);
        assert!(!restored.reminder.expect("reminder").enabled);
        assert_eq!(fx.wakes(), wakes);
        assert_eq!(fx.count("habit_checks").await, 1);
    });
}

#[test]
fn delete_removes_checks_reminder_and_deliveries_and_settles_first() {
    let fx = Fx::new();
    run(async {
        // L12: a reminder already due is delivered (toast) before it is deleted.
        fx.make(1, "20:00").await;
        fx.check(1, "2026-11-10", true).await;
        fx.set(EVENING_Z);
        let wakes = fx.wakes();
        assert!(delete_habit(&fx.ctx, uuid(1)).await.expect("delete"));
        assert_eq!(fx.toast_titles(), ["Méditer"]);
        assert_eq!(fx.wakes(), wakes + 1);
        for table in ["habits", "habit_checks", "reminders", "reminder_deliveries"] {
            assert_eq!(fx.count(table).await, 0, "{table}");
        }
        // A second pass shows nothing more.
        fx.tick().await;
        assert_eq!(fx.toast_titles().len(), 1);

        // Absent: false (and still a wake: the deletion may have changed a deadline).
        assert!(!delete_habit(&fx.ctx, uuid(1)).await.expect("delete"));
    });
}

#[test]
fn an_unreadable_habit_is_ignored_by_the_list_and_still_deletable() {
    let fx = Fx::new();
    run(async {
        fx.make(1, "20:00").await;
        // A mask out of bounds, written outside the Rust with the CHECK switched off.
        let mut conn = store::connect(&fx.ctx.db).await.expect("connect");
        sqlx::query("PRAGMA ignore_check_constraints = ON")
            .execute(&mut conn)
            .await
            .expect("pragma");
        sqlx::query(
            "INSERT INTO habits (id, title, kind, days_mask, weekly_target, start_on, created_at, \
             updated_at) VALUES (?1, 'x', 'days', 200, NULL, '2026-11-09', ?2, ?2)",
        )
        .bind(uuid(7))
        .bind(NOW)
        .execute(&mut conn)
        .await
        .expect("insert");
        store::close(conn).await;

        let listed = list_habits(&fx.ctx).await.expect("list");
        assert_eq!(listed.len(), 1);
        assert_eq!(
            err(set_habit_archived(&fx.ctx, uuid(7), true).await),
            ScheduleError::NotFound
        );
        assert!(delete_habit(&fx.ctx, uuid(7)).await.expect("delete"));
        assert_eq!(fx.count("habits").await, 1);
    });
}

#[test]
fn checks_between_returns_the_rows_of_the_range_bounds_included() {
    let fx = Fx::new();
    run(async {
        fx.make(1, "20:00").await;
        create_habit(&fx.ctx, create_dto(2, None))
            .await
            .expect("create");
        fx.check(2, "2026-11-12", true).await;
        fx.check(1, "2026-11-14", true).await;
        fx.check(1, "2026-11-10", true).await;
        fx.check(1, "2026-11-16", true).await;
        fx.check(1, "2026-11-09", true).await;
        let wakes = fx.wakes();

        let rows = habit_checks_between(&fx.ctx, "2026-11-10".to_owned(), TODAY.to_owned())
            .await
            .expect("range");
        let pairs: Vec<(String, String)> =
            rows.into_iter().map(|r| (r.habit_id, r.day_on)).collect();
        assert_eq!(
            pairs,
            [
                (uuid(1), "2026-11-10".to_owned()),
                (uuid(1), "2026-11-14".to_owned()),
                (uuid(1), "2026-11-16".to_owned()),
                (uuid(2), "2026-11-12".to_owned()),
            ]
        );
        let one = habit_checks_between(&fx.ctx, TODAY.to_owned(), TODAY.to_owned())
            .await
            .expect("one day");
        assert_eq!(one.len(), 1);
        // The widest range (400 days, bounds included) is accepted.
        habit_checks_between(&fx.ctx, "2026-01-01".to_owned(), "2027-02-04".to_owned())
            .await
            .expect("400 days");
        assert_eq!(fx.wakes(), wakes);
    });
}

#[test]
fn set_check_validates_the_day_and_is_idempotent() {
    let fx = Fx::new();
    run(async {
        create_habit(&fx.ctx, create_dto(1, None))
            .await
            .expect("create");
        // L10: unknown habit, after the last allowed day, before the start.
        assert_eq!(
            err(set_habit_check(&fx.ctx, uuid(9), TODAY.to_owned(), true).await),
            ScheduleError::NotFound
        );
        assert_eq!(
            err(set_habit_check(&fx.ctx, uuid(1), "2026-11-18".to_owned(), true).await),
            invalid("dayOn")
        );
        assert_eq!(
            err(set_habit_check(&fx.ctx, uuid(1), "2026-11-08".to_owned(), true).await),
            invalid("dayOn")
        );
        // The start day itself and the last allowed day (UTC date plus one) are accepted.
        assert!(fx.check(1, START, true).await);
        assert!(fx.check(1, "2026-11-17", true).await);
        assert_eq!(fx.count("habit_checks").await, 2);

        // L11: idempotent.
        assert!(!fx.check(1, START, true).await);
        assert!(fx.check(1, START, false).await);
        assert!(!fx.check(1, START, false).await);
        assert_eq!(fx.count("habit_checks").await, 1);
        // The row of a check: stamped by the clock.
        let mut conn = store::connect(&fx.ctx.db).await.expect("connect");
        let stamp: String = sqlx::query_scalar("SELECT created_at FROM habit_checks")
            .fetch_one(&mut conn)
            .await
            .expect("stamp");
        store::close(conn).await;
        assert_eq!(stamp, NOW);
    });
}

// ---------------------------------------------------------------------------------------------
// D3: the reminder is silent when the day is checked (CA-H2-1: L1 to L6, with the real tick)
// ---------------------------------------------------------------------------------------------

#[test]
fn l1_a_checked_day_silences_tonights_reminder() {
    let fx = Fx::new();
    run(async {
        fx.make(1, "20:00").await;
        assert_eq!(
            fx.reminder_row(1).await.next_fire_at.as_deref(),
            Some("2026-11-16T19:00:00.000Z")
        );
        let wakes = fx.wakes();
        assert!(fx.check(1, TODAY, true).await);
        let row = fx.reminder_row(1).await;
        assert_eq!(row.exdates, r#"["2026-11-16T20:00:00"]"#);
        assert_eq!(
            row.next_fire_at.as_deref(),
            Some("2026-11-17T19:00:00.000Z")
        );
        assert_eq!(row.next_fire_key.as_deref(), Some("2026-11-17T20:00:00"));
        assert_eq!(row.updated_at, NOW, "derived state: not a user edit");
        assert_eq!(fx.wakes(), wakes + 1);

        fx.set(EVENING_Z);
        fx.tick().await;
        assert!(fx.toast_titles().is_empty(), "no toast tonight");
        assert_eq!(fx.count("reminder_deliveries").await, 0);

        // The next evening it sounds again.
        fx.set("2026-11-17T19:00:30.000Z");
        fx.tick().await;
        assert_eq!(fx.toast_titles(), ["Méditer"]);
    });
}

#[test]
fn l2_unchecking_brings_the_reminder_back() {
    let fx = Fx::new();
    run(async {
        fx.make(1, "20:00").await;
        fx.check(1, TODAY, true).await;
        fx.set("2026-11-16T09:00:00.000Z");
        assert!(fx.check(1, TODAY, false).await);
        let row = fx.reminder_row(1).await;
        assert_eq!(row.exdates, "[]");
        assert_eq!(
            row.next_fire_at.as_deref(),
            Some("2026-11-16T19:00:00.000Z")
        );
        fx.set(EVENING_Z);
        fx.tick().await;
        assert_eq!(fx.toast_titles(), ["Méditer"]);
    });
}

#[test]
fn l3_a_check_after_the_toast_changes_nothing_and_the_due_toast_comes_first() {
    let fx = Fx::new();
    run(async {
        fx.make(1, "20:00").await;
        // 20:03 in Paris, the scheduler thread has not run: the command settles the toast first.
        fx.set("2026-11-16T19:03:00.000Z");
        assert!(fx.check(1, TODAY, true).await);
        assert_eq!(fx.toast_titles(), ["Méditer"]);
        let row = fx.reminder_row(1).await;
        assert_eq!(row.exdates, "[]", "the key is past: no exception");
        assert_eq!(
            row.next_fire_at.as_deref(),
            Some("2026-11-17T19:00:00.000Z")
        );
    });
}

#[test]
fn l4_unchecking_after_a_silent_day_gives_no_retroactive_toast() {
    let fx = Fx::new();
    run(async {
        fx.make(1, "20:00").await;
        fx.check(1, TODAY, true).await;
        // 21:00 in Paris: tonight was silent.
        fx.set("2026-11-16T20:00:00.000Z");
        fx.tick().await;
        assert!(fx.check(1, TODAY, false).await);
        let row = fx.reminder_row(1).await;
        assert_eq!(row.exdates, "[]");
        assert_eq!(
            row.next_fire_at.as_deref(),
            Some("2026-11-17T19:00:00.000Z")
        );
        fx.tick().await;
        assert!(fx.toast_titles().is_empty());
        assert_eq!(fx.count("reminder_deliveries").await, 0);
    });
}

#[test]
fn l5_a_suspended_pc_catches_up_nothing_for_a_checked_day() {
    let fx = Fx::new();
    run(async {
        fx.make(1, "20:00").await;
        fx.check(1, TODAY, true).await;
        // Asleep from 19:00 to 21:00 (Paris): the pass at 21:00 finds nothing missed.
        fx.set("2026-11-16T20:00:00.000Z");
        fx.tick().await;
        assert!(fx.toast_titles().is_empty());
        assert!(unseen_deliveries(&fx.ctx, 10)
            .await
            .expect("unseen")
            .is_empty());
        assert_eq!(fx.count("reminder_deliveries").await, 0);
    });
}

#[test]
fn l6_changing_the_time_recomputes_the_exceptions() {
    let fx = Fx::new();
    run(async {
        fx.make(1, "20:00").await;
        fx.check(1, TODAY, true).await;
        // 20:30 in Paris: the 20:00 key is past; the new 21:00 key must be muted.
        fx.set("2026-11-16T19:30:00.000Z");
        update_habit(
            &fx.ctx,
            uuid(1),
            input_dto("Méditer", reminder("21:00", &WEEK, true)),
        )
        .await
        .expect("update");
        let row = fx.reminder_row(1).await;
        assert_eq!(row.exdates, r#"["2026-11-16T21:00:00"]"#);
        assert_eq!(
            row.next_fire_at.as_deref(),
            Some("2026-11-17T20:00:00.000Z")
        );
        fx.set("2026-11-16T20:00:30.000Z");
        fx.tick().await;
        assert!(fx.toast_titles().is_empty());
    });
}

#[test]
fn a_bonus_check_on_a_day_without_reminder_is_accepted() {
    let fx = Fx::new();
    run(async {
        // Monday only; the Tuesday check is a bonus and the reminder keeps its Monday rhythm.
        create_habit(&fx.ctx, create_dto(1, reminder("20:00", &["MO"], true)))
            .await
            .expect("create");
        assert!(fx.check(1, "2026-11-17", true).await);
        let row = fx.reminder_row(1).await;
        assert_eq!(row.exdates, r#"["2026-11-17T20:00:00"]"#);
        assert_eq!(
            row.next_fire_at.as_deref(),
            Some("2026-11-16T19:00:00.000Z")
        );
        assert!(fx.check(1, "2026-11-17", false).await);
        assert_eq!(fx.reminder_row(1).await.exdates, "[]");
    });
}

// ---------------------------------------------------------------------------------------------
// L16 and the wake-ups
// ---------------------------------------------------------------------------------------------
#[test]
fn the_generic_reminder_commands_do_not_see_a_habit_reminder() {
    let fx = Fx::new();
    run(async {
        let dto = fx.make(1, "20:00").await;
        let reminder_id = dto.reminder.expect("reminder").reminder_id;
        assert!(list_reminders(&fx.ctx).await.expect("list").is_empty());
        let wakes = fx.wakes();
        // delete_reminder reports `false` for an id it does not see (update gives NotFound,
        // see commands_tests).
        assert!(!delete_reminder(&fx.ctx, reminder_id).await.expect("delete"));
        assert_eq!(fx.count("reminders").await, 1);
        fx.set(EVENING_Z);
        fx.tick().await;
        assert_eq!(fx.toast_titles(), ["Méditer"]);
        assert!(unseen_deliveries(&fx.ctx, 10)
            .await
            .expect("unseen")
            .is_empty());
        // `reminder_delete` wakes the thread whatever it found (R3); nothing else did.
        assert_eq!(fx.wakes(), wakes + 1);
    });
}

#[test]
fn every_command_that_touches_a_reminder_wakes_the_scheduler_once() {
    let fx = Fx::new();
    run(async {
        let mut expected = 0;
        assert_eq!(fx.wakes(), 0);

        create_habit(&fx.ctx, create_dto(1, None))
            .await
            .expect("create");
        assert_eq!(fx.wakes(), expected, "habit_create without a reminder");
        create_habit(&fx.ctx, create_dto(2, reminder("20:00", &WEEK, true)))
            .await
            .expect("create");
        expected += 1;
        assert_eq!(fx.wakes(), expected, "habit_create with a reminder");

        update_habit(
            &fx.ctx,
            uuid(2),
            input_dto("Autre", reminder("20:30", &WEEK, true)),
        )
        .await
        .expect("update");
        expected += 1;
        assert_eq!(fx.wakes(), expected, "habit_update");

        assert!(fx.check(2, TODAY, true).await);
        expected += 1;
        assert_eq!(
            fx.wakes(),
            expected,
            "habit_set_check, derived exceptions changed"
        );
        assert!(!fx.check(2, TODAY, true).await);
        assert!(fx.check(1, TODAY, true).await);
        assert!(fx.check(2, "2026-11-10", true).await);
        assert_eq!(fx.wakes(), expected, "no reminder touched");

        set_habit_archived(&fx.ctx, uuid(2), true)
            .await
            .expect("archive");
        expected += 1;
        assert_eq!(fx.wakes(), expected, "habit_set_archived(true)");
        set_habit_archived(&fx.ctx, uuid(2), false)
            .await
            .expect("restore");
        assert_eq!(fx.wakes(), expected, "habit_set_archived(false)");

        delete_habit(&fx.ctx, uuid(2)).await.expect("delete");
        expected += 1;
        assert_eq!(fx.wakes(), expected, "habit_delete");

        list_habits(&fx.ctx).await.expect("list");
        habit_checks_between(&fx.ctx, TODAY.to_owned(), TODAY.to_owned())
            .await
            .expect("checks");
        assert_eq!(fx.wakes(), expected, "reads");
    });
}

// ---------------------------------------------------------------------------------------------
// S5 for the habit commands: the gate shared with the scheduler thread
// ---------------------------------------------------------------------------------------------

#[test]
fn habit_commands_and_the_scheduler_thread_share_the_gate_without_deadlock() {
    let fx = Fx::new();
    run(async {
        fx.make(1, "20:00").await;
    });
    let state = SchedulerState::new(fx.ctx.clone());
    worker::spawn(&state);

    let ctx = fx.ctx.clone();
    let (done, finished) = std::sync::mpsc::channel();
    tauri::async_runtime::spawn(async move {
        for i in 0..30 {
            let day = if i % 2 == 0 { "2026-11-15" } else { TODAY };
            set_habit_check(&ctx, uuid(1), day.to_owned(), true)
                .await
                .expect("check");
            list_habits(&ctx).await.expect("list");
            set_habit_check(&ctx, uuid(1), day.to_owned(), false)
                .await
                .expect("uncheck");
        }
        done.send(()).expect("send");
    });
    finished
        .recv_timeout(Duration::from_secs(30))
        .expect("the commands finished: no deadlock with the scheduler thread");

    // The woken thread shows the toast of the reminder that became due.
    fx.set(EVENING_Z);
    fx.ctx.signal.wake();
    let start = std::time::Instant::now();
    while fx.toast_titles().is_empty() && start.elapsed() < Duration::from_secs(10) {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(fx.toast_titles(), ["Méditer"]);
    worker::shutdown_within(&state, Duration::from_secs(3));
}

// ---------------------------------------------------------------------------------------------
// Review corrections
// ---------------------------------------------------------------------------------------------

/// A habit reminder whose engine inputs the engine refuses, or a failing write, is set up with
/// the CHECKs off on a side connection.
async fn raw_exec(fx: &Fx, statements: &[&str]) {
    let mut conn = store::connect(&fx.ctx.db).await.expect("connect");
    sqlx::query("PRAGMA ignore_check_constraints = ON")
        .execute(&mut conn)
        .await
        .expect("pragma");
    for sql in statements {
        sqlx::query(sql).execute(&mut conn).await.expect("exec");
    }
    store::close(conn).await;
}

#[test]
fn an_unreadable_reminder_does_not_block_a_check() {
    let fx = Fx::new();
    run(async {
        // Unreadable zone, then unreadable title: the check is recorded, the exceptions stay.
        for (n, sql) in [
            (1, "UPDATE reminders SET time_zone = 'Mars/Phobos'"),
            (2, "UPDATE reminders SET title = char(10) || 'x'"),
        ] {
            fx.make(n, "20:00").await;
            raw_exec(&fx, &[sql]).await;
            let before = fx.reminder_row(n).await;
            assert!(fx.check(n, TODAY, true).await, "habit {n}");
            let after = fx.reminder_row(n).await;
            assert_eq!(after.exdates, before.exdates, "habit {n}");
            assert_eq!(after.next_fire_at, before.next_fire_at, "habit {n}");
            assert_eq!(
                fx.count(&format!("habit_checks WHERE habit_id = '{}'", uuid(n)))
                    .await,
                1
            );
            raw_exec(&fx, &["DELETE FROM reminders"]).await;
        }
    });
}

#[test]
fn a_failing_exception_write_cancels_the_check() {
    let fx = Fx::new();
    run(async {
        fx.make(1, "20:00").await;
        raw_exec(
            &fx,
            &["CREATE TRIGGER refuse BEFORE UPDATE ON reminders \
               BEGIN SELECT RAISE(ABORT, 'x'); END"],
        )
        .await;
        let wakes = fx.wakes();
        let error = err(set_habit_check(&fx.ctx, uuid(1), TODAY.to_owned(), true).await);
        assert_eq!(error, ScheduleError::Database);
        assert_eq!(fx.count("habit_checks").await, 0);
        assert_eq!(fx.wakes(), wakes);
    });
}

#[test]
fn the_wake_up_survives_a_failing_read_back_after_the_commit() {
    let fx = Fx::new();
    run(async {
        fx.make(1, "20:00").await;
        // Writing the reminder deletes the habit (and, by cascade, the reminder) in the same
        // transaction: the commit succeeds, the read-back finds nothing.
        raw_exec(
            &fx,
            &["CREATE TRIGGER vanish AFTER UPDATE ON reminders \
               BEGIN DELETE FROM habits WHERE id = new.habit_id; END"],
        )
        .await;
        let wakes = fx.wakes();
        assert_eq!(
            err(update_habit(
                &fx.ctx,
                uuid(1),
                input_dto("Autre", reminder("21:00", &WEEK, true))
            )
            .await),
            ScheduleError::NotFound
        );
        assert_eq!(fx.wakes(), wakes + 1, "habit_update");
        assert_eq!(fx.count("habits").await, 0);

        fx.make(2, "20:00").await;
        let wakes = fx.wakes();
        assert_eq!(
            err(set_habit_archived(&fx.ctx, uuid(2), true).await),
            ScheduleError::NotFound
        );
        assert_eq!(fx.wakes(), wakes + 1, "habit_set_archived");
    });
}

#[test]
fn archiving_twice_touches_and_wakes_nothing_the_second_time() {
    let fx = Fx::new();
    run(async {
        fx.make(1, "20:00").await;
        set_habit_archived(&fx.ctx, uuid(1), true)
            .await
            .expect("archive");
        let wakes = fx.wakes();
        let before = fx.reminder_row(1).await;
        set_habit_archived(&fx.ctx, uuid(1), true)
            .await
            .expect("archive again");
        assert_eq!(fx.wakes(), wakes);
        assert_eq!(fx.reminder_row(1).await, before);
    });
}

#[test]
fn an_existing_id_is_a_conflict_even_when_the_table_is_full() {
    let fx = Fx::new();
    run(async {
        let mut conn = store::connect(&fx.ctx.db).await.expect("connect");
        for n in 1..=100 {
            let row = HabitRow {
                id: uuid(n),
                title: format!("H{n}"),
                schedule: HabitSchedule::Weekly { target: 1 },
                start_on: START.to_owned(),
                archived_at: None,
                created_at: NOW.to_owned(),
                updated_at: NOW.to_owned(),
            };
            habit_store::insert_habit(&mut conn, &row)
                .await
                .expect("insert");
        }
        store::close(conn).await;
        assert_eq!(
            err(create_habit(&fx.ctx, create_dto(1, None)).await),
            ScheduleError::Conflict
        );
        assert_eq!(
            err(create_habit(&fx.ctx, create_dto(101, None)).await),
            ScheduleError::LimitReached
        );
        assert_eq!(fx.count("habits").await, 100);
    });
}

#[test]
fn the_reminder_id_comes_from_the_front_and_an_existing_one_is_kept() {
    let fx = Fx::new();
    run(async {
        let mut input = reminder("20:00", &WEEK, true).expect("some");
        input.id = uuid(777);
        let dto = create_habit(&fx.ctx, create_dto(1, Some(input)))
            .await
            .expect("create");
        assert_eq!(dto.reminder.expect("reminder").reminder_id, uuid(777));

        // The id sent with an update is ignored while the habit has a reminder.
        let updated = update_habit(
            &fx.ctx,
            uuid(1),
            input_dto("Méditer", reminder("21:00", &WEEK, true)),
        )
        .await
        .expect("update");
        assert_eq!(updated.reminder.expect("reminder").reminder_id, uuid(777));

        // Another habit cannot reuse an id already taken by a reminder.
        let mut again = reminder("20:00", &WEEK, true).expect("some");
        again.id = uuid(777);
        assert_eq!(
            err(create_habit(&fx.ctx, create_dto(2, Some(again))).await),
            ScheduleError::Conflict
        );
        assert_eq!(fx.count("habits").await, 1, "nothing was written");

        // A bad reminder id is refused with its field name.
        let mut bad = reminder("20:00", &WEEK, true).expect("some");
        bad.id = "nope".to_owned();
        assert_eq!(
            err(create_habit(&fx.ctx, create_dto(3, Some(bad))).await),
            invalid("reminder.id")
        );
    });
}
