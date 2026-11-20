//! Pure habit logic (spec habits 4.2, cases L1, L3, L6 to L8, `habit_plan_tests`). No database.

use crate::schedule::error::ScheduleError;
use crate::schedule::habit::{
    check_window, days_of, habit_exdates, latest_allowed_day, mask_of, parse_time_of_day,
    reminder_mask, reminder_rule, ALL_DAYS,
};
use crate::schedule::reminder::{spec_of, ReminderRow};
use crate::time::formats::parse_instant;
use crate::time::formats::parse_time_zone;
use crate::time::recurrence::{format_rule, next_after, parse_rule, AnchorKind, OccurrenceStart};
use jiff::civil::{date, time, Date};
use jiff::Timestamp;

fn at(s: &str) -> Timestamp {
    parse_instant(s).expect("instant")
}

fn tokens(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| (*s).to_owned()).collect()
}

fn invalid(field: &str) -> ScheduleError {
    ScheduleError::invalid(field)
}

#[test]
fn mask_of_maps_days_to_bits_from_monday() {
    assert_eq!(mask_of(&tokens(&["MO"]), "days"), Ok(0b000_0001));
    assert_eq!(mask_of(&tokens(&["SU"]), "days"), Ok(0b100_0000));
    assert_eq!(
        mask_of(&tokens(&["FR", "MO", "WE"]), "days"),
        Ok(0b001_0101)
    );
    assert_eq!(
        mask_of(&tokens(&["MO", "TU", "WE", "TH", "FR", "SA", "SU"]), "days"),
        Ok(ALL_DAYS)
    );
}

#[test]
fn mask_of_refuses_bad_lists_and_names_the_field() {
    let bad: Vec<Vec<String>> = vec![
        vec![],
        tokens(&["MO", "MO"]),
        tokens(&["mo"]),
        tokens(&["Mo"]),
        tokens(&["MON"]),
        tokens(&[""]),
        tokens(&["XX"]),
        tokens(&["MO", "TU", "WE", "TH", "FR", "SA", "SU", "MO"]),
        tokens(&["MO", "TU", "WE", "TH", "FR", "SA", "SU", "XX"]),
    ];
    for list in bad {
        assert_eq!(
            mask_of(&list, "reminder.days"),
            Err(invalid("reminder.days"))
        );
    }
}

#[test]
fn days_of_lists_monday_first() {
    assert_eq!(days_of(0b001_0101), ["MO", "WE", "FR"]);
    assert_eq!(days_of(ALL_DAYS).len(), 7);
    assert!(days_of(0).is_empty());
}

#[test]
fn reminder_rule_and_mask_round_trip() {
    for (mask, rule) in [
        (ALL_DAYS, "FREQ=DAILY"),
        (0b000_0001, "FREQ=WEEKLY;BYDAY=MO"),
        (0b001_0101, "FREQ=WEEKLY;BYDAY=MO,WE,FR"),
        (0b110_0000, "FREQ=WEEKLY;BYDAY=SA,SU"),
    ] {
        assert_eq!(reminder_rule(mask), rule);
        let parsed = parse_rule(rule, AnchorKind::DateTime).expect("parse");
        assert_eq!(reminder_mask(&parsed), Some(mask), "{rule}");
    }
}

#[test]
fn reminder_mask_refuses_rules_outside_the_two_forms() {
    for rule in [
        "FREQ=DAILY;INTERVAL=2",
        "FREQ=DAILY;COUNT=3",
        "FREQ=WEEKLY",
        "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO",
        "FREQ=WEEKLY;BYDAY=MO;UNTIL=20270101T000000Z",
        "FREQ=MONTHLY;BYMONTHDAY=1",
        "FREQ=MONTHLY;BYDAY=1MO",
        "FREQ=YEARLY",
    ] {
        let parsed = parse_rule(rule, AnchorKind::DateTime).expect("parse");
        assert_eq!(reminder_mask(&parsed), None, "{rule}");
    }
}

#[test]
fn parse_time_of_day_is_strict() {
    assert_eq!(parse_time_of_day("00:00"), Ok(time(0, 0, 0, 0)));
    assert_eq!(parse_time_of_day("07:05"), Ok(time(7, 5, 0, 0)));
    assert_eq!(parse_time_of_day("23:59"), Ok(time(23, 59, 0, 0)));
    for bad in [
        "24:00",
        "7:00",
        "07:00:00",
        "07:60",
        "0700",
        "07-00",
        "07:0",
        "",
        " 07:00",
        "07:00 ",
        "+7:00",
        "٠٧:٠٠",
    ] {
        assert_eq!(
            parse_time_of_day(bad),
            Err(invalid("reminder.time")),
            "{bad:?}"
        );
    }
}

fn paris() -> jiff::tz::TimeZone {
    parse_time_zone("Europe/Paris").expect("zone")
}

fn days(list: &[Date]) -> Vec<Date> {
    list.to_vec()
}

#[test]
fn l1_a_day_checked_in_the_morning_mutes_this_evening() {
    // Tuesday 2026-11-17, 08:00 Paris (CET): the 20:00 occurrence is still ahead.
    let keys = habit_exdates(
        &days(&[date(2026, 11, 17)]),
        time(20, 0, 0, 0),
        &paris(),
        at("2026-11-17T07:00:00.000Z"),
    );
    assert_eq!(keys, Ok(vec!["2026-11-17T20:00:00".to_owned()]));
}

#[test]
fn l3_a_day_checked_after_the_toast_adds_nothing() {
    // 20:03 Paris: the 20:00 occurrence (19:00Z) is behind us.
    let keys = habit_exdates(
        &days(&[date(2026, 11, 17)]),
        time(20, 0, 0, 0),
        &paris(),
        at("2026-11-17T19:03:00.000Z"),
    );
    assert_eq!(keys, Ok(vec![]));
}

#[test]
fn l6_a_moved_reminder_time_recomputes_the_key() {
    // 20:30 Paris, day checked: at 20:00 the key is spent, at 21:00 it still mutes.
    let now = at("2026-11-17T19:30:00.000Z");
    let checked = days(&[date(2026, 11, 17)]);
    assert_eq!(
        habit_exdates(&checked, time(20, 0, 0, 0), &paris(), now),
        Ok(vec![])
    );
    assert_eq!(
        habit_exdates(&checked, time(21, 0, 0, 0), &paris(), now),
        Ok(vec!["2026-11-17T21:00:00".to_owned()])
    );
}

#[test]
fn keys_are_sorted_and_unique_over_several_days() {
    let keys = habit_exdates(
        &days(&[date(2026, 11, 18), date(2026, 11, 16), date(2026, 11, 18)]),
        time(9, 5, 0, 0),
        &paris(),
        at("2026-11-17T07:00:00.000Z"),
    );
    // The 16th is behind us; the 18th appears once.
    assert_eq!(keys, Ok(vec!["2026-11-18T09:05:00".to_owned()]));
    let keys = habit_exdates(
        &days(&[date(2026, 11, 19), date(2026, 11, 18)]),
        time(9, 5, 0, 0),
        &paris(),
        at("2026-11-17T07:00:00.000Z"),
    );
    assert_eq!(
        keys,
        Ok(vec![
            "2026-11-18T09:05:00".to_owned(),
            "2026-11-19T09:05:00".to_owned()
        ])
    );
}

#[test]
fn l7_a_reminder_in_a_spring_gap_is_resolved_forward() {
    // 2027-03-28: 02:00 to 03:00 does not exist in Paris; 02:30 resolves to 03:30 CEST = 01:30Z.
    let checked = days(&[date(2027, 3, 28)]);
    // Checked at 01:00 Paris (00:00Z): the shifted instant is still ahead, so the key mutes.
    assert_eq!(
        habit_exdates(
            &checked,
            time(2, 30, 0, 0),
            &paris(),
            at("2027-03-28T00:00:00.000Z")
        ),
        Ok(vec!["2027-03-28T02:30:00".to_owned()])
    );
    // Once 01:30Z has passed, nothing is left to mute.
    assert_eq!(
        habit_exdates(
            &checked,
            time(2, 30, 0, 0),
            &paris(),
            at("2027-03-28T01:30:00.000Z")
        ),
        Ok(vec![])
    );
}

#[test]
fn l8_a_reminder_in_an_autumn_fold_is_resolved_to_its_first_pass() {
    // 2026-10-25: 02:30 happens at 00:30Z (CEST) then 01:30Z (CET); the first one counts.
    let checked = days(&[date(2026, 10, 25)]);
    assert_eq!(
        habit_exdates(
            &checked,
            time(2, 30, 0, 0),
            &paris(),
            at("2026-10-25T00:45:00.000Z")
        ),
        Ok(vec![])
    );
    assert_eq!(
        habit_exdates(
            &checked,
            time(2, 30, 0, 0),
            &paris(),
            at("2026-10-25T00:15:00.000Z")
        ),
        Ok(vec!["2026-10-25T02:30:00".to_owned()])
    );
}

#[test]
fn check_window_follows_the_local_date_of_the_zone() {
    // 23:30 Paris on 2026-11-17 (22:30Z) and 00:30 Paris on 2026-11-18 (23:30Z, still the 17th
    // in UTC).
    assert_eq!(
        check_window(at("2026-11-17T22:30:00.000Z"), &paris()),
        (date(2026, 11, 16), date(2026, 11, 18))
    );
    assert_eq!(
        check_window(at("2026-11-17T23:30:00.000Z"), &paris()),
        (date(2026, 11, 17), date(2026, 11, 19))
    );
    // Month and year boundaries go through jiff.
    assert_eq!(
        check_window(at("2026-12-31T12:00:00.000Z"), &paris()),
        (date(2026, 12, 30), date(2027, 1, 1))
    );
}

#[test]
fn latest_allowed_day_is_the_utc_date_plus_one() {
    assert_eq!(
        latest_allowed_day(at("2026-11-17T00:00:00.000Z")),
        date(2026, 11, 18)
    );
    assert_eq!(
        latest_allowed_day(at("2026-11-17T23:59:59.999Z")),
        date(2026, 11, 18)
    );
    assert_eq!(
        latest_allowed_day(at("2026-12-31T12:00:00.000Z")),
        date(2027, 1, 1)
    );
    assert_eq!(
        latest_allowed_day(at("2028-02-28T12:00:00.000Z")),
        date(2028, 2, 29)
    );
}

#[test]
fn every_mask_round_trips_through_its_rule() {
    for mask in 1..=127u8 {
        let rule = reminder_rule(mask);
        let parsed = parse_rule(&rule, AnchorKind::DateTime).expect("parse");
        assert_eq!(reminder_mask(&parsed), Some(mask), "{rule}");
        assert_eq!(format_rule(&parsed), rule);
    }
}

/// A daily 02:30 Paris reminder starting 2026-10-20, with the given exceptions.
fn daily_0230(exdates: &[String]) -> ReminderRow {
    ReminderRow {
        id: "00000000-0000-4000-8000-000000000001".to_owned(),
        title: "Habitude".to_owned(),
        start_local: "2026-10-20T02:30:00".to_owned(),
        time_zone: "Europe/Paris".to_owned(),
        rrule: Some(reminder_rule(127)),
        exdates: serde_json::to_string(exdates).expect("json"),
        enabled: true,
        next_fire_at: None,
        next_fire_key: None,
        habit_id: Some("00000000-0000-4000-8000-000000000002".to_owned()),
        created_at: "2026-10-01T00:00:00.000Z".to_owned(),
        updated_at: "2026-10-01T00:00:00.000Z".to_owned(),
    }
}

fn next_key(row: &ReminderRow, now: Timestamp) -> (String, Timestamp) {
    let spec = spec_of(row).expect("spec");
    let occurrence = next_after(&spec, now).expect("next").expect("some");
    match occurrence.start {
        OccurrenceStart::Instant { at, .. } => (occurrence.key, at),
        OccurrenceStart::Date(_) => panic!("dated occurrence"),
    }
}

#[test]
fn l7_next_after_skips_the_muted_gap_day() {
    let now = at("2027-03-28T00:00:00.000Z");
    let keys =
        habit_exdates(&[date(2027, 3, 28)], time(2, 30, 0, 0), &paris(), now).expect("exdates");
    assert_eq!(keys, ["2027-03-28T02:30:00"]);
    // Without the exception the shifted 03:30 CEST (01:30Z) comes first.
    let (key, when) = next_key(&daily_0230(&[]), now);
    assert_eq!(
        (key.as_str(), when),
        ("2027-03-28T02:30:00", at("2027-03-28T01:30:00.000Z"))
    );
    // With it the next occurrence is the following day, 02:30 CEST = 00:30Z.
    let (key, when) = next_key(&daily_0230(&keys), now);
    assert_eq!(
        (key.as_str(), when),
        ("2027-03-29T02:30:00", at("2027-03-29T00:30:00.000Z"))
    );
}

#[test]
fn l8_next_after_skips_the_muted_fold_day() {
    let now = at("2026-10-25T00:15:00.000Z");
    let keys =
        habit_exdates(&[date(2026, 10, 25)], time(2, 30, 0, 0), &paris(), now).expect("exdates");
    assert_eq!(keys, ["2026-10-25T02:30:00"]);
    // Without the exception the first pass (00:30Z) fires.
    let (key, when) = next_key(&daily_0230(&[]), now);
    assert_eq!(
        (key.as_str(), when),
        ("2026-10-25T02:30:00", at("2026-10-25T00:30:00.000Z"))
    );
    // With it, the next day 02:30 CET = 01:30Z; the second pass of the fold does not fire.
    let (key, when) = next_key(&daily_0230(&keys), now);
    assert_eq!(
        (key.as_str(), when),
        ("2026-10-26T02:30:00", at("2026-10-26T01:30:00.000Z"))
    );
}
