//! Note commands: port of `sqlite-note.repository.spec.ts` and of the note cases of
//! `sqlite-search.spec.ts`, plus the cases of 4.11 (DTO, T7, timestamps, validation before the
//! disk). The excerpt of a hit is computed by the front (T9): Rust returns the body.

use super::support::{uid, Fixture, T0};
use crate::backup::test_support::run;
use crate::data::error::DataError;
use crate::data::notes::{
    create_note, delete_note, get_note, search_notes, update_note, NoteDto, NoteHitDto, NoteNewDto,
};
use crate::data::widgets::delete_widget;

const MISSING: u32 = 0xff;

fn new(id: u32, title: &str, body: &str) -> NoteNewDto {
    NoteNewDto {
        id: uid(id),
        widget_instance_id: None,
        title: title.to_owned(),
        body: body.to_owned(),
    }
}

fn add(f: &Fixture, id: u32, title: &str, body: &str) -> NoteDto {
    run(create_note(&f.ctx, &new(id, title, body))).expect("create")
}

fn titles(hits: &[NoteHitDto]) -> Vec<&str> {
    hits.iter().map(|h| h.title.as_str()).collect()
}

fn search(f: &Fixture, query: &str, limit: u32) -> Vec<NoteHitDto> {
    run(search_notes(&f.ctx, query, limit)).expect("search")
}

/// TS: "V2 notes table: accepts an empty title, a 200-character title and a 100000-character
/// body" and "accepts the maximum sizes".
#[test]
fn accepts_empty_fields_and_the_maximum_sizes() {
    let f = Fixture::create();
    add(&f, 1, "", "");
    let max = add(&f, 2, &"x".repeat(200), &"y".repeat(100_000));
    assert_eq!(max.body.len(), 100_000);
    assert_eq!(f.scalar("SELECT COUNT(*) FROM notes"), 2);
    let updated = run(update_note(
        &f.ctx,
        &uid(1),
        &"x".repeat(200),
        &"y".repeat(100_000),
    ))
    .expect("update");
    assert_eq!(updated.body.len(), 100_000);
}

/// TS: "V2 notes table: refuses a title of 201 characters / a body of 100001 characters / a
/// malformed id". The schema stays a safety net behind the commands' own validation.
#[test]
fn the_table_check_is_the_safety_net() {
    let f = Fixture::create();
    let insert = |id: &str, title: &str, body: &str| {
        format!(
            "INSERT INTO notes (id, title, body, created_at, updated_at)
             VALUES ('{id}', '{title}', '{body}', '{T0}', '{T0}')"
        )
    };
    assert!(f.exec_fails(&insert(&uid(1), &"x".repeat(201), "")));
    assert!(f.exec_fails(&insert(&uid(1), "", &"y".repeat(100_001))));
    assert!(f.exec_fails(&insert("not-a-uuid", "", "")));
    assert!(!f.exec_fails(&insert(&uid(1), "ok", "ok")));
}

/// TS: "creates an empty note by default" (the adapter sends empty strings) and the
/// "malformed id" case of 4.9 item 1.
#[test]
fn creates_an_empty_note() {
    let f = Fixture::create();
    assert_eq!(
        add(&f, 1, "", ""),
        NoteDto {
            id: uid(1),
            widget_instance_id: None,
            title: String::new(),
            body: String::new(),
            created_at: T0.to_owned(),
            updated_at: T0.to_owned(),
        }
    );
    let bad = NoteNewDto {
        id: "not-a-uuid".to_owned(),
        ..new(2, "", "")
    };
    assert_eq!(
        run(create_note(&f.without_disk(), &bad)),
        Err(DataError::invalid("id"))
    );
    // The same id twice is a conflict (L1).
    assert_eq!(
        run(create_note(&f.ctx, &new(1, "", ""))),
        Err(DataError::Conflict)
    );
}

/// TS: "gets a note, null when absent" (a malformed id designates nothing, L14).
#[test]
fn gets_a_note_none_when_absent() {
    let f = Fixture::create();
    let created = add(&f, 1, "T", "B");
    assert_eq!(run(get_note(&f.ctx, &uid(1))), Ok(Some(created)));
    assert_eq!(run(get_note(&f.ctx, &uid(MISSING))), Ok(None));
    assert_eq!(run(get_note(&f.ctx, "../etc")), Ok(None));
}

/// TS: "updates title, body and updated_at, keeping created_at".
#[test]
fn updates_title_body_and_updated_at_keeping_created_at() {
    let f = Fixture::create();
    let created = add(&f, 1, "", "");
    f.at("2026-02-02T00:00:00.000Z");
    let updated = run(update_note(&f.ctx, &uid(1), "Titre", "Corps\nligne 2")).expect("update");
    assert_eq!(
        updated,
        NoteDto {
            title: "Titre".to_owned(),
            body: "Corps\nligne 2".to_owned(),
            updated_at: "2026-02-02T00:00:00.000Z".to_owned(),
            ..created
        }
    );
}

/// TS: "stores markup as plain text".
#[test]
fn stores_markup_as_plain_text() {
    let f = Fixture::create();
    add(&f, 1, "", "");
    let body = "<img src=x onerror=alert(1)> # titre **gras**";
    let updated = run(update_note(&f.ctx, &uid(1), "", body)).expect("update");
    assert_eq!(updated.body, body);
}

/// TS: "update throws not_found when absent".
#[test]
fn update_is_not_found_when_absent() {
    let f = Fixture::create();
    assert_eq!(
        run(update_note(&f.ctx, &uid(MISSING), "a", "b")),
        Err(DataError::NotFound)
    );
    assert_eq!(
        run(update_note(&f.ctx, "../etc", "a", "b")),
        Err(DataError::NotFound)
    );
}

/// TS: "refuses oversized fields with invalid_input". Checked before the disk, in UTF-16 units
/// (what JavaScript's `.length` counts), NUL characters included: the `CHECK` `length()` stops
/// at the first NUL, so a NUL must not hide an oversized text (4.9).
#[test]
fn refuses_oversized_fields_before_the_disk() {
    let f = Fixture::create();
    add(&f, 1, "", "");
    let offline = f.without_disk();
    assert_eq!(
        run(update_note(&offline, &uid(1), &"x".repeat(201), "")),
        Err(DataError::invalid("title"))
    );
    assert_eq!(
        run(update_note(&offline, &uid(1), "", &"y".repeat(100_001))),
        Err(DataError::invalid("body"))
    );
    assert_eq!(
        run(create_note(&offline, &new(2, &"x".repeat(201), ""))),
        Err(DataError::invalid("title"))
    );
    assert_eq!(
        run(create_note(&offline, &new(2, "", &"y".repeat(100_001)))),
        Err(DataError::invalid("body"))
    );
    // A NUL first would stop the `CHECK` at length 0.
    assert_eq!(
        run(update_note(
            &offline,
            &uid(1),
            &format!("\0{}", "x".repeat(200)),
            ""
        )),
        Err(DataError::invalid("title"))
    );
    assert_eq!(
        run(update_note(
            &offline,
            &uid(1),
            "",
            &format!("\0{}", "y".repeat(100_000))
        )),
        Err(DataError::invalid("body"))
    );
    // Two UTF-16 units per emoji: 50 000 fit in a body, 50 001 do not.
    let emoji = "\u{1F600}";
    run(update_note(&f.ctx, &uid(1), "", &emoji.repeat(50_000))).expect("100 000 units");
    assert_eq!(
        run(update_note(&offline, &uid(1), "", &emoji.repeat(50_001))),
        Err(DataError::invalid("body"))
    );
    assert_eq!(f.text("SELECT title FROM notes"), "");
}

/// TS: "remove returns true then false".
#[test]
fn delete_returns_true_then_false() {
    let f = Fixture::create();
    add(&f, 1, "", "");
    assert_eq!(run(delete_note(&f.ctx, &uid(1))), Ok(true));
    assert_eq!(run(delete_note(&f.ctx, &uid(1))), Ok(false));
    assert_eq!(run(get_note(&f.ctx, &uid(1))), Ok(None));
}

fn owned(f: &Fixture, note: u32, instance: u32) -> NoteDto {
    f.instance(instance);
    run(create_note(
        &f.ctx,
        &NoteNewDto {
            widget_instance_id: Some(uid(instance)),
            ..new(note, "", "")
        },
    ))
    .expect("owned note")
}

/// TS: "owning widget instance: stores the owning instance id".
#[test]
fn stores_the_owning_instance_id() {
    let f = Fixture::create();
    let note = owned(&f, 1, 10);
    assert_eq!(note.widget_instance_id, Some(uid(10)));
    let read = run(get_note(&f.ctx, &uid(1)))
        .expect("get")
        .expect("exists");
    assert_eq!(read.widget_instance_id, Some(uid(10)));
}

/// TS: "deletes the note with its widget instance".
#[test]
fn deletes_the_note_with_its_widget_instance() {
    let f = Fixture::create();
    owned(&f, 1, 10);
    owned(&f, 2, 11);
    assert_eq!(run(delete_widget(&f.ctx, &uid(10))), Ok(true));
    assert_eq!(run(get_note(&f.ctx, &uid(1))), Ok(None));
    assert!(run(get_note(&f.ctx, &uid(2))).expect("get").is_some());
}

/// TS: "deletes the note when the dashboard is deleted" (the cascade, simulated by the import's
/// deletion: there is no dashboard deletion command in `data`).
#[test]
fn deletes_the_note_when_the_dashboard_is_deleted() {
    let f = Fixture::create();
    owned(&f, 1, 10);
    f.exec(&format!("DELETE FROM dashboards WHERE id = '{}'", uid(900)));
    assert_eq!(run(get_note(&f.ctx, &uid(1))), Ok(None));
}

/// TS: "keeps standalone notes when an instance is deleted".
#[test]
fn keeps_standalone_notes_when_an_instance_is_deleted() {
    let f = Fixture::create();
    add(&f, 1, "", "");
    owned(&f, 2, 10);
    assert_eq!(run(delete_widget(&f.ctx, &uid(10))), Ok(true));
    assert!(run(get_note(&f.ctx, &uid(1))).expect("get").is_some());
}

/// TS: "refuses an unknown instance and a second note for the same instance".
#[test]
fn refuses_an_unknown_instance_and_a_second_note_for_the_same_instance() {
    let f = Fixture::create();
    let unknown = NoteNewDto {
        widget_instance_id: Some("nope".to_owned()),
        ..new(1, "", "")
    };
    assert_eq!(
        run(create_note(&f.ctx, &unknown)),
        Err(DataError::Constraint)
    );
    owned(&f, 2, 10);
    let second = NoteNewDto {
        widget_instance_id: Some(uid(10)),
        ..new(3, "", "")
    };
    assert_eq!(run(create_note(&f.ctx, &second)), Err(DataError::Conflict));
    assert_eq!(f.scalar("SELECT COUNT(*) FROM notes"), 1);
}

/// TS (search): "matches title or body, title matches first" (the excerpt is the front's, T9:
/// the hit carries the body).
#[test]
fn search_matches_title_or_body_title_first() {
    let f = Fixture::create();
    add(&f, 1, "Courses", "acheter du lait et du pain");
    f.at("2026-02-01T00:00:00.000Z");
    add(&f, 2, "Lait de coco", "recette");
    let hits = search(&f, "LAIT", 10);
    assert_eq!(titles(&hits), ["Lait de coco", "Courses"]);
    assert_eq!(hits[1].body, "acheter du lait et du pain");
    assert_eq!(hits[1].id, uid(1));
    assert_eq!(hits[1].widget_instance_id, None);
}

/// TS (search): "finds %, _ and \ literally in titles and bodies".
#[test]
fn search_finds_wildcards_literally() {
    let f = Fixture::create();
    add(&f, 1, "a", "taux 5% fixe");
    add(&f, 2, "b", "my_var");
    add(&f, 3, "c", "C:\\temp");
    add(&f, 4, "d", "rien");
    assert_eq!(titles(&search(&f, "5%", 10)), ["a"]);
    assert_eq!(titles(&search(&f, "y_v", 10)), ["b"]);
    assert_eq!(titles(&search(&f, "\\t", 10)), ["c"]);
    assert_eq!(search(&f, "%", 10).len(), 1);
    assert_eq!(search(&f, "_", 10).len(), 1);
}

/// TS (search): "honours the limit, orders by recency and validates input" (+ quotes in the
/// query are data).
#[test]
fn search_honours_the_limit_orders_by_recency_and_validates_input() {
    let f = Fixture::create();
    for (n, day) in [(1, "01"), (2, "02"), (3, "03")] {
        f.at(&format!("2026-03-{day}T00:00:00.000Z"));
        add(&f, n, &format!("n{day}"), "common");
    }
    assert_eq!(titles(&search(&f, "common", 2)), ["n03", "n02"]);
    let offline = f.without_disk();
    assert_eq!(
        run(search_notes(&offline, "", 5)),
        Err(DataError::invalid("query"))
    );
    assert_eq!(
        run(search_notes(&offline, "x", 21)),
        Err(DataError::invalid("limit"))
    );
    assert_eq!(
        run(search_notes(&offline, "x", 0)),
        Err(DataError::invalid("limit"))
    );
    assert!(search(&f, "'; DROP TABLE notes; --", 5).is_empty());
    assert_eq!(f.scalar("SELECT COUNT(*) FROM notes"), 3);
}

/// TS (search): "returns the owning widget instance id".
#[test]
fn search_returns_the_owning_instance_id() {
    let f = Fixture::create();
    f.instance(10);
    run(create_note(
        &f.ctx,
        &NoteNewDto {
            widget_instance_id: Some(uid(10)),
            ..new(1, "Perso", "")
        },
    ))
    .expect("create");
    assert_eq!(search(&f, "perso", 5)[0].widget_instance_id, Some(uid(10)));
}

/// T7: every write is `unavailable`, nothing changes; reads work.
#[test]
fn writes_are_unavailable_when_a_restoration_is_staged() {
    let f = Fixture::create();
    add(&f, 1, "a", "b");
    let ro = f.read_only();
    assert_eq!(
        run(create_note(&ro, &new(2, "", ""))),
        Err(DataError::Unavailable)
    );
    assert_eq!(
        run(update_note(&ro, &uid(1), "x", "y")),
        Err(DataError::Unavailable)
    );
    assert_eq!(run(delete_note(&ro, &uid(1))), Err(DataError::Unavailable));
    assert_eq!(f.scalar("SELECT COUNT(*) FROM notes"), 1);
    assert_eq!(f.text("SELECT title FROM notes"), "a");
    assert!(run(get_note(&ro, &uid(1))).expect("get").is_some());
    assert_eq!(run(search_notes(&ro, "a", 5)).expect("search").len(), 1);
}

/// Timestamps come from the injected clock.
#[test]
fn timestamps_come_from_the_injected_clock() {
    let f = Fixture::create();
    f.at("2031-07-08T09:10:11.012Z");
    let note = add(&f, 1, "", "");
    assert_eq!(note.created_at, "2031-07-08T09:10:11.012Z");
    assert_eq!(note.updated_at, "2031-07-08T09:10:11.012Z");
}

/// DTO: camelCase exact, unknown field refused, a missing field refused.
#[test]
fn note_dtos_are_camel_case_and_the_input_refuses_unknown_fields() {
    let f = Fixture::create();
    let note = add(&f, 1, "T", "B");
    assert_eq!(
        serde_json::to_value(&note).expect("json"),
        serde_json::json!({
            "id": uid(1), "widgetInstanceId": null, "title": "T", "body": "B",
            "createdAt": T0, "updatedAt": T0
        })
    );
    let hit = search(&f, "T", 5).remove(0);
    assert_eq!(
        serde_json::to_value(&hit).expect("json"),
        serde_json::json!({ "id": uid(1), "title": "T", "body": "B", "widgetInstanceId": null })
    );
    let ok = serde_json::json!({
        "id": uid(2), "widgetInstanceId": null, "title": "", "body": ""
    });
    assert!(serde_json::from_value::<NoteNewDto>(ok.clone()).is_ok());
    let mut extra = ok.clone();
    extra["extra"] = serde_json::json!(true);
    assert!(serde_json::from_value::<NoteNewDto>(extra).is_err());
    let mut snake = ok;
    snake["widget_instance_id"] = serde_json::json!(null);
    assert!(serde_json::from_value::<NoteNewDto>(snake).is_err());
}
