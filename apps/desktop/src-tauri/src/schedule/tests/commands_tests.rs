//! The schedule commands on a real database at the latest schema (spec 6.1, `commands_tests`): every row of the
//! table of 4.4, the exact serialisations, the bounds checked before any disk access, the
//! wake-ups after a commit (CA-R3-3) and the gate shared with the scheduler thread (S5).

use crate::backup::sqlite::supported_schema_version;
use crate::backup::test_support::{make_database, run};
use crate::schedule::commands::{
    create_reminder, delete_reminder, delete_session, history_sessions, list_reminders,
    mark_deliveries_seen, rename_session, running_sessions, start_session, stop_session,
    unseen_deliveries, update_reminder, DeliveryDto, HistoryCursorDto, MarkSeenDto,
    ReminderCreateDto, ReminderDto, ReminderInputDto, SessionDto, SessionStartDto,
};
use crate::schedule::error::ScheduleError;
use crate::schedule::notifier::RecordingNotifier;
use crate::schedule::reminder::{ReminderRow, ReminderStatus};
use crate::schedule::session::SessionKind;
use crate::schedule::store;
use crate::schedule::tick::{tick, Phase};
use crate::schedule::worker::{self, WakeSignal};
use crate::schedule::{SchedulerCtx, SchedulerState};
use crate::time::clock::{Clock, FixedClock};
use crate::time::error::{RuleErrorCode, TimeError};
use crate::time::formats::parse_instant;
use jiff::SignedDuration;
use sqlx::Connection;
use std::fmt::Debug;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tempfile::TempDir;

/// 09:00 in Paris (CET).
const NOW: &str = "2026-11-16T08:00:00.000Z";
const PARIS: &str = "Europe/Paris";

fn uuid(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012x}")
}

/// Wraps the fixed clock and counts the reads made by the scheduler thread (one per pass).
struct CountingClock {
    inner: Arc<FixedClock>,
    scheduler_reads: Arc<AtomicUsize>,
}

impl Clock for CountingClock {
    fn now(&self) -> jiff::Timestamp {
        if std::thread::current().name() == Some("homebase-scheduler") {
            self.scheduler_reads.fetch_add(1, Ordering::SeqCst);
        }
        self.inner.now()
    }
}

struct Fx {
    _dir: TempDir,
    ctx: Arc<SchedulerCtx>,
    clock: Arc<FixedClock>,
    scheduler_reads: Arc<AtomicUsize>,
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
        let scheduler_reads = Arc::new(AtomicUsize::new(0));
        let notifier = Arc::new(RecordingNotifier::default());
        let ctx = Arc::new(SchedulerCtx {
            db,
            clock: Arc::new(CountingClock {
                inner: clock.clone(),
                scheduler_reads: scheduler_reads.clone(),
            }),
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
            scheduler_reads,
        }
    }

    fn set(&self, now: &str) {
        self.clock.set(parse_instant(now).expect("instant"));
    }

    fn advance(&self, secs: i64) {
        self.clock.advance(SignedDuration::from_secs(secs));
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

    async fn raw_reminder(&self, n: u32) -> Option<ReminderRow> {
        let mut conn = store::connect(&self.ctx.db).await.expect("connect");
        let row = store::get_reminder(&mut conn, &uuid(n)).await.expect("get");
        store::close(conn).await;
        row
    }

    async fn insert_raw(&self, rows: &[ReminderRow]) {
        let mut conn = store::connect(&self.ctx.db).await.expect("connect");
        let mut tx = conn.begin().await.expect("begin");
        for row in rows {
            store::insert_reminder(&mut tx, row).await.expect("insert");
        }
        tx.commit().await.expect("commit");
        store::close(conn).await;
    }

    async fn make(
        &self,
        n: u32,
        title: &str,
        start_local: &str,
        rrule: Option<&str>,
    ) -> ReminderDto {
        create_reminder(&self.ctx, create_dto(n, title, start_local, rrule))
            .await
            .expect("create")
    }

    async fn start(&self, n: u32, kind: SessionKind, duration_ms: Option<i64>) -> SessionDto {
        start_session(&self.ctx, start_dto(n, kind, "", duration_ms))
            .await
            .expect("start")
    }
}

fn create_dto(n: u32, title: &str, start_local: &str, rrule: Option<&str>) -> ReminderCreateDto {
    ReminderCreateDto {
        id: uuid(n),
        title: title.to_owned(),
        start_local: start_local.to_owned(),
        time_zone: PARIS.to_owned(),
        rrule: rrule.map(str::to_owned),
        exdates: Vec::new(),
        enabled: true,
    }
}

fn input_dto(
    title: &str,
    start_local: &str,
    rrule: Option<&str>,
    exdates: &[&str],
    enabled: bool,
) -> ReminderInputDto {
    ReminderInputDto {
        title: title.to_owned(),
        start_local: start_local.to_owned(),
        time_zone: PARIS.to_owned(),
        rrule: rrule.map(str::to_owned),
        exdates: exdates.iter().map(|e| (*e).to_owned()).collect(),
        enabled,
    }
}

fn start_dto(n: u32, kind: SessionKind, label: &str, duration_ms: Option<i64>) -> SessionStartDto {
    SessionStartDto {
        id: uuid(n),
        kind,
        label: label.to_owned(),
        duration_ms,
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

fn raw_reminder_row(n: u32, title: &str, rrule: Option<&str>) -> ReminderRow {
    ReminderRow {
        id: uuid(n),
        title: title.to_owned(),
        start_local: "2026-11-20T09:00:00".to_owned(),
        time_zone: PARIS.to_owned(),
        rrule: rrule.map(str::to_owned),
        exdates: "[]".to_owned(),
        enabled: true,
        next_fire_at: None,
        next_fire_key: None,
        habit_id: None,
        created_at: NOW.to_owned(),
        updated_at: NOW.to_owned(),
    }
}

// ---------------------------------------------------------------------------------------------
// DTO and serialisations (CA-R3-1, spec 6.1)
// ---------------------------------------------------------------------------------------------

#[test]
fn input_dtos_are_camel_case_and_refuse_unknown_fields() {
    let create: ReminderCreateDto = serde_json::from_str(
        r#"{"id":"x","title":"t","startLocal":"2026-11-17T09:00:00","timeZone":"Europe/Paris","rrule":null,"exdates":[],"enabled":true}"#,
    )
    .expect("create dto");
    assert_eq!(create.start_local, "2026-11-17T09:00:00");
    assert_eq!(create.time_zone, PARIS);

    let with_extra = |extra: &str| {
        format!(
            r#"{{"title":"t","startLocal":"2026-11-17T09:00:00","timeZone":"Europe/Paris","rrule":null,"exdates":[],"enabled":true{extra}}}"#
        )
    };
    assert!(serde_json::from_str::<ReminderInputDto>(&with_extra("")).is_ok());
    assert!(serde_json::from_str::<ReminderInputDto>(&with_extra(r#","extra":1"#)).is_err());
    assert!(serde_json::from_str::<ReminderCreateDto>(&with_extra(r#","id":"x","z":1"#)).is_err());
    // snake_case names are not accepted.
    assert!(serde_json::from_str::<ReminderInputDto>(
        r#"{"title":"t","start_local":"2026-11-17T09:00:00","time_zone":"Europe/Paris","rrule":null,"exdates":[],"enabled":true}"#
    )
    .is_err());

    assert!(matches!(
        serde_json::from_str::<MarkSeenDto>(r#"{"kind":"all"}"#).expect("all"),
        MarkSeenDto::All {}
    ));
    let one: MarkSeenDto = serde_json::from_str(
        r#"{"kind":"one","reminderId":"a","occurrenceKey":"2026-11-17T09:00:00"}"#,
    )
    .expect("one");
    assert!(matches!(one, MarkSeenDto::One { reminder_id, .. } if reminder_id == "a"));
    assert!(serde_json::from_str::<MarkSeenDto>(r#"{"kind":"all","x":1}"#).is_err());
    assert!(serde_json::from_str::<MarkSeenDto>(
        r#"{"kind":"one","reminderId":"a","occurrenceKey":"2026-11-17T09:00:00","x":1}"#
    )
    .is_err());
    assert!(serde_json::from_str::<MarkSeenDto>(r#"{"kind":"One"}"#).is_err());

    let start: SessionStartDto = serde_json::from_str(
        r#"{"id":"x","kind":"pomodoro_work","label":"","durationMs":1500000}"#,
    )
    .expect("start");
    assert_eq!(start.kind, SessionKind::PomodoroWork);
    assert_eq!(start.duration_ms, Some(1_500_000));
    assert!(serde_json::from_str::<SessionStartDto>(
        r#"{"id":"x","kind":"pomodoro-work","label":"","durationMs":null}"#
    )
    .is_err());
    assert!(serde_json::from_str::<SessionStartDto>(
        r#"{"id":"x","kind":"stopwatch","label":"","durationMs":null,"extra":1}"#
    )
    .is_err());

    let cursor: HistoryCursorDto =
        serde_json::from_str(r#"{"startedAt":"2026-11-16T08:00:00.000Z","id":"x"}"#)
            .expect("cursor");
    assert_eq!(cursor.started_at, NOW);
    assert!(serde_json::from_str::<HistoryCursorDto>(
        r#"{"startedAt":"2026-11-16T08:00:00.000Z","id":"x","y":1}"#
    )
    .is_err());
}

#[test]
fn output_dtos_are_camel_case() {
    let fx = Fx::new();
    run(async {
        let reminder = fx.make(1, "Dentiste", "2026-11-17T09:00:00", None).await;
        let value = serde_json::to_value(&reminder).expect("json");
        let mut keys: Vec<&str> = value
            .as_object()
            .expect("object")
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "createdAt",
                "enabled",
                "exdates",
                "id",
                "nextFireAt",
                "nextFireKey",
                "rrule",
                "startLocal",
                "status",
                "timeZone",
                "title",
                "updatedAt"
            ]
        );
        assert_eq!(value["status"], "scheduled");

        let session = fx
            .start(2, SessionKind::PomodoroShortBreak, Some(300_000))
            .await;
        let value = serde_json::to_value(&session).expect("json");
        assert_eq!(value["kind"], "pomodoro_short_break");
        assert_eq!(value["endsAt"], "2026-11-16T08:05:00.000Z");
        assert!(value["endedAt"].is_null());
        assert!(value["endReason"].is_null());
        assert_eq!(value["startedAt"], NOW);

        let delivery = DeliveryDto {
            reminder_id: "r".to_owned(),
            title: "t".to_owned(),
            time_zone: PARIS.to_owned(),
            occurrence_key: "k".to_owned(),
            due_at: "d".to_owned(),
            outcome: "late".to_owned(),
            skipped_count: 2,
            seen_at: None,
            created_at: "c".to_owned(),
        };
        let value = serde_json::to_value(&delivery).expect("json");
        for key in [
            "reminderId",
            "timeZone",
            "occurrenceKey",
            "dueAt",
            "skippedCount",
            "seenAt",
            "createdAt",
        ] {
            assert!(value.get(key).is_some(), "{key}");
        }
    });
}

#[test]
fn errors_serialize_exactly() {
    let fx = Fx::without_database();
    run(async {
        let mut dto = create_dto(1, &"x".repeat(201), "2026-11-17T09:00:00", None);
        assert_eq!(
            json(&err(create_reminder(&fx.ctx, dto).await)),
            r#"{"kind":"invalid_input","field":"title"}"#
        );
        dto = create_dto(
            1,
            "t",
            "2026-11-02T09:00:00",
            Some("FREQ=DAILY;COUNT=3;UNTIL=20261231T225959Z"),
        );
        let error = err(create_reminder(&fx.ctx, dto).await);
        assert_eq!(
            error,
            ScheduleError::Time {
                error: TimeError::InvalidRule {
                    code: RuleErrorCode::CountAndUntil,
                    part: None,
                }
            }
        );
        assert_eq!(
            json(&error),
            r#"{"kind":"time","error":{"kind":"invalid_rule","code":"count_and_until","part":null}}"#
        );
        assert_eq!(
            json(&ScheduleError::AlreadyRunning),
            r#"{"kind":"already_running"}"#
        );
        assert_eq!(json(&ScheduleError::NotFound), r#"{"kind":"not_found"}"#);
        assert_eq!(
            json(&ScheduleError::LimitReached),
            r#"{"kind":"limit_reached"}"#
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
        let good = || create_dto(1, "Appeler", "2026-11-17T09:00:00", None);

        // Reminders.
        let mut dto = good();
        dto.id = "not-a-uuid".to_owned();
        assert_eq!(err(create_reminder(ctx, dto).await), invalid("id"));
        for title in ["", "   ", "a\u{0}b", "a\nb", "a\u{202E}b"] {
            let mut dto = good();
            dto.title = title.to_owned();
            assert_eq!(
                err(create_reminder(ctx, dto).await),
                invalid("title"),
                "{title:?}"
            );
        }
        let mut dto = good();
        dto.title = "é".repeat(201);
        assert_eq!(err(create_reminder(ctx, dto).await), invalid("title"));
        let mut dto = good();
        dto.title = "x".repeat(1_000_000);
        assert_eq!(err(create_reminder(ctx, dto).await), invalid("title"));
        let mut dto = good();
        dto.time_zone = "../../etc/passwd".to_owned();
        assert!(matches!(
            err(create_reminder(ctx, dto).await),
            ScheduleError::Time {
                error: TimeError::UnknownTimeZone { .. }
            }
        ));
        let mut dto = good();
        dto.start_local = "2026-11-17 09:00".to_owned();
        assert!(matches!(
            err(create_reminder(ctx, dto).await),
            ScheduleError::Time {
                error: TimeError::InvalidLocalDateTime { .. }
            }
        ));
        let mut dto = good();
        dto.exdates = vec!["2026-11-17T09:00:00".to_owned(); 367];
        assert!(matches!(
            err(create_reminder(ctx, dto).await),
            ScheduleError::Time {
                error: TimeError::InvalidExdate { .. }
            }
        ));
        let mut dto = good();
        dto.rrule = Some(format!("FREQ={}", "X".repeat(300)));
        assert!(matches!(
            err(create_reminder(ctx, dto).await),
            ScheduleError::Time {
                error: TimeError::InvalidRule {
                    code: RuleErrorCode::TooLong,
                    ..
                }
            }
        ));
        assert_eq!(
            err(update_reminder(
                ctx,
                "x".to_owned(),
                input_dto("t", "2026-11-17T09:00:00", None, &[], true)
            )
            .await),
            invalid("id")
        );
        assert_eq!(
            err(update_reminder(
                ctx,
                uuid(1),
                input_dto("", "2026-11-17T09:00:00", None, &[], true)
            )
            .await),
            invalid("title")
        );
        assert_eq!(
            err(delete_reminder(ctx, "x".to_owned()).await),
            invalid("id")
        );
        assert_eq!(err(unseen_deliveries(ctx, 0).await), invalid("limit"));
        assert_eq!(err(unseen_deliveries(ctx, 201).await), invalid("limit"));
        let one = |id: &str, key: &str| MarkSeenDto::One {
            reminder_id: id.to_owned(),
            occurrence_key: key.to_owned(),
        };
        assert_eq!(
            err(mark_deliveries_seen(ctx, one("x", "2026-11-17T09:00:00")).await),
            invalid("reminderId")
        );
        for key in [
            "2026-11-17T09:00",
            "2026-13-17T09:00:00",
            "2026-11-17T09:00:00Z",
            "",
        ] {
            assert_eq!(
                err(mark_deliveries_seen(ctx, one(&uuid(1), key)).await),
                invalid("occurrenceKey"),
                "{key:?}"
            );
        }

        // Sessions.
        let mut dto = start_dto(1, SessionKind::Countdown, "", Some(60_000));
        dto.id = "x".to_owned();
        assert_eq!(err(start_session(ctx, dto).await), invalid("id"));
        for label in ["a\nb", "a\u{0}b"] {
            assert_eq!(
                err(start_session(
                    ctx,
                    start_dto(1, SessionKind::Countdown, label, Some(60_000))
                )
                .await),
                invalid("label")
            );
        }
        assert_eq!(
            err(start_session(
                ctx,
                start_dto(1, SessionKind::Countdown, &"x".repeat(101), Some(60_000))
            )
            .await),
            invalid("label")
        );
        assert_eq!(
            err(start_session(
                ctx,
                start_dto(
                    1,
                    SessionKind::Countdown,
                    &"x".repeat(1_000_000),
                    Some(60_000)
                )
            )
            .await),
            invalid("label")
        );
        for (kind, duration) in [
            (SessionKind::Countdown, Some(999)),
            (SessionKind::Countdown, Some(86_400_001)),
            (SessionKind::Countdown, Some(-5)),
            (SessionKind::Countdown, None),
            (SessionKind::Stopwatch, Some(60_000)),
            (SessionKind::PomodoroWork, None),
        ] {
            assert_eq!(
                err(start_session(ctx, start_dto(1, kind, "", duration)).await),
                invalid("durationMs"),
                "{kind:?} {duration:?}"
            );
        }
        assert_eq!(err(stop_session(ctx, "x".to_owned()).await), invalid("id"));
        assert_eq!(
            err(rename_session(ctx, "x".to_owned(), String::new()).await),
            invalid("id")
        );
        assert_eq!(
            err(rename_session(ctx, uuid(1), "a\nb".to_owned()).await),
            invalid("label")
        );
        assert_eq!(
            err(delete_session(ctx, "x".to_owned()).await),
            invalid("id")
        );
        assert_eq!(err(history_sessions(ctx, None, 0).await), invalid("limit"));
        assert_eq!(
            err(history_sessions(ctx, None, 201).await),
            invalid("limit")
        );
        for (started_at, id) in [
            ("2026-11-16T08:00:00Z", uuid(1)),
            ("2026-11-16 08:00:00.000", uuid(1)),
            (NOW, "x".to_owned()),
        ] {
            let cursor = HistoryCursorDto {
                started_at: started_at.to_owned(),
                id,
            };
            assert_eq!(
                err(history_sessions(ctx, Some(cursor), 10).await),
                invalid("before")
            );
        }

        // A valid input does reach the disk, which here does not exist.
        assert_eq!(
            err(create_reminder(ctx, good()).await),
            ScheduleError::Database
        );
        assert_eq!(fx.wakes(), 0, "nothing was committed, nobody was woken");
    });
}

// ---------------------------------------------------------------------------------------------
// reminder_list / create / update / delete
// ---------------------------------------------------------------------------------------------

#[test]
fn list_orders_by_next_occurrence_then_title_and_flags_invalid_lines() {
    let fx = Fx::new();
    run(async {
        assert!(list_reminders(&fx.ctx).await.expect("empty").is_empty());
        fx.make(1, "Gamma", "2026-11-02T09:00:00", None).await; // past one-off: finished
        fx.make(2, "Alpha", "2026-11-18T09:00:00", None).await; // scheduled
        let mut disabled = create_dto(3, "Beta", "2026-11-19T09:00:00", None);
        disabled.enabled = false;
        create_reminder(&fx.ctx, disabled).await.expect("disabled");
        fx.make(4, "Early", "2026-11-17T09:00:00", None).await; // scheduled, earlier
                                                                // A line written outside the Rust, with a rule that does not parse.
        fx.insert_raw(&[raw_reminder_row(90, "Zeta", Some("FREQ=BOGUS!!"))])
            .await;

        let list = list_reminders(&fx.ctx).await.expect("list");
        let seen: Vec<(&str, ReminderStatus)> =
            list.iter().map(|r| (r.title.as_str(), r.status)).collect();
        assert_eq!(
            seen,
            [
                ("Early", ReminderStatus::Scheduled),
                ("Alpha", ReminderStatus::Scheduled),
                ("Beta", ReminderStatus::Disabled),
                ("Gamma", ReminderStatus::Finished),
                ("Zeta", ReminderStatus::Invalid),
            ]
        );
        assert_eq!(fx.wakes(), 4, "only the four creations woke the scheduler");
    });
}

#[test]
fn create_stores_the_canonical_form_and_the_cache() {
    let fx = Fx::new();
    run(async {
        let mut dto = create_dto(
            1,
            "Sport",
            "2026-11-18T09:00:00",
            Some("FREQ=WEEKLY;INTERVAL=1;BYDAY=WE,MO"),
        );
        dto.exdates = vec![
            "2026-11-25T09:00:00".to_owned(),
            "2026-11-23T09:00:00".to_owned(),
            "2026-11-25T09:00:00".to_owned(),
        ];
        let created = create_reminder(&fx.ctx, dto).await.expect("create");
        assert_eq!(created.rrule.as_deref(), Some("FREQ=WEEKLY;BYDAY=MO,WE"));
        assert_eq!(
            created.exdates,
            ["2026-11-23T09:00:00", "2026-11-25T09:00:00"]
        );
        assert_eq!(
            created.next_fire_at.as_deref(),
            Some("2026-11-18T08:00:00.000Z")
        );
        assert_eq!(
            created.next_fire_key.as_deref(),
            Some("2026-11-18T09:00:00")
        );
        assert_eq!(created.status, ReminderStatus::Scheduled);
        assert_eq!(created.created_at, NOW);
        assert_eq!(created.updated_at, NOW);
        assert_eq!(created.time_zone, PARIS);
        assert_eq!(fx.wakes(), 1);

        let stored = fx.raw_reminder(1).await.expect("row");
        assert_eq!(stored.rrule.as_deref(), Some("FREQ=WEEKLY;BYDAY=MO,WE"));
        assert_eq!(
            stored.exdates,
            r#"["2026-11-23T09:00:00","2026-11-25T09:00:00"]"#
        );
        assert_eq!(stored.next_fire_at, created.next_fire_at);
        assert_eq!(stored.next_fire_key, created.next_fire_key);
    });
}

#[test]
fn create_handles_disabled_finished_conflicting_and_full_cases() {
    let fx = Fx::new();
    run(async {
        // Disabled: no cache.
        let mut dto = create_dto(1, "Off", "2026-11-17T09:00:00", None);
        dto.enabled = false;
        let off = create_reminder(&fx.ctx, dto).await.expect("create");
        assert_eq!(off.next_fire_at, None);
        assert_eq!(off.next_fire_key, None);
        assert_eq!(off.status, ReminderStatus::Disabled);
        // A one-off in the past has no next occurrence.
        let past = fx.make(2, "Past", "2026-11-02T09:00:00", None).await;
        assert_eq!(past.next_fire_at, None);
        assert_eq!(past.status, ReminderStatus::Finished);

        // Same id: Conflict, nothing written, nobody woken.
        let wakes = fx.wakes();
        assert_eq!(
            err(create_reminder(&fx.ctx, create_dto(1, "Dup", "2026-11-18T09:00:00", None)).await),
            ScheduleError::Conflict
        );
        assert_eq!(fx.wakes(), wakes);
        assert_eq!(fx.raw_reminder(1).await.expect("row").title, "Off");

        // 1000 reminders in the table: the 1001st is refused, an invalid one never gets that far.
        let rows: Vec<ReminderRow> = (0..998)
            .map(|i| raw_reminder_row(1_000 + i, "Filler", None))
            .collect();
        fx.insert_raw(&rows).await;
        assert_eq!(list_reminders(&fx.ctx).await.expect("list").len(), 1000);
        assert_eq!(
            err(create_reminder(
                &fx.ctx,
                create_dto(5_000, "One too many", "2026-11-18T09:00:00", None)
            )
            .await),
            ScheduleError::LimitReached
        );
        assert!(fx.raw_reminder(5_000).await.is_none());
        assert_eq!(fx.wakes(), wakes);
        // An update is not limited.
        update_reminder(
            &fx.ctx,
            uuid(1),
            input_dto("Off 2", "2026-11-17T09:00:00", None, &[], false),
        )
        .await
        .expect("update at the limit");
    });
}

#[test]
fn update_replaces_the_series_and_recomputes_the_cache() {
    let fx = Fx::new();
    run(async {
        let created = fx.make(1, "Dentiste", "2026-11-17T09:00:00", None).await;
        assert_eq!(
            created.next_fire_key.as_deref(),
            Some("2026-11-17T09:00:00")
        );
        fx.advance(60);
        let later = "2026-11-16T08:01:00.000Z";

        // Title only: same keys, `created_at` kept, `updated_at` moved.
        let renamed = update_reminder(
            &fx.ctx,
            uuid(1),
            input_dto("Dentiste 2", "2026-11-17T09:00:00", None, &[], true),
        )
        .await
        .expect("rename");
        assert_eq!(renamed.title, "Dentiste 2");
        assert_eq!(renamed.next_fire_key, created.next_fire_key);
        assert_eq!(renamed.next_fire_at, created.next_fire_at);
        assert_eq!(renamed.created_at, NOW);
        assert_eq!(renamed.updated_at, later);

        // A new time makes a new key (D12).
        let moved = update_reminder(
            &fx.ctx,
            uuid(1),
            input_dto("Dentiste 2", "2026-11-17T10:00:00", None, &[], true),
        )
        .await
        .expect("move");
        assert_eq!(moved.next_fire_key.as_deref(), Some("2026-11-17T10:00:00"));
        assert_eq!(
            moved.next_fire_at.as_deref(),
            Some("2026-11-17T09:00:00.000Z")
        );

        // Disabling clears the cache, enabling again computes it from now (no catch-up).
        let off = update_reminder(
            &fx.ctx,
            uuid(1),
            input_dto("Dentiste 2", "2026-11-17T10:00:00", None, &[], false),
        )
        .await
        .expect("disable");
        assert_eq!(
            (off.next_fire_at, off.status),
            (None, ReminderStatus::Disabled)
        );
        let on = update_reminder(
            &fx.ctx,
            uuid(1),
            input_dto("Dentiste 2", "2026-11-17T10:00:00", None, &[], true),
        )
        .await
        .expect("enable");
        assert_eq!(on.next_fire_key.as_deref(), Some("2026-11-17T10:00:00"));

        // Skipping the next occurrence of a series (L14): the exception moves the cache.
        update_reminder(
            &fx.ctx,
            uuid(1),
            input_dto(
                "Dentiste 2",
                "2026-11-17T09:00:00",
                Some("FREQ=DAILY"),
                &[],
                true,
            ),
        )
        .await
        .expect("daily");
        let skipped = update_reminder(
            &fx.ctx,
            uuid(1),
            input_dto(
                "Dentiste 2",
                "2026-11-17T09:00:00",
                Some("FREQ=DAILY"),
                &["2026-11-17T09:00:00"],
                true,
            ),
        )
        .await
        .expect("skip");
        assert_eq!(
            skipped.next_fire_key.as_deref(),
            Some("2026-11-18T09:00:00")
        );
        assert_eq!(skipped.exdates, ["2026-11-17T09:00:00"]);
        assert_eq!(skipped.created_at, NOW);

        // Unknown id; invalid content leaves the row as it was.
        assert_eq!(
            err(update_reminder(
                &fx.ctx,
                uuid(7),
                input_dto("t", "2026-11-17T09:00:00", None, &[], true)
            )
            .await),
            ScheduleError::NotFound
        );
        let wakes = fx.wakes();
        assert!(update_reminder(
            &fx.ctx,
            uuid(1),
            input_dto("t", "2026-11-17T09:00:00", Some("FREQ=NOPE"), &[], true)
        )
        .await
        .is_err());
        assert_eq!(fx.wakes(), wakes);
        let stored = fx.raw_reminder(1).await.expect("row");
        assert_eq!(stored.title, "Dentiste 2");
        assert_eq!(stored.rrule.as_deref(), Some("FREQ=DAILY"));
    });
}

#[test]
fn delete_removes_the_reminder_and_its_deliveries() {
    let fx = Fx::new();
    run(async {
        fx.make(1, "R1", "2026-11-17T09:00:00", None).await;
        fx.make(2, "R2", "2026-11-17T09:30:00", None).await;
        fx.set("2026-11-17T08:40:00.000Z");
        let report = tick(&fx.ctx, Phase::Regular).await.expect("tick");
        assert_eq!(report.reminders_processed, 2);
        assert_eq!(unseen_deliveries(&fx.ctx, 10).await.expect("list").len(), 2);

        let wakes = fx.wakes();
        assert!(delete_reminder(&fx.ctx, uuid(1)).await.expect("delete"));
        assert_eq!(fx.wakes(), wakes + 1);
        let left = unseen_deliveries(&fx.ctx, 10).await.expect("list");
        assert_eq!(left.len(), 1, "the delivery went with its reminder");
        assert_eq!(left[0].reminder_id, uuid(2));
        assert!(!delete_reminder(&fx.ctx, uuid(1)).await.expect("again"));
        assert!(fx.raw_reminder(1).await.is_none());
    });
}

// ---------------------------------------------------------------------------------------------
// reminder_unseen_deliveries / reminder_mark_seen
// ---------------------------------------------------------------------------------------------

#[test]
fn unseen_deliveries_and_mark_seen() {
    let fx = Fx::new();
    run(async {
        fx.make(1, "R1", "2026-11-17T09:00:00", None).await;
        fx.make(2, "R2", "2026-11-17T09:30:00", None).await;
        fx.set("2026-11-17T08:40:00.000Z");
        tick(&fx.ctx, Phase::Regular).await.expect("tick");

        let unseen = unseen_deliveries(&fx.ctx, 200).await.expect("unseen");
        assert_eq!(unseen.len(), 2);
        // Same creation instant: ordered by reminder id.
        assert_eq!(unseen[0].reminder_id, uuid(1));
        assert_eq!(unseen[1].reminder_id, uuid(2));
        let first = &unseen[0];
        assert_eq!(first.title, "R1");
        assert_eq!(first.time_zone, PARIS);
        assert_eq!(first.occurrence_key, "2026-11-17T09:00:00");
        assert_eq!(first.due_at, "2026-11-17T08:00:00.000Z");
        assert_eq!(first.outcome, "late");
        assert_eq!(first.skipped_count, 0);
        assert_eq!(first.seen_at, None);
        assert_eq!(first.created_at, "2026-11-17T08:40:00.000Z");
        assert_eq!(unseen_deliveries(&fx.ctx, 1).await.expect("limit").len(), 1);

        let wakes = fx.wakes();
        let one = |n: u32| MarkSeenDto::One {
            reminder_id: uuid(n),
            occurrence_key: "2026-11-17T09:00:00".to_owned(),
        };
        assert_eq!(mark_deliveries_seen(&fx.ctx, one(1)).await.expect("one"), 1);
        assert_eq!(
            mark_deliveries_seen(&fx.ctx, one(1)).await.expect("again"),
            0
        );
        assert_eq!(
            mark_deliveries_seen(&fx.ctx, one(2))
                .await
                .expect("wrong key"),
            0
        );
        let left = unseen_deliveries(&fx.ctx, 200).await.expect("unseen");
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].reminder_id, uuid(2));
        assert_eq!(
            mark_deliveries_seen(&fx.ctx, MarkSeenDto::All {})
                .await
                .expect("all"),
            1
        );
        assert_eq!(
            mark_deliveries_seen(&fx.ctx, MarkSeenDto::All {})
                .await
                .expect("none"),
            0
        );
        assert!(unseen_deliveries(&fx.ctx, 200)
            .await
            .expect("unseen")
            .is_empty());
        assert_eq!(
            fx.wakes(),
            wakes,
            "reading and marking never move a deadline"
        );
    });
}

// ---------------------------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------------------------

#[test]
fn start_computes_the_end_from_the_clock() {
    let fx = Fx::new();
    run(async {
        let countdown = start_session(
            &fx.ctx,
            start_dto(1, SessionKind::Countdown, "Thé", Some(25 * 60_000)),
        )
        .await
        .expect("countdown");
        assert_eq!(countdown.kind, SessionKind::Countdown);
        assert_eq!(countdown.label, "Thé");
        assert_eq!(countdown.started_at, NOW);
        assert_eq!(
            countdown.ends_at.as_deref(),
            Some("2026-11-16T08:25:00.000Z")
        );
        assert_eq!((countdown.ended_at, countdown.end_reason), (None, None));
        assert_eq!(countdown.created_at, NOW);
        assert_eq!(countdown.updated_at, NOW);

        fx.advance(1);
        let watch = fx.start(2, SessionKind::Stopwatch, None).await;
        assert_eq!(watch.ends_at, None);
        assert_eq!(watch.started_at, "2026-11-16T08:00:01.000Z");
        let longest = fx.start(3, SessionKind::Countdown, Some(86_400_000)).await;
        assert_eq!(longest.ends_at.as_deref(), Some("2026-11-17T08:00:01.000Z"));

        let running = running_sessions(&fx.ctx).await.expect("running");
        let ids: Vec<&str> = running.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, [uuid(1), uuid(2), uuid(3)]);
        assert_eq!(fx.wakes(), 3);
    });
}

#[test]
fn a_single_pomodoro_and_twenty_sessions_at_most() {
    let fx = Fx::new();
    run(async {
        fx.start(1, SessionKind::PomodoroWork, Some(25 * 60_000))
            .await;
        let wakes = fx.wakes();
        assert_eq!(
            err(start_session(
                &fx.ctx,
                start_dto(2, SessionKind::PomodoroShortBreak, "", Some(60_000))
            )
            .await),
            ScheduleError::AlreadyRunning
        );
        assert_eq!(
            json(&ScheduleError::AlreadyRunning),
            r#"{"kind":"already_running"}"#
        );
        // A countdown is not a pomodoro.
        fx.start(3, SessionKind::Countdown, Some(60_000)).await;
        // Same id twice.
        assert_eq!(
            err(start_session(
                &fx.ctx,
                start_dto(3, SessionKind::Countdown, "", Some(60_000))
            )
            .await),
            ScheduleError::Conflict
        );
        assert_eq!(fx.wakes(), wakes + 1, "refused starts wake nobody");
        assert_eq!(running_sessions(&fx.ctx).await.expect("running").len(), 2);

        for n in 100..118 {
            fx.start(n, SessionKind::Stopwatch, None).await;
        }
        assert_eq!(running_sessions(&fx.ctx).await.expect("running").len(), 20);
        assert_eq!(
            err(start_session(&fx.ctx, start_dto(200, SessionKind::Stopwatch, "", None)).await),
            ScheduleError::LimitReached
        );
        assert_eq!(running_sessions(&fx.ctx).await.expect("running").len(), 20);
        // Stopping one frees a slot.
        stop_session(&fx.ctx, uuid(100)).await.expect("stop");
        fx.start(200, SessionKind::Stopwatch, None).await;
    });
}

#[test]
fn stop_ends_a_running_session_and_completes_a_finished_one() {
    let fx = Fx::new();
    run(async {
        fx.start(1, SessionKind::Countdown, Some(25 * 60_000)).await;
        fx.start(2, SessionKind::Countdown, Some(60_000)).await;
        fx.start(3, SessionKind::Stopwatch, None).await;
        assert_eq!(
            err(stop_session(&fx.ctx, uuid(9)).await),
            ScheduleError::NotFound
        );

        // Before its end: stopped at the clock.
        fx.advance(10);
        let wakes = fx.wakes();
        let stopped = stop_session(&fx.ctx, uuid(1)).await.expect("stop");
        assert_eq!(
            stopped.ended_at.as_deref(),
            Some("2026-11-16T08:00:10.000Z")
        );
        assert_eq!(stopped.end_reason.as_deref(), Some("stopped"));
        assert_eq!(stopped.updated_at, "2026-11-16T08:00:10.000Z");
        assert_eq!(fx.wakes(), wakes + 1);

        // Already over: returned as it is, nothing written, nobody woken (idempotent).
        fx.advance(5);
        let again = stop_session(&fx.ctx, uuid(1)).await.expect("again");
        assert_eq!(again.ended_at, stopped.ended_at);
        assert_eq!(again.updated_at, stopped.updated_at);
        assert_eq!(fx.wakes(), wakes + 1);

        // After its end but before the pass: completed at `ends_at`, without a toast.
        fx.advance(120);
        let completed = stop_session(&fx.ctx, uuid(2)).await.expect("complete");
        assert_eq!(
            completed.ended_at.as_deref(),
            Some("2026-11-16T08:01:00.000Z")
        );
        assert_eq!(completed.ends_at, completed.ended_at);
        assert_eq!(completed.end_reason.as_deref(), Some("completed"));
        // The command settled it first: the end toast is shown once.
        assert_eq!(fx.toast_titles(), ["Minuteur terminé"]);

        // A stopwatch has no end of its own.
        let watch = stop_session(&fx.ctx, uuid(3)).await.expect("watch");
        assert_eq!(watch.end_reason.as_deref(), Some("stopped"));
        assert_eq!(watch.ended_at.as_deref(), Some("2026-11-16T08:02:15.000Z"));
        assert!(running_sessions(&fx.ctx).await.expect("running").is_empty());
    });
}

#[test]
fn stop_never_ends_before_the_start_when_the_clock_went_back() {
    let fx = Fx::new();
    run(async {
        fx.start(1, SessionKind::Stopwatch, None).await;
        fx.set("2026-11-16T07:00:00.000Z");
        let stopped = stop_session(&fx.ctx, uuid(1)).await.expect("stop");
        assert_eq!(stopped.ended_at.as_deref(), Some(NOW));
        assert_eq!(stopped.started_at, NOW);
        assert_eq!(stopped.end_reason.as_deref(), Some("stopped"));
    });
}

#[test]
fn rename_and_delete_a_session() {
    let fx = Fx::new();
    run(async {
        fx.start(1, SessionKind::Stopwatch, None).await;
        fx.advance(30);
        let wakes = fx.wakes();
        let renamed = rename_session(&fx.ctx, uuid(1), "Lecture".to_owned())
            .await
            .expect("rename");
        assert_eq!(renamed.label, "Lecture");
        assert_eq!(renamed.updated_at, "2026-11-16T08:00:30.000Z");
        assert_eq!(renamed.started_at, NOW);
        assert_eq!(
            rename_session(&fx.ctx, uuid(1), String::new())
                .await
                .expect("empty")
                .label,
            ""
        );
        assert_eq!(
            err(rename_session(&fx.ctx, uuid(9), "x".to_owned()).await),
            ScheduleError::NotFound
        );
        assert_eq!(fx.wakes(), wakes, "a label is not a deadline");

        assert!(delete_session(&fx.ctx, uuid(1)).await.expect("delete"));
        assert!(!delete_session(&fx.ctx, uuid(1)).await.expect("again"));
        assert_eq!(fx.wakes(), wakes + 2);
        assert!(running_sessions(&fx.ctx).await.expect("running").is_empty());
    });
}

#[test]
fn history_lists_finished_sessions_newest_first_by_keyset() {
    let fx = Fx::new();
    run(async {
        // Five finished sessions a minute apart, one running.
        for n in 1..=5 {
            fx.start(n, SessionKind::Stopwatch, None).await;
            fx.advance(30);
            stop_session(&fx.ctx, uuid(n)).await.expect("stop");
            fx.advance(30);
        }
        fx.start(6, SessionKind::Stopwatch, None).await;

        let first = history_sessions(&fx.ctx, None, 2).await.expect("page 1");
        let ids = |page: &[SessionDto]| page.iter().map(|s| s.id.clone()).collect::<Vec<_>>();
        assert_eq!(ids(&first), [uuid(5), uuid(4)]);
        assert!(first.iter().all(|s| s.ended_at.is_some()));

        let cursor = |s: &SessionDto| HistoryCursorDto {
            started_at: s.started_at.clone(),
            id: s.id.clone(),
        };
        let second = history_sessions(&fx.ctx, Some(cursor(&first[1])), 2)
            .await
            .expect("page 2");
        assert_eq!(ids(&second), [uuid(3), uuid(2)]);
        let third = history_sessions(&fx.ctx, Some(cursor(&second[1])), 2)
            .await
            .expect("page 3");
        assert_eq!(ids(&third), [uuid(1)]);
        let all = history_sessions(&fx.ctx, None, 200).await.expect("all");
        assert_eq!(all.len(), 5);
        assert_eq!(running_sessions(&fx.ctx).await.expect("running").len(), 1);
    });
}

// ---------------------------------------------------------------------------------------------
// CA-R3-3: wake-ups after the commit
// ---------------------------------------------------------------------------------------------

#[test]
fn every_command_that_changes_a_deadline_wakes_the_scheduler_once() {
    let fx = Fx::new();
    run(async {
        let mut expected = 0;
        let mut check = |fx: &Fx, what: &str| {
            expected += 1;
            assert_eq!(fx.wakes(), expected, "{what}");
        };
        assert_eq!(fx.wakes(), 0);

        fx.make(1, "R", "2026-11-17T09:00:00", None).await;
        check(&fx, "reminder_create");
        update_reminder(
            &fx.ctx,
            uuid(1),
            input_dto("R", "2026-11-17T10:00:00", None, &[], true),
        )
        .await
        .expect("update");
        check(&fx, "reminder_update");
        delete_reminder(&fx.ctx, uuid(1)).await.expect("delete");
        check(&fx, "reminder_delete");
        fx.start(1, SessionKind::Countdown, Some(60_000)).await;
        check(&fx, "session_start");
        stop_session(&fx.ctx, uuid(1)).await.expect("stop");
        check(&fx, "session_stop");
        delete_session(&fx.ctx, uuid(1)).await.expect("delete");
        check(&fx, "session_delete");

        // The reads and the label do not.
        list_reminders(&fx.ctx).await.expect("list");
        unseen_deliveries(&fx.ctx, 10).await.expect("unseen");
        mark_deliveries_seen(&fx.ctx, MarkSeenDto::All {})
            .await
            .expect("seen");
        running_sessions(&fx.ctx).await.expect("running");
        history_sessions(&fx.ctx, None, 10).await.expect("history");
        fx.start(2, SessionKind::Stopwatch, None).await;
        let before = fx.wakes();
        rename_session(&fx.ctx, uuid(2), "x".to_owned())
            .await
            .expect("rename");
        assert_eq!(fx.wakes(), before);
    });
}

// ---------------------------------------------------------------------------------------------
// S5: the gate between the runtime's tasks and the scheduler thread
// ---------------------------------------------------------------------------------------------

fn wait_for_toast(fx: &Fx, within: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < within {
        if !fx.toast_titles().is_empty() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    false
}

/// Supposition S5: a command that holds the `tokio` mutex in a task of the Tauri runtime, and the
/// scheduler thread that takes the same mutex through `block_on`, do not deadlock. Commands run
/// in a loop (each one wakes the thread, so passes and commands contend for the gate), then a
/// command wakes the thread, which shows a toast for a reminder that became due.
#[test]
fn commands_and_the_scheduler_thread_share_the_gate_without_deadlock() {
    let fx = Fx::new();
    let state = SchedulerState::new(fx.ctx.clone());
    worker::spawn(&state);

    let ctx = fx.ctx.clone();
    let (done, finished) = std::sync::mpsc::channel();
    tauri::async_runtime::spawn(async move {
        for i in 0..30 {
            start_session(
                &ctx,
                start_dto(500 + i, SessionKind::Countdown, "", Some(3_600_000)),
            )
            .await
            .expect("start");
            list_reminders(&ctx).await.expect("list");
            stop_session(&ctx, uuid(500 + i)).await.expect("stop");
        }
        done.send(()).expect("send");
    });
    finished
        .recv_timeout(Duration::from_secs(30))
        .expect("the commands finished: no deadlock with the scheduler thread");
    let polled = Instant::now();
    while fx.scheduler_reads.load(Ordering::SeqCst) == 0
        && polled.elapsed() < Duration::from_secs(5)
    {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(
        fx.scheduler_reads.load(Ordering::SeqCst) >= 1,
        "the scheduler thread made at least one pass during the loop"
    );

    // 09:01:30 in Paris is 08:01:30Z: created before it, due when the clock jumps to 08:02:00Z.
    run(async {
        fx.make(1, "Appeler", "2026-11-16T09:01:30", None).await;
    });
    fx.set("2026-11-16T08:02:00.000Z");
    // A command would settle the reminder itself (it is due): wake the thread directly.
    fx.ctx.signal.wake();
    assert!(
        wait_for_toast(&fx, Duration::from_secs(10)),
        "the woken scheduler thread showed the toast"
    );
    assert_eq!(fx.toast_titles(), ["Appeler"]);

    worker::shutdown_within(&state, Duration::from_secs(3));
}

// ---------------------------------------------------------------------------------------------
// What is already due is settled before a command changes a deadline (D12, 4.4)
// ---------------------------------------------------------------------------------------------

#[test]
fn update_delivers_a_due_reminder_before_applying_the_change() {
    let fx = Fx::new();
    run(async {
        fx.make(1, "R1", "2026-11-17T09:00:00", None).await;
        fx.set("2026-11-17T08:00:30.000Z");
        let updated = update_reminder(
            &fx.ctx,
            uuid(1),
            input_dto("R1 bis", "2026-11-17T09:00:00", None, &[], true),
        )
        .await
        .expect("update");
        assert_eq!(updated.title, "R1 bis");
        // One delivery and one toast, with the title it had when it fell due.
        assert_eq!(fx.toast_titles(), ["R1"]);
        let unseen = unseen_deliveries(&fx.ctx, 10).await.expect("unseen");
        assert_eq!(unseen.len(), 1);
        assert_eq!(unseen[0].outcome, "on_time");
        tick(&fx.ctx, Phase::Regular).await.expect("tick");
        assert_eq!(fx.toast_titles().len(), 1);
    });
}

#[test]
fn delete_delivers_a_due_reminder_before_removing_it() {
    let fx = Fx::new();
    run(async {
        fx.make(1, "R1", "2026-11-17T09:00:00", None).await;
        fx.set("2026-11-17T08:40:00.000Z");
        assert!(delete_reminder(&fx.ctx, uuid(1)).await.expect("delete"));
        assert_eq!(fx.toast_titles(), ["Rappel manqué : R1"]);
        assert!(fx.raw_reminder(1).await.is_none());
        assert!(unseen_deliveries(&fx.ctx, 10)
            .await
            .expect("unseen")
            .is_empty());
    });
}

#[test]
fn start_completes_an_expired_pomodoro_first() {
    let fx = Fx::new();
    run(async {
        fx.start(1, SessionKind::PomodoroWork, Some(25 * 60_000))
            .await;
        fx.advance(26 * 60);
        let next = start_session(
            &fx.ctx,
            start_dto(2, SessionKind::PomodoroShortBreak, "", Some(5 * 60_000)),
        )
        .await
        .expect("the expired phase was completed first");
        assert_eq!(next.kind, SessionKind::PomodoroShortBreak);
        assert_eq!(fx.toast_titles(), ["Pomodoro terminé"]);
        let running = running_sessions(&fx.ctx).await.expect("running");
        assert_eq!(running.len(), 1);
        assert_eq!(running[0].id, uuid(2));
        let history = history_sessions(&fx.ctx, None, 10).await.expect("history");
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].end_reason.as_deref(), Some("completed"));
        assert_eq!(history[0].ended_at, history[0].ends_at);
    });
}

#[test]
fn a_clock_set_back_then_an_update_gives_no_second_toast() {
    let fx = Fx::new();
    run(async {
        fx.make(1, "R1", "2026-11-17T09:00:00", None).await;
        fx.set("2026-11-17T08:00:10.000Z");
        tick(&fx.ctx, Phase::Regular).await.expect("tick");
        assert_eq!(fx.toast_titles().len(), 1);
        fx.set("2026-11-17T07:00:10.000Z");
        update_reminder(
            &fx.ctx,
            uuid(1),
            input_dto("R1 bis", "2026-11-17T09:00:00", None, &[], true),
        )
        .await
        .expect("update");
        tick(&fx.ctx, Phase::Regular).await.expect("tick");
        assert_eq!(fx.toast_titles().len(), 1, "no second toast");
    });
}

#[test]
fn deleting_a_running_session_then_a_pass_shows_nothing() {
    let fx = Fx::new();
    run(async {
        fx.start(1, SessionKind::Countdown, Some(60_000)).await;
        assert!(delete_session(&fx.ctx, uuid(1)).await.expect("delete"));
        fx.advance(120);
        let report = tick(&fx.ctx, Phase::Regular).await.expect("tick");
        assert_eq!(report.toasts, 0);
        assert!(fx.toast_titles().is_empty());
    });
}

#[test]
fn unseen_are_newest_first_and_mark_seen_stamps_the_clock() {
    let fx = Fx::new();
    run(async {
        fx.make(1, "R1", "2026-11-17T09:00:00", None).await;
        fx.make(2, "R2", "2026-11-17T10:00:00", None).await;
        fx.set("2026-11-17T08:10:00.000Z");
        tick(&fx.ctx, Phase::Regular).await.expect("first pass");
        fx.set("2026-11-17T09:10:00.000Z");
        tick(&fx.ctx, Phase::Regular).await.expect("second pass");
        let unseen = unseen_deliveries(&fx.ctx, 10).await.expect("unseen");
        let ids: Vec<&str> = unseen.iter().map(|d| d.reminder_id.as_str()).collect();
        assert_eq!(ids, [uuid(2), uuid(1)]);

        fx.set("2026-11-17T09:20:00.000Z");
        let one = MarkSeenDto::One {
            reminder_id: uuid(1),
            occurrence_key: "2026-11-17T09:00:00".to_owned(),
        };
        assert_eq!(mark_deliveries_seen(&fx.ctx, one).await.expect("seen"), 1);
        let mut conn = store::connect(&fx.ctx.db).await.expect("connect");
        let delivery = store::get_delivery(&mut conn, &uuid(1), "2026-11-17T09:00:00")
            .await
            .expect("get")
            .expect("row");
        store::close(conn).await;
        assert_eq!(
            delivery.seen_at.as_deref(),
            Some("2026-11-17T09:20:00.000Z")
        );
        assert_eq!(delivery.updated_at, "2026-11-17T09:20:00.000Z");
    });
}

#[test]
fn history_keyset_breaks_ties_on_the_id() {
    let fx = Fx::new();
    run(async {
        for n in 1..=3 {
            fx.start(n, SessionKind::Stopwatch, None).await;
        }
        for n in 1..=3 {
            stop_session(&fx.ctx, uuid(n)).await.expect("stop");
        }
        let first = history_sessions(&fx.ctx, None, 2).await.expect("page 1");
        assert_eq!(
            first.iter().map(|s| s.id.clone()).collect::<Vec<_>>(),
            [uuid(3), uuid(2)]
        );
        let cursor = HistoryCursorDto {
            started_at: first[1].started_at.clone(),
            id: first[1].id.clone(),
        };
        let rest = history_sessions(&fx.ctx, Some(cursor), 2)
            .await
            .expect("page 2");
        assert_eq!(
            rest.iter().map(|s| s.id.clone()).collect::<Vec<_>>(),
            [uuid(1)]
        );
    });
}

#[test]
fn listing_fifty_old_finished_series_stays_fast() {
    let fx = Fx::new();
    run(async {
        let rows: Vec<ReminderRow> = (0..50)
            .map(|i| {
                let mut row =
                    raw_reminder_row(2_000 + i, "Old", Some("FREQ=DAILY;UNTIL=20251231T000000Z"));
                row.start_local = "1900-01-01T00:00:00".to_owned();
                row
            })
            .collect();
        fx.insert_raw(&rows).await;
        let started = Instant::now();
        let list = list_reminders(&fx.ctx).await.expect("list");
        assert_eq!(list.len(), 50);
        assert!(list.iter().all(|r| r.status == ReminderStatus::Finished));
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "took {:?}",
            started.elapsed()
        );
    });
}

// ---------------------------------------------------------------------------------------------
// L16: a reminder owned by a habit is invisible to the generic reminder commands
// ---------------------------------------------------------------------------------------------

#[test]
fn a_habit_reminder_is_not_found_by_the_generic_reminder_commands() {
    use crate::schedule::habit_commands::{create_habit, HabitCreateDto, HabitScheduleDto};
    let fx = Fx::new();
    run(async {
        let habit = create_habit(
            &fx.ctx,
            HabitCreateDto {
                id: uuid(1),
                title: "Méditer".to_owned(),
                schedule: HabitScheduleDto::Weekly { target: 3 },
                start_on: "2026-11-09".to_owned(),
                reminder: Some(crate::schedule::habit_commands::HabitReminderInputDto {
                    id: uuid(900),
                    time: "20:00".to_owned(),
                    days: ["MO", "WE"].map(str::to_owned).to_vec(),
                    time_zone: PARIS.to_owned(),
                    enabled: true,
                }),
            },
        )
        .await
        .expect("create");
        let reminder_id = habit.reminder.expect("reminder").reminder_id;

        assert!(list_reminders(&fx.ctx).await.expect("list").is_empty());
        assert_eq!(
            err(update_reminder(
                &fx.ctx,
                reminder_id.clone(),
                input_dto("Pirate", "2026-11-20T09:00:00", None, &[], true),
            )
            .await),
            ScheduleError::NotFound
        );
        assert!(!delete_reminder(&fx.ctx, reminder_id).await.expect("delete"));
        assert!(unseen_deliveries(&fx.ctx, 10)
            .await
            .expect("unseen")
            .is_empty());
    });
}
