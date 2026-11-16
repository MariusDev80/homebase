//! Pure planning and notification texts (spec 6.1, `plan_tests`). No database, no thread.

use crate::schedule::notice::{format_duration_fr, group, render, Notice, Toast};
use crate::schedule::reminder::{
    next_fire, outcome_for, plan_due, spec_of, status_of, Outcome, ReminderRow, ReminderStatus,
};
use crate::schedule::session::SessionKind;
use crate::schedule::{CATCHUP_WINDOW, GRACE};
use crate::time::formats::{format_instant, parse_instant};
use jiff::{civil, SignedDuration, Timestamp};

fn at(s: &str) -> Timestamp {
    parse_instant(s).expect("instant")
}

fn row(start_local: &str, time_zone: &str, rrule: Option<&str>, exdates: &str) -> ReminderRow {
    ReminderRow {
        id: "00000000-0000-4000-8000-000000000001".to_owned(),
        title: "Test".to_owned(),
        start_local: start_local.to_owned(),
        time_zone: time_zone.to_owned(),
        rrule: rrule.map(str::to_owned),
        exdates: exdates.to_owned(),
        enabled: true,
        next_fire_at: Some("2026-11-16T08:00:00.000Z".to_owned()),
        next_fire_key: Some("2026-11-16T09:00:00".to_owned()),
        created_at: "2026-11-01T00:00:00.000Z".to_owned(),
        updated_at: "2026-11-01T00:00:00.000Z".to_owned(),
    }
}

fn next_instant(spec: &crate::time::recurrence::RecurrenceSpec, now: Timestamp) -> Option<String> {
    use crate::time::recurrence::OccurrenceStart;
    next_fire(spec, now).expect("next").map(|o| match o.start {
        OccurrenceStart::Instant { at, .. } => format_instant(at),
        OccurrenceStart::Date(_) => panic!("dated occurrence"),
    })
}

// ---------------------------------------------------------------------------------------------
// outcome_for
// ---------------------------------------------------------------------------------------------

#[test]
fn outcome_bounds_are_inclusive() {
    let due = at("2026-11-16T08:00:00.000Z");
    let after = |d: SignedDuration| due.checked_add(d).expect("add");
    let ms = SignedDuration::from_millis(1);
    assert_eq!(outcome_for(due, due), Outcome::OnTime);
    assert_eq!(outcome_for(due, after(-ms)), Outcome::OnTime);
    assert_eq!(outcome_for(due, after(GRACE)), Outcome::OnTime);
    assert_eq!(outcome_for(due, after(GRACE + ms)), Outcome::Late);
    assert_eq!(outcome_for(due, after(CATCHUP_WINDOW)), Outcome::Late);
    assert_eq!(
        outcome_for(due, after(CATCHUP_WINDOW + ms)),
        Outcome::Missed
    );
}

// ---------------------------------------------------------------------------------------------
// plan_due
// ---------------------------------------------------------------------------------------------

#[test]
fn l5_pc_off_for_a_week_gives_one_late_delivery_with_six_skipped() {
    let r = row(
        "2026-11-01T09:00:00",
        "Europe/Paris",
        Some("FREQ=DAILY"),
        "[]",
    );
    let spec = spec_of(&r).expect("spec");
    let plan = plan_due(
        &spec,
        at("2026-11-10T08:00:00.000Z"),
        at("2026-11-16T12:00:00.000Z"),
    )
    .expect("plan");
    let d = plan.delivery.expect("delivery");
    assert_eq!(d.key, "2026-11-16T09:00:00");
    assert_eq!(format_instant(d.due_at), "2026-11-16T08:00:00.000Z");
    assert_eq!(d.outcome, Outcome::Late);
    assert_eq!(d.skipped, 6);
    assert_eq!(
        plan.next.map(|o| o.key).as_deref(),
        Some("2026-11-17T09:00:00")
    );
    assert_eq!(
        next_instant(&spec, at("2026-11-16T12:00:00.000Z")).as_deref(),
        Some("2026-11-17T08:00:00.000Z")
    );
}

#[test]
fn on_time_delivery_has_no_skipped_occurrence() {
    let r = row(
        "2026-11-01T09:00:00",
        "Europe/Paris",
        Some("FREQ=DAILY"),
        "[]",
    );
    let spec = spec_of(&r).expect("spec");
    let now = at("2026-11-16T08:00:00.000Z");
    let d = plan_due(&spec, now, now)
        .expect("plan")
        .delivery
        .expect("delivery");
    assert_eq!((d.outcome, d.skipped), (Outcome::OnTime, 0));
    assert_eq!(d.nominal_local, civil::datetime(2026, 11, 16, 9, 0, 0, 0));
}

#[test]
fn l6_one_off_ten_days_late_is_missed_and_finished() {
    let r = row("2026-11-06T09:00:00", "Europe/Paris", None, "[]");
    let spec = spec_of(&r).expect("spec");
    let plan = plan_due(
        &spec,
        at("2026-11-06T08:00:00.000Z"),
        at("2026-11-16T08:00:00.000Z"),
    )
    .expect("plan");
    let d = plan.delivery.expect("delivery");
    assert_eq!((d.outcome, d.skipped), (Outcome::Missed, 0));
    assert_eq!(plan.next, None);
}

#[test]
fn l8_fold_day_fires_once_at_the_first_occurrence() {
    let r = row(
        "2026-01-01T02:30:00",
        "Europe/Paris",
        Some("FREQ=DAILY"),
        "[]",
    );
    let spec = spec_of(&r).expect("spec");
    let now = at("2026-10-25T00:30:00.000Z");
    let plan = plan_due(&spec, now, now).expect("plan");
    let d = plan.delivery.expect("delivery");
    assert_eq!(d.key, "2026-10-25T02:30:00");
    assert_eq!(format_instant(d.due_at), "2026-10-25T00:30:00.000Z");
    assert_eq!(d.skipped, 0);
    assert_eq!(
        next_instant(&spec, now).as_deref(),
        Some("2026-10-26T01:30:00.000Z")
    );
}

#[test]
fn l9_gap_day_fires_shifted_forward_with_the_nominal_key() {
    let r = row(
        "2026-01-01T02:30:00",
        "Europe/Paris",
        Some("FREQ=DAILY"),
        "[]",
    );
    let spec = spec_of(&r).expect("spec");
    let now = at("2027-03-28T01:30:00.000Z");
    let d = plan_due(&spec, now, now)
        .expect("plan")
        .delivery
        .expect("delivery");
    assert_eq!(d.key, "2027-03-28T02:30:00");
    assert_eq!(format_instant(d.due_at), "2027-03-28T01:30:00.000Z");
    assert_eq!(d.nominal_local, civil::datetime(2027, 3, 28, 2, 30, 0, 0));
}

#[test]
fn l10_nine_oclock_follows_the_offset_change() {
    let r = row(
        "2026-01-01T09:00:00",
        "Europe/Paris",
        Some("FREQ=DAILY"),
        "[]",
    );
    let spec = spec_of(&r).expect("spec");
    assert_eq!(
        next_instant(&spec, at("2026-10-24T08:00:00.000Z")).as_deref(),
        Some("2026-10-25T08:00:00.000Z")
    );
    assert_eq!(
        next_instant(&spec, at("2026-10-25T08:00:00.000Z")).as_deref(),
        Some("2026-10-26T08:00:00.000Z")
    );
}

#[test]
fn l14_an_exception_on_the_next_occurrence_is_skipped() {
    let r = row(
        "2026-11-01T09:00:00",
        "Europe/Paris",
        Some("FREQ=DAILY"),
        r#"["2026-11-17T09:00:00"]"#,
    );
    let spec = spec_of(&r).expect("spec");
    let now = at("2026-11-16T08:00:00.000Z");
    let plan = plan_due(&spec, now, now).expect("plan");
    assert_eq!(plan.delivery.expect("delivery").key, "2026-11-16T09:00:00");
    assert_eq!(
        plan.next.map(|o| o.key).as_deref(),
        Some("2026-11-18T09:00:00")
    );
}

#[test]
fn l16_exhausted_count_leaves_no_next_occurrence() {
    let r = row(
        "2026-11-01T09:00:00",
        "Europe/Paris",
        Some("FREQ=DAILY;COUNT=2"),
        "[]",
    );
    let spec = spec_of(&r).expect("spec");
    let now = at("2026-11-02T08:00:00.000Z");
    let plan = plan_due(&spec, now, now).expect("plan");
    assert_eq!(plan.delivery.expect("delivery").key, "2026-11-02T09:00:00");
    assert_eq!(plan.next, None);
}

#[test]
fn counting_is_bounded_to_399_days() {
    let r = row(
        "2025-01-01T09:00:00",
        "Europe/Paris",
        Some("FREQ=DAILY"),
        "[]",
    );
    let spec = spec_of(&r).expect("spec");
    // About 684 days late: only the last 399 days are counted, nothing is truncated.
    let plan = plan_due(
        &spec,
        at("2025-01-01T08:00:00.000Z"),
        at("2026-11-16T08:00:00.000Z"),
    )
    .expect("plan");
    let d = plan.delivery.expect("delivery");
    assert_eq!(d.key, "2026-11-16T09:00:00");
    assert_eq!(d.skipped, 398);
    assert_eq!(d.outcome, Outcome::OnTime);
}

#[test]
fn a_stale_cache_with_no_occurrence_gives_no_delivery() {
    // Daily 09:00 Paris; the cache points at 08:30Z, where nothing occurs.
    let r = row(
        "2026-11-01T09:00:00",
        "Europe/Paris",
        Some("FREQ=DAILY"),
        "[]",
    );
    let spec = spec_of(&r).expect("spec");
    let plan = plan_due(
        &spec,
        at("2026-11-16T08:30:00.000Z"),
        at("2026-11-16T08:45:00.000Z"),
    )
    .expect("plan");
    assert_eq!(plan.delivery, None);
    assert_eq!(
        plan.next.map(|o| o.key).as_deref(),
        Some("2026-11-17T09:00:00")
    );
}

// ---------------------------------------------------------------------------------------------
// spec_of / status_of
// ---------------------------------------------------------------------------------------------

#[test]
fn status_follows_validity_enabled_and_cache() {
    let now = at("2026-11-16T08:00:00.000Z");
    let mut r = row("2026-11-16T09:00:00", "Europe/Paris", None, "[]");
    assert_eq!(status_of(&r, now), ReminderStatus::Scheduled);
    r.next_fire_at = None;
    r.next_fire_key = None;
    assert_eq!(status_of(&r, now), ReminderStatus::Finished);
    r.enabled = false;
    assert_eq!(status_of(&r, now), ReminderStatus::Disabled);
    for bad in [
        row(
            "2026-11-16T09:00:00",
            "Europe/Paris",
            Some("FREQ=NOPE"),
            "[]",
        ),
        row("2026-11-16T09:00:00", "Mars/Olympus", None, "[]"),
        row("not a date", "Europe/Paris", None, "[]"),
        row("2026-11-16T09:00:00", "Europe/Paris", None, "x"),
        row("2026-11-16T09:00:00", "Europe/Paris", None, r#"["bad"]"#),
    ] {
        assert_eq!(status_of(&bad, now), ReminderStatus::Invalid);
    }
}

#[test]
fn a_failing_next_occurrence_makes_an_uncached_reminder_invalid_not_finished() {
    let mut r = row(
        "2026-11-16T09:00:00",
        "Europe/Paris",
        Some("FREQ=DAILY"),
        "[]",
    );
    r.next_fire_at = None;
    r.next_fire_key = None;
    assert_eq!(
        status_of(&r, at("2026-11-16T08:00:00.000Z")),
        ReminderStatus::Scheduled
    );
    // The horizon computation overflows at the end of time: next_fire fails.
    assert_eq!(status_of(&r, Timestamp::MAX), ReminderStatus::Invalid);
    // A series that really ended stays finished.
    let mut done = row(
        "2026-11-01T09:00:00",
        "Europe/Paris",
        Some("FREQ=DAILY;COUNT=2"),
        "[]",
    );
    done.next_fire_at = None;
    done.next_fire_key = None;
    assert_eq!(
        status_of(&done, at("2026-11-16T08:00:00.000Z")),
        ReminderStatus::Finished
    );
}

#[test]
fn l18b_a_one_off_over_399_days_late_records_no_delivery() {
    let r = row("2025-01-01T09:00:00", "Europe/Paris", None, "[]");
    let spec = spec_of(&r).expect("spec");
    let plan = plan_due(
        &spec,
        at("2025-01-01T08:00:00.000Z"),
        at("2026-11-16T08:00:00.000Z"),
    )
    .expect("plan");
    assert_eq!(plan.delivery, None);
    assert_eq!(plan.next, None);
}

#[test]
fn spec_of_sorts_and_dedups_exceptions() {
    let r = row(
        "2026-11-01T09:00:00",
        "Europe/Paris",
        Some("FREQ=DAILY"),
        r#"["2026-11-20T09:00:00","2026-11-18T09:00:00","2026-11-20T09:00:00"]"#,
    );
    assert_eq!(
        spec_of(&r).expect("spec").exdates,
        ["2026-11-18T09:00:00", "2026-11-20T09:00:00"]
    );
}

// ---------------------------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------------------------

fn toast(title: &str, body: &str, sound: &'static str) -> Toast {
    Toast {
        title: title.to_owned(),
        body: body.to_owned(),
        sound,
    }
}

fn reminder_notice(outcome: Outcome, skipped: u32) -> Notice {
    Notice::Reminder {
        title: "Appeler Léa".to_owned(),
        nominal_local: civil::datetime(2026, 11, 16, 9, 5, 0, 0),
        outcome,
        skipped,
        due_at: at("2026-11-16T08:05:00.000Z"),
    }
}

fn session_notice(
    kind: SessionKind,
    label: &str,
    planned: SignedDuration,
    late_by: Option<SignedDuration>,
) -> Notice {
    Notice::SessionEnded {
        kind,
        label: label.to_owned(),
        planned,
        late_by,
        due_at: at("2026-11-16T08:05:00.000Z"),
    }
}

#[test]
fn render_reminders() {
    assert_eq!(
        render(&reminder_notice(Outcome::OnTime, 0)),
        toast("Appeler Léa", "Prévu à 09:05", "Reminder")
    );
    assert_eq!(
        render(&reminder_notice(Outcome::OnTime, 2)),
        toast(
            "Appeler Léa",
            "Prévu à 09:05 · 2 occurrences précédentes manquées",
            "Reminder"
        )
    );
    assert_eq!(
        render(&reminder_notice(Outcome::Late, 0)),
        toast(
            "Rappel manqué : Appeler Léa",
            "Prévu le 16/11 à 09:05",
            "Reminder"
        )
    );
    assert_eq!(
        render(&reminder_notice(Outcome::Late, 1)),
        toast(
            "Rappel manqué : Appeler Léa",
            "Prévu le 16/11 à 09:05 · 1 occurrence précédente manquée",
            "Reminder"
        )
    );
    assert_eq!(
        render(&reminder_notice(Outcome::Late, 6)),
        toast(
            "Rappel manqué : Appeler Léa",
            "Prévu le 16/11 à 09:05 · 6 occurrences précédentes manquées",
            "Reminder"
        )
    );
}

#[test]
fn render_truncates_a_long_title_to_200_code_points() {
    let notice = Notice::Reminder {
        title: "é".repeat(250),
        nominal_local: civil::datetime(2026, 11, 16, 9, 5, 0, 0),
        outcome: Outcome::OnTime,
        skipped: 0,
        due_at: at("2026-11-16T08:05:00.000Z"),
    };
    assert_eq!(render(&notice).title.chars().count(), 200);
}

#[test]
fn render_sessions() {
    let ten_min = SignedDuration::from_mins(10);
    assert_eq!(
        render(&session_notice(
            SessionKind::Countdown,
            "Thé",
            ten_min,
            None
        )),
        toast("Minuteur terminé", "Thé", "Alarm")
    );
    assert_eq!(
        render(&session_notice(SessionKind::Countdown, "", ten_min, None)),
        toast("Minuteur terminé", "Minuteur de 10 min", "Alarm")
    );
    assert_eq!(
        render(&session_notice(
            SessionKind::PomodoroWork,
            "",
            SignedDuration::from_mins(25),
            None
        )),
        toast("Pomodoro terminé", "C'est l'heure de la pause.", "Alarm")
    );
    assert_eq!(
        render(&session_notice(
            SessionKind::PomodoroWork,
            "Rapport",
            SignedDuration::from_mins(25),
            None
        )),
        toast(
            "Pomodoro terminé",
            "C'est l'heure de la pause. (Rapport)",
            "Alarm"
        )
    );
    for kind in [
        SessionKind::PomodoroShortBreak,
        SessionKind::PomodoroLongBreak,
    ] {
        assert_eq!(
            render(&session_notice(
                kind,
                "x",
                SignedDuration::from_mins(5),
                None
            )),
            toast(
                "Pause terminée",
                "Prêt pour le prochain pomodoro ?",
                "Alarm"
            )
        );
    }
}

#[test]
fn render_late_sessions_add_the_absence_suffixes() {
    let late = Some(SignedDuration::from_secs(2 * 3600 + 5 * 60));
    assert_eq!(
        render(&session_notice(
            SessionKind::Countdown,
            "Thé",
            SignedDuration::from_mins(10),
            late
        )),
        toast(
            "Minuteur terminé pendant l'absence",
            "Thé · il y a 2 h 5 min",
            "Alarm"
        )
    );
    assert_eq!(
        render(&session_notice(
            SessionKind::PomodoroShortBreak,
            "",
            SignedDuration::from_mins(5),
            late
        )),
        toast(
            "Pause terminée pendant l'absence",
            "Prêt pour le prochain pomodoro ? · il y a 2 h 5 min",
            "Alarm"
        )
    );
}

#[test]
fn render_summary_singular_and_plural() {
    let summary = |reminders, sessions| {
        render(&Notice::Summary {
            reminders,
            sessions,
        })
    };
    assert_eq!(
        summary(3, 0),
        toast(
            "Homebase",
            "3 autres rappels. Ouvrez Homebase pour les voir.",
            "Default"
        )
    );
    assert_eq!(
        summary(1, 0).body,
        "1 autre rappel. Ouvrez Homebase pour les voir."
    );
    assert_eq!(
        summary(0, 1).body,
        "1 minuteur terminé. Ouvrez Homebase pour les voir."
    );
    assert_eq!(
        summary(0, 2).body,
        "2 minuteurs terminés. Ouvrez Homebase pour les voir."
    );
    assert_eq!(
        summary(2, 1).body,
        "2 autres rappels et 1 minuteur terminé. Ouvrez Homebase pour les voir."
    );
}

#[test]
fn every_toast_names_a_sound() {
    for notice in [
        reminder_notice(Outcome::OnTime, 0),
        session_notice(
            SessionKind::Countdown,
            "",
            SignedDuration::from_secs(5),
            None,
        ),
        Notice::Summary {
            reminders: 1,
            sessions: 0,
        },
    ] {
        assert!(["Reminder", "Alarm", "Default"].contains(&render(&notice).sound));
    }
}

#[test]
fn duration_format_keeps_at_most_two_units_truncated() {
    let f = |secs: i64| format_duration_fr(SignedDuration::from_secs(secs));
    assert_eq!(f(-5), "0 s");
    assert_eq!(f(0), "0 s");
    assert_eq!(f(45), "45 s");
    assert_eq!(f(600), "10 min");
    assert_eq!(f(605), "10 min 5 s");
    assert_eq!(f(3_600), "1 h");
    assert_eq!(f(3_600 + 5), "1 h");
    assert_eq!(f(5_400), "1 h 30 min");
    assert_eq!(f(2 * 86_400 + 3 * 3_600), "2 j 3 h");
    assert_eq!(f(2 * 86_400 + 3 * 3_600 + 59 * 60), "2 j 3 h");
    assert_eq!(f(86_400 + 60), "1 j");
}

// ---------------------------------------------------------------------------------------------
// group
// ---------------------------------------------------------------------------------------------

fn numbered(outcome: Outcome, minute: u32) -> Notice {
    Notice::Reminder {
        title: format!("R{minute}"),
        nominal_local: civil::datetime(2026, 11, 16, 9, 0, 0, 0),
        outcome,
        skipped: 0,
        due_at: at("2026-11-16T08:00:00.000Z")
            .checked_add(SignedDuration::from_mins(i64::from(minute)))
            .expect("add"),
    }
}

fn titles(notices: &[Notice]) -> Vec<String> {
    notices
        .iter()
        .map(|n| match n {
            Notice::Reminder { title, .. } => title.clone(),
            Notice::SessionEnded { label, .. } => label.clone(),
            Notice::Summary { .. } => "summary".to_owned(),
        })
        .collect()
}

#[test]
fn group_keeps_up_to_four_notices() {
    assert!(group(Vec::new()).is_empty());
    let four: Vec<Notice> = (1..=4).map(|m| numbered(Outcome::OnTime, m)).collect();
    assert_eq!(group(four.clone()), four);
}

#[test]
fn group_orders_on_time_first_then_by_due_time() {
    let out = group(vec![
        numbered(Outcome::Late, 1),
        numbered(Outcome::OnTime, 9),
        numbered(Outcome::OnTime, 3),
        numbered(Outcome::Late, 0),
    ]);
    assert_eq!(titles(&out), ["R3", "R9", "R0", "R1"]);
}

#[test]
fn group_five_notices_become_three_plus_a_summary() {
    let five: Vec<Notice> = (1..=5).map(|m| numbered(Outcome::OnTime, m)).collect();
    let out = group(five);
    assert_eq!(out.len(), 4);
    assert_eq!(titles(&out[..3]), ["R1", "R2", "R3"]);
    assert_eq!(
        out[3],
        Notice::Summary {
            reminders: 2,
            sessions: 0
        }
    );
}

#[test]
fn l7_six_reminders_give_three_toasts_and_a_summary_of_three() {
    let six: Vec<Notice> = (1..=6).map(|m| numbered(Outcome::Late, m)).collect();
    let out = group(six);
    assert_eq!(out.len(), 4);
    assert_eq!(
        render(&out[3]).body,
        "3 autres rappels. Ouvrez Homebase pour les voir."
    );
}

#[test]
fn group_summary_counts_reminders_and_sessions_separately() {
    let mut notices: Vec<Notice> = (1..=3).map(|m| numbered(Outcome::OnTime, m)).collect();
    notices.push(session_notice(
        SessionKind::Countdown,
        "late",
        SignedDuration::from_mins(1),
        Some(SignedDuration::from_mins(10)),
    ));
    notices.push(numbered(Outcome::Late, 20));
    let out = group(notices);
    assert_eq!(
        out.last(),
        Some(&Notice::Summary {
            reminders: 1,
            sessions: 1
        })
    );
}
