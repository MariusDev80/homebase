//! Todo list and todo commands: port of `sqlite-todo.repository.spec.ts` and of the todo cases
//! of `sqlite-search.spec.ts`, plus the cases of 4.11 (DTO, `TodoChangesDto` absent / `null`,
//! T7, timestamps, validation before the disk). The excerpt of a hit is computed by the front
//! (T9): Rust returns the description.

use super::support::{uid, Fixture, T0};
use crate::backup::test_support::run;
use crate::data::error::DataError;
use crate::data::todos::{
    clear_completed, create_list, create_todo, delete_todo, get_list_for_widget, list_due,
    list_overdue, list_repeating_due, list_todos, reorder_todos, search_todos, set_completed,
    shift_repeat_due, update_todo, TodoChangesDto, TodoDto, TodoHitDto, TodoListDto,
    TodoListNewDto, TodoNewDto,
};
use crate::data::widgets::delete_widget;
use crate::data::DataCtx;

const MISSING: u32 = 0xff;
const LIST: u32 = 101;
const OTHER_LIST: u32 = 102;

fn list_new(id: u32, instance: Option<u32>, name: &str) -> TodoListNewDto {
    TodoListNewDto {
        id: uid(id),
        widget_instance_id: instance.map(uid),
        name: name.to_owned(),
    }
}

fn new_list(f: &Fixture, id: u32, name: &str) -> TodoListDto {
    run(create_list(&f.ctx, &list_new(id, None, name))).expect("list")
}

/// A list owned by a new widget instance `uid(instance)`.
fn owned_list(f: &Fixture, id: u32, instance: u32) -> TodoListDto {
    f.instance(instance);
    run(create_list(&f.ctx, &list_new(id, Some(instance), "Tâches"))).expect("owned list")
}

fn todo_new(id: u32, list: u32, title: &str, due: Option<&str>) -> TodoNewDto {
    TodoNewDto {
        id: uid(id),
        list_id: uid(list),
        title: title.to_owned(),
        due_on: due.map(str::to_owned),
    }
}

fn add(f: &Fixture, id: u32, list: u32, title: &str) -> TodoDto {
    run(create_todo(&f.ctx, &todo_new(id, list, title, None))).expect("todo")
}

fn add_due(f: &Fixture, id: u32, list: u32, title: &str, due: &str) -> TodoDto {
    run(create_todo(&f.ctx, &todo_new(id, list, title, Some(due)))).expect("todo")
}

fn change(f: &Fixture, id: u32, changes: &TodoChangesDto) -> Result<TodoDto, DataError> {
    run(update_todo(&f.ctx, &uid(id), changes))
}

fn rule(f: &Fixture, id: u32, rrule: &str) -> TodoDto {
    let changes = TodoChangesDto {
        rrule: Some(Some(rrule.to_owned())),
        ..TodoChangesDto::default()
    };
    change(f, id, &changes).expect("rule")
}

fn rename(f: &Fixture, id: u32, title: &str) -> Result<TodoDto, DataError> {
    let changes = TodoChangesDto {
        title: Some(title.to_owned()),
        ..TodoChangesDto::default()
    };
    change(f, id, &changes)
}

fn due_on(f: &Fixture, id: u32, due: Option<&str>) -> Result<TodoDto, DataError> {
    let changes = TodoChangesDto {
        due_on: Some(due.map(str::to_owned)),
        ..TodoChangesDto::default()
    };
    change(f, id, &changes)
}

fn describe(f: &Fixture, id: u32, text: &str) -> Result<TodoDto, DataError> {
    let changes = TodoChangesDto {
        description: Some(text.to_owned()),
        ..TodoChangesDto::default()
    };
    change(f, id, &changes)
}

fn check(f: &Fixture, id: u32, completed: bool) -> TodoDto {
    run(set_completed(&f.ctx, &uid(id), completed)).expect("completed")
}

fn items(f: &Fixture, list: u32) -> Vec<TodoDto> {
    run(list_todos(&f.ctx, &uid(list))).expect("items")
}

fn item_titles(f: &Fixture, list: u32) -> Vec<String> {
    items(f, list).into_iter().map(|t| t.title).collect()
}

fn titles(todos: Vec<TodoDto>) -> Vec<String> {
    todos.into_iter().map(|t| t.title).collect()
}

fn reorder(f: &Fixture, list: u32, ids: &[u32]) -> Result<(), DataError> {
    let ids: Vec<String> = ids.iter().map(|n| uid(*n)).collect();
    run(reorder_todos(&f.ctx, &uid(list), &ids))
}

/// Fixture with two lists (`LIST`, `OTHER_LIST`).
fn fixture() -> Fixture {
    let f = Fixture::create();
    new_list(&f, LIST, "Tâches");
    new_list(&f, OTHER_LIST, "Autre");
    f
}

fn insert_todo_sql(title: &str, due: &str, completed: &str) -> String {
    format!(
        "INSERT INTO todos (id, list_id, title, due_on, completed_at, sort_order, created_at, updated_at)
         VALUES ('{}', '{}', '{title}', {due}, {completed}, 0, '{T0}', '{T0}')",
        uid(1),
        uid(LIST)
    )
}

fn quoted(value: &str) -> String {
    format!("'{value}'")
}

/// TS: "V3 todos tables: accepts valid rows and NULL optional columns".
#[test]
fn the_table_accepts_valid_rows_and_null_optional_columns() {
    let f = fixture();
    assert!(!f.exec_fails(&insert_todo_sql(&"x".repeat(500), "NULL", "NULL")));
    f.exec(&format!("DELETE FROM todos WHERE id = '{}'", uid(1)));
    assert!(!f.exec_fails(&insert_todo_sql(
        "a",
        &quoted("2028-02-29"),
        &quoted("2026-10-25T00:30:00.123Z")
    )));
}

/// TS: "V3 todos tables: refuses an empty, blank or 501-character title" / "invalid due_on" /
/// "invalid completed_at" / "an empty list name and an unknown list": the schema is the safety
/// net behind the commands.
#[test]
fn the_table_check_is_the_safety_net() {
    let f = fixture();
    for title in ["", "   ", &"x".repeat(501)] {
        assert!(
            f.exec_fails(&insert_todo_sql(title, "NULL", "NULL")),
            "{title}"
        );
    }
    for due in ["2026-02-30", "2026-13-01", "2026-1-01", "2200-01-01"] {
        assert!(
            f.exec_fails(&insert_todo_sql("a", &quoted(due), "NULL")),
            "{due}"
        );
    }
    for done in [
        "2026-10-25T24:00:00.000Z",
        "2026-02-30T00:00:00.000Z",
        "2026-10-20T08:15:00Z",
    ] {
        assert!(
            f.exec_fails(&insert_todo_sql("a", "NULL", &quoted(done))),
            "{done}"
        );
    }
    assert!(f.exec_fails(&format!(
        "INSERT INTO todo_lists (id, name, created_at, updated_at)
         VALUES ('{}', '', '{T0}', '{T0}')",
        uid(MISSING)
    )));
    assert!(f.exec_fails(&format!(
        "INSERT INTO todos (id, list_id, title, sort_order, created_at, updated_at)
         VALUES ('{}', '{}', 'a', 0, '{T0}', '{T0}')",
        uid(MISSING),
        uid(MISSING)
    )));
}

/// TS: "lists: creates and finds the list of an instance, null otherwise".
#[test]
fn creates_and_finds_the_list_of_an_instance() {
    let f = Fixture::create();
    let list = owned_list(&f, LIST, 10);
    assert_eq!(
        list,
        TodoListDto {
            id: uid(LIST),
            widget_instance_id: Some(uid(10)),
            name: "Tâches".to_owned(),
            created_at: T0.to_owned(),
            updated_at: T0.to_owned(),
        }
    );
    assert_eq!(run(get_list_for_widget(&f.ctx, &uid(10))), Ok(Some(list)));
    assert_eq!(run(get_list_for_widget(&f.ctx, &uid(MISSING))), Ok(None));
    assert_eq!(run(get_list_for_widget(&f.ctx, "../etc")), Ok(None));
}

/// TS: "lists: validates the name" (+ the malformed id of 4.9 item 1).
#[test]
fn validates_the_list_name() {
    let f = Fixture::create();
    let offline = f.without_disk();
    assert_eq!(
        run(create_list(&offline, &list_new(1, None, "  "))),
        Err(DataError::invalid("name"))
    );
    assert_eq!(
        run(create_list(&offline, &list_new(1, None, &"x".repeat(81)))),
        Err(DataError::invalid("name"))
    );
    let bad_id = TodoListNewDto {
        id: "nope".to_owned(),
        ..list_new(1, None, "x")
    };
    assert_eq!(
        run(create_list(&offline, &bad_id)),
        Err(DataError::invalid("id"))
    );
    assert_eq!(new_list(&f, 2, " ab ").name, "ab");
    new_list(&f, 3, &"x".repeat(80));
}

/// TS: "lists: refuses an unknown instance and a second list for the same instance".
#[test]
fn refuses_an_unknown_instance_and_a_second_list_for_the_same_instance() {
    let f = Fixture::create();
    let unknown = list_new(1, None, "x");
    let unknown = TodoListNewDto {
        widget_instance_id: Some("nope".to_owned()),
        ..unknown
    };
    assert_eq!(
        run(create_list(&f.ctx, &unknown)),
        Err(DataError::Constraint)
    );
    owned_list(&f, 2, 10);
    assert_eq!(
        run(create_list(&f.ctx, &list_new(3, Some(10), "y"))),
        Err(DataError::Conflict)
    );
    // Same id twice (L1).
    assert_eq!(
        run(create_list(&f.ctx, &list_new(2, None, "z"))),
        Err(DataError::Conflict)
    );
}

/// TS: "todos: appends at the end with increasing sort_order, trimming the title".
#[test]
fn appends_at_the_end_with_increasing_sort_order_trimming_the_title() {
    let f = fixture();
    let a = add(&f, 1, LIST, "  A  ");
    let b = add_due(&f, 2, LIST, "B", "2026-03-04");
    assert_eq!(a.title, "A");
    assert_eq!(a.due_on, None);
    assert_eq!(a.completed_at, None);
    assert_eq!(a.sort_order, 0);
    assert_eq!(a.created_at, T0);
    assert_eq!(b.sort_order, 1);
    assert_eq!(b.due_on.as_deref(), Some("2026-03-04"));
    // Another list has its own order.
    assert_eq!(add(&f, 3, OTHER_LIST, "C").sort_order, 0);
}

/// TS: "todos: validates title and due date".
#[test]
fn validates_title_and_due_date() {
    let f = fixture();
    let offline = f.without_disk();
    let create = |ctx: &DataCtx, title: &str, due: Option<&str>| {
        run(create_todo(ctx, &todo_new(1, LIST, title, due)))
    };
    assert_eq!(
        create(&offline, " ", None),
        Err(DataError::invalid("title"))
    );
    assert_eq!(
        create(&offline, &"x".repeat(501), None),
        Err(DataError::invalid("title"))
    );
    // A NUL first hides the rest of the title from the `CHECK` `length()`.
    assert_eq!(
        create(&offline, &format!("\0{}", "x".repeat(500)), None),
        Err(DataError::invalid("title"))
    );
    for bad in [
        "03/04/2026",
        "",
        "2026-3-04",
        "2200-01-01",
        "1899-12-31",
        "2026-03-04 ",
    ] {
        assert_eq!(
            create(&offline, "a", Some(bad)),
            Err(DataError::invalid("dueOn")),
            "{bad:?}"
        );
    }
    // Well formed but impossible: the `CHECK` decides.
    assert_eq!(
        create(&f.ctx, "a", Some("2026-02-30")),
        Err(DataError::Constraint)
    );
    // A missing list is a foreign-key failure.
    assert_eq!(
        run(create_todo(&f.ctx, &todo_new(2, MISSING, "a", None))),
        Err(DataError::Constraint)
    );
    let bad_id = TodoNewDto {
        id: "nope".to_owned(),
        ..todo_new(3, LIST, "a", None)
    };
    assert_eq!(
        run(create_todo(&offline, &bad_id)),
        Err(DataError::invalid("id"))
    );
    assert_eq!(f.scalar("SELECT COUNT(*) FROM todos"), 0);
    add(&f, 4, LIST, &"x".repeat(500));
}

/// TS: "todos: updates title and due date independently, null clears the date".
#[test]
fn updates_title_and_due_date_independently_null_clears_the_date() {
    let f = fixture();
    let t = add_due(&f, 1, LIST, "A", "2026-03-04");
    f.at("2026-02-02T00:00:00.000Z");
    let renamed = rename(&f, 1, "B").expect("rename");
    assert_eq!(renamed.title, "B");
    assert_eq!(renamed.due_on.as_deref(), Some("2026-03-04"));
    assert_eq!(renamed.updated_at, "2026-02-02T00:00:00.000Z");
    assert_eq!(renamed.created_at, T0);
    assert_eq!(t.created_at, T0);
    let moved = due_on(&f, 1, Some("2026-05-06")).expect("date");
    assert_eq!(
        (moved.title.as_str(), moved.due_on.as_deref()),
        ("B", Some("2026-05-06"))
    );
    let cleared = due_on(&f, 1, None).expect("clear");
    assert_eq!((cleared.title.as_str(), cleared.due_on), ("B", None));
    assert_eq!(rename(&f, 1, ""), Err(DataError::invalid("title")));
    assert_eq!(
        due_on(&f, 1, Some("03/04/2026")),
        Err(DataError::invalid("dueOn"))
    );
    assert_eq!(rename(&f, MISSING, "x"), Err(DataError::NotFound));
    assert_eq!(rename(&f, 1, " B2 ").expect("trimmed").title, "B2");
}

/// TS: "todos: creates with the defaults of the V6 fields".
#[test]
fn creates_with_the_defaults_of_the_v6_fields() {
    let f = fixture();
    let t = add(&f, 1, LIST, "A");
    assert_eq!(t.description, "");
    assert_eq!(t.rrule, None);
    assert!(!t.important);
    assert_eq!(items(&f, LIST)[0], t);
}

/// TS: "todos: updates the description, kept by a title-only update" (+ the NUL-first oversized
/// description, hidden from a `length()`-only check).
#[test]
fn updates_the_description_kept_by_a_title_only_update() {
    let f = fixture();
    add(&f, 1, LIST, "A");
    assert_eq!(
        describe(&f, 1, "  texte\nlong  ")
            .expect("text")
            .description,
        "  texte\nlong  "
    );
    assert_eq!(
        rename(&f, 1, "B").expect("rename").description,
        "  texte\nlong  "
    );
    assert_eq!(describe(&f, 1, "").expect("empty").description, "");
    let max = "a".repeat(10_000);
    assert_eq!(describe(&f, 1, &max).expect("max").description, max);
    let offline = f.without_disk();
    let too_long = TodoChangesDto {
        description: Some(format!("{max}a")),
        ..TodoChangesDto::default()
    };
    assert_eq!(
        run(update_todo(&offline, &uid(1), &too_long)),
        Err(DataError::invalid("description"))
    );
    let nul_first = TodoChangesDto {
        description: Some(format!("\0{max}")),
        ..TodoChangesDto::default()
    };
    assert_eq!(
        run(update_todo(&offline, &uid(1), &nul_first)),
        Err(DataError::invalid("description"))
    );
}

/// TS: "todos: binds important as 1/0 and keeps it when omitted".
#[test]
fn important_is_written_when_given_and_kept_when_omitted() {
    let f = fixture();
    add(&f, 1, LIST, "A");
    let set = |important| {
        let changes = TodoChangesDto {
            important: Some(important),
            ..TodoChangesDto::default()
        };
        change(&f, 1, &changes).expect("important")
    };
    assert!(set(true).important);
    assert_eq!(f.scalar("SELECT important FROM todos"), 1);
    assert!(rename(&f, 1, "B").expect("rename").important);
    assert!(!set(false).important);
    assert_eq!(f.scalar("SELECT important FROM todos"), 0);
}

/// TS: "todos: validates the rule and its link with the due date".
#[test]
fn validates_the_rule_and_its_link_with_the_due_date() {
    let f = fixture();
    add_due(&f, 1, LIST, "A", "2026-03-04");
    add(&f, 2, LIST, "B");
    let offline = f.without_disk();
    let long = format!("FREQ={}", "A".repeat(252));
    for bad in [
        "DAILY",
        "FREQ=",
        "FREQ=DAI",
        long.as_str(),
        "freq=daily",
        "RRULE:FREQ=DAILY",
        "XFREQ=DAILY",
    ] {
        let changes = TodoChangesDto {
            rrule: Some(Some(bad.to_owned())),
            ..TodoChangesDto::default()
        };
        assert_eq!(
            run(update_todo(&offline, &uid(1), &changes)),
            Err(DataError::invalid("rrule")),
            "{bad}"
        );
    }
    // A rule with an explicit `dueOn: null` is refused before the disk.
    let both = TodoChangesDto {
        rrule: Some(Some("FREQ=DAILY".to_owned())),
        due_on: Some(None),
        ..TodoChangesDto::default()
    };
    assert_eq!(
        run(update_todo(&offline, &uid(1), &both)),
        Err(DataError::invalid("rrule"))
    );
    // Bounds of the rule length: 10 and 256 pass.
    assert_eq!(
        rule(&f, 1, "FREQ=DAILY").rrule.as_deref(),
        Some("FREQ=DAILY")
    );
    let max = format!("FREQ={}", "A".repeat(251));
    assert_eq!(rule(&f, 1, &max).rrule.as_deref(), Some(max.as_str()));
    // A rule on a todo without a due date: the `CHECK` decides.
    let undated = TodoChangesDto {
        rrule: Some(Some("FREQ=DAILY".to_owned())),
        ..TodoChangesDto::default()
    };
    assert_eq!(change(&f, 2, &undated), Err(DataError::Constraint));
    let dated = TodoChangesDto {
        rrule: Some(Some("FREQ=DAILY".to_owned())),
        due_on: Some(Some("2026-05-06".to_owned())),
        ..TodoChangesDto::default()
    };
    assert_eq!(
        change(&f, 2, &dated).expect("dated").rrule.as_deref(),
        Some("FREQ=DAILY")
    );
}

/// TS: "todos: clears the rule with the due date, keeps it when the date changes, removes it
/// with null".
#[test]
fn the_rule_follows_the_due_date() {
    let f = fixture();
    add_due(&f, 1, LIST, "A", "2026-03-04");
    let t = rule(&f, 1, "FREQ=WEEKLY");
    assert_eq!(t.rrule.as_deref(), Some("FREQ=WEEKLY"));
    assert_eq!(t.due_on.as_deref(), Some("2026-03-04"));
    let moved = due_on(&f, 1, Some("2026-04-05")).expect("move");
    assert_eq!(moved.rrule.as_deref(), Some("FREQ=WEEKLY"));
    assert_eq!(moved.due_on.as_deref(), Some("2026-04-05"));
    let no_rule = change(
        &f,
        1,
        &TodoChangesDto {
            rrule: Some(None),
            ..TodoChangesDto::default()
        },
    )
    .expect("remove the rule");
    assert_eq!(no_rule.rrule, None);
    assert_eq!(no_rule.due_on.as_deref(), Some("2026-04-05"));
    rule(&f, 1, "FREQ=WEEKLY");
    let cleared = due_on(&f, 1, None).expect("clear the date");
    assert_eq!((cleared.rrule, cleared.due_on), (None, None));
}

/// `TodoChangesDto`: an absent field is "unchanged", `null` is "clear", for `dueOn` and `rrule`;
/// unknown fields are refused.
#[test]
fn changes_distinguish_an_absent_field_from_null() {
    let parse = |json: serde_json::Value| serde_json::from_value::<TodoChangesDto>(json);
    assert_eq!(
        parse(serde_json::json!({})).expect("empty"),
        TodoChangesDto::default()
    );
    let nulls = parse(serde_json::json!({ "dueOn": null, "rrule": null })).expect("nulls");
    assert_eq!(nulls.due_on, Some(None));
    assert_eq!(nulls.rrule, Some(None));
    let values = parse(serde_json::json!({
        "title": "T", "dueOn": "2026-01-02", "description": "D", "rrule": "FREQ=DAILY",
        "important": true
    }))
    .expect("values");
    assert_eq!(values.title.as_deref(), Some("T"));
    assert_eq!(values.due_on, Some(Some("2026-01-02".to_owned())));
    assert_eq!(values.description.as_deref(), Some("D"));
    assert_eq!(values.rrule, Some(Some("FREQ=DAILY".to_owned())));
    assert_eq!(values.important, Some(true));
    let only_rrule = parse(serde_json::json!({ "rrule": null })).expect("rrule only");
    assert_eq!(only_rrule.due_on, None);
    assert_eq!(only_rrule.rrule, Some(None));
    assert!(parse(serde_json::json!({ "extra": 1 })).is_err());
    assert!(parse(serde_json::json!({ "due_on": null })).is_err());
    assert!(parse(serde_json::json!({ "important": "yes" })).is_err());
}

/// An update that changes nothing still stamps `updated_at`; a null `dueOn` over the wire clears
/// the date and the rule through the same statement as the typed call.
#[test]
fn an_update_from_the_wire_reaches_the_statement() {
    let f = fixture();
    add_due(&f, 1, LIST, "A", "2026-03-04");
    rule(&f, 1, "FREQ=WEEKLY");
    f.at("2026-06-06T00:00:00.000Z");
    let wire: TodoChangesDto =
        serde_json::from_value(serde_json::json!({ "dueOn": null })).expect("wire");
    let t = change(&f, 1, &wire).expect("update");
    assert_eq!((t.due_on, t.rrule), (None, None));
    assert_eq!(t.updated_at, "2026-06-06T00:00:00.000Z");
    let none: TodoChangesDto = serde_json::from_value(serde_json::json!({})).expect("wire");
    f.at("2026-07-07T00:00:00.000Z");
    assert_eq!(
        change(&f, 1, &none).expect("noop").updated_at,
        "2026-07-07T00:00:00.000Z"
    );
}

/// TS: "shiftRepeatDue: writes the new date only, keeping sort_order and completed_at".
#[test]
fn shift_writes_the_new_date_only() {
    let f = fixture();
    add(&f, 1, LIST, "First");
    let t = add_due(&f, 2, LIST, "A", "2026-03-04");
    rule(&f, 2, "FREQ=WEEKLY");
    f.at("2026-02-02T00:00:00.000Z");
    let next = run(shift_repeat_due(
        &f.ctx,
        &uid(2),
        "2026-03-04",
        "2026-03-11",
    ))
    .expect("shift");
    assert_eq!(next.due_on.as_deref(), Some("2026-03-11"));
    assert_eq!(next.rrule.as_deref(), Some("FREQ=WEEKLY"));
    assert_eq!(next.sort_order, t.sort_order);
    assert_eq!(next.completed_at, None);
    assert_eq!(next.updated_at, "2026-02-02T00:00:00.000Z");
}

/// TS: "shiftRepeatDue: refuses a changed date, a missing rule and a completed todo (conflict)".
#[test]
fn shift_refuses_a_changed_date_a_missing_rule_and_a_completed_todo() {
    let f = fixture();
    add_due(&f, 1, LIST, "A", "2026-03-04");
    let shift = |from: &str, to: &str| run(shift_repeat_due(&f.ctx, &uid(1), from, to));
    assert_eq!(shift("2026-03-04", "2026-03-11"), Err(DataError::Conflict));
    rule(&f, 1, "FREQ=WEEKLY");
    assert_eq!(shift("2026-03-05", "2026-03-11"), Err(DataError::Conflict));
    check(&f, 1, true);
    assert_eq!(shift("2026-03-04", "2026-03-11"), Err(DataError::Conflict));
    assert_eq!(items(&f, LIST)[0].due_on.as_deref(), Some("2026-03-04"));
}

/// TS: "shiftRepeatDue: reports constraint for a well-formed but impossible target date".
#[test]
fn shift_reports_constraint_for_an_impossible_target_date() {
    let f = fixture();
    add_due(&f, 1, LIST, "A", "2026-03-04");
    rule(&f, 1, "FREQ=WEEKLY");
    assert_eq!(
        run(shift_repeat_due(
            &f.ctx,
            &uid(1),
            "2026-03-04",
            "2026-02-30"
        )),
        Err(DataError::Constraint)
    );
    assert_eq!(items(&f, LIST)[0].due_on.as_deref(), Some("2026-03-04"));
}

/// TS: "shiftRepeatDue: reports not_found and invalid_input" (before the disk).
#[test]
fn shift_reports_not_found_and_invalid_input() {
    let f = fixture();
    assert_eq!(
        run(shift_repeat_due(
            &f.ctx,
            &uid(MISSING),
            "2026-03-04",
            "2026-03-11"
        )),
        Err(DataError::NotFound)
    );
    let offline = f.without_disk();
    assert_eq!(
        run(shift_repeat_due(
            &offline,
            &uid(MISSING),
            "03/04/2026",
            "2026-03-11"
        )),
        Err(DataError::invalid("fromDueOn"))
    );
    assert_eq!(
        run(shift_repeat_due(
            &offline,
            &uid(MISSING),
            "2026-03-04",
            "demain"
        )),
        Err(DataError::invalid("toDueOn"))
    );
}

/// TS: "setCompleted ignores the rule: completes, keeps it, and unchecking keeps it".
#[test]
fn set_completed_ignores_the_rule() {
    let f = fixture();
    add_due(&f, 1, LIST, "A", "2026-03-04");
    rule(&f, 1, "FREQ=DAILY");
    let done = check(&f, 1, true);
    assert_eq!(done.rrule.as_deref(), Some("FREQ=DAILY"));
    assert_eq!(done.due_on.as_deref(), Some("2026-03-04"));
    let undone = check(&f, 1, false);
    assert_eq!(undone.completed_at, None);
    assert_eq!(undone.rrule.as_deref(), Some("FREQ=DAILY"));
    assert_eq!(undone.due_on.as_deref(), Some("2026-03-04"));
}

/// TS: "setCompleted uses the clock and can be undone".
#[test]
fn set_completed_uses_the_clock_and_can_be_undone() {
    let f = fixture();
    add(&f, 1, LIST, "A");
    f.at("2026-03-03T10:20:30.456Z");
    assert_eq!(
        check(&f, 1, true).completed_at.as_deref(),
        Some("2026-03-03T10:20:30.456Z")
    );
    f.at("2026-04-04T00:00:00.000Z");
    assert_eq!(
        check(&f, 1, true).completed_at.as_deref(),
        Some("2026-03-03T10:20:30.456Z")
    );
    assert_eq!(check(&f, 1, false).completed_at, None);
    assert_eq!(
        run(set_completed(&f.ctx, &uid(MISSING), true)),
        Err(DataError::NotFound)
    );
}

/// TS: "unchecking a completed todo moves it to the end of the active ones".
#[test]
fn unchecking_a_completed_todo_moves_it_to_the_end_of_the_active_ones() {
    let f = fixture();
    add(&f, 1, LIST, "A");
    add(&f, 2, LIST, "B");
    add(&f, 3, LIST, "C");
    check(&f, 1, true);
    assert_eq!(check(&f, 1, false).sort_order, 3);
    assert_eq!(item_titles(&f, LIST), ["B", "C", "A"]);
    // Unchecking an active todo does not move it.
    let b = items(&f, LIST).remove(0);
    assert_eq!(check(&f, 2, false).sort_order, b.sort_order);
}

/// TS: "lists not completed by sort_order, then completed by completed_at descending".
#[test]
fn lists_active_by_sort_order_then_completed_by_completion_descending() {
    let f = fixture();
    for (n, title) in [(1, "A"), (2, "B"), (3, "C"), (4, "D")] {
        add(&f, n, LIST, title);
    }
    f.at("2026-01-02T00:00:00.000Z");
    check(&f, 1, true);
    f.at("2026-01-03T00:00:00.000Z");
    check(&f, 3, true);
    let todos = items(&f, LIST);
    assert_eq!(
        todos.iter().map(|t| t.title.as_str()).collect::<Vec<_>>(),
        ["B", "D", "C", "A"]
    );
    assert_eq!(
        todos.iter().map(|t| t.id.clone()).collect::<Vec<_>>(),
        [uid(2), uid(4), uid(3), uid(1)]
    );
    assert!(items(&f, MISSING).is_empty());
}

/// TS: "remove returns true then false".
#[test]
fn delete_returns_true_then_false() {
    let f = fixture();
    add(&f, 1, LIST, "A");
    assert_eq!(run(delete_todo(&f.ctx, &uid(1))), Ok(true));
    assert_eq!(run(delete_todo(&f.ctx, &uid(1))), Ok(false));
    assert_eq!(run(delete_todo(&f.ctx, "../etc")), Ok(false));
}

/// TS: "reorder: rewrites sort_order following the given ids, only for rows that change".
#[test]
fn reorder_rewrites_sort_order_only_for_rows_that_change() {
    let f = fixture();
    for (n, title) in [(1, "A"), (2, "B"), (3, "C")] {
        add(&f, n, LIST, title);
    }
    f.at("2026-02-02T00:00:00.000Z");
    reorder(&f, LIST, &[1, 3, 2]).expect("reorder");
    let todos = items(&f, LIST);
    assert_eq!(
        todos.iter().map(|t| t.title.as_str()).collect::<Vec<_>>(),
        ["A", "C", "B"]
    );
    let stamp = |title: &str| {
        todos
            .iter()
            .find(|t| t.title == title)
            .map(|t| t.updated_at.clone())
            .expect("todo")
    };
    assert_eq!(stamp("A"), T0);
    assert_eq!(stamp("B"), "2026-02-02T00:00:00.000Z");
    assert_eq!(stamp("C"), "2026-02-02T00:00:00.000Z");
}

/// TS: "reorder: ignores unknown ids and todos of another list".
#[test]
fn reorder_ignores_unknown_ids_and_todos_of_another_list() {
    let f = fixture();
    add(&f, 1, LIST, "A");
    add(&f, 2, OTHER_LIST, "X");
    reorder(&f, LIST, &[MISSING, 2, 1]).expect("reorder");
    assert_eq!(items(&f, OTHER_LIST)[0].sort_order, 0);
    assert_eq!(items(&f, LIST)[0].sort_order, 2);
}

/// TS: "reorder: validates the input before any query".
#[test]
fn reorder_validates_the_input_before_the_disk() {
    let f = fixture();
    let offline = f.without_disk();
    let list = uid(LIST);
    assert_eq!(run(reorder_todos(&offline, &list, &[])), Ok(()));
    assert_eq!(
        run(reorder_todos(
            &offline,
            &list,
            &["a".to_owned(), "a".to_owned()]
        )),
        Err(DataError::invalid("ids"))
    );
    let many: Vec<String> = (0..1001).map(|i| format!("id-{i}")).collect();
    assert_eq!(
        run(reorder_todos(&offline, &list, &many)),
        Err(DataError::invalid("ids"))
    );
    let ok: Vec<String> = (0..1000).map(|i| format!("id-{i}")).collect();
    assert_eq!(run(reorder_todos(&f.ctx, &list, &ok)), Ok(()));
}

/// TS: "clearCompleted: deletes only the completed todos of the list and returns the count".
#[test]
fn clear_completed_deletes_only_the_completed_todos_of_the_list() {
    let f = fixture();
    add(&f, 1, LIST, "A");
    add(&f, 2, LIST, "B");
    add(&f, 3, OTHER_LIST, "X");
    check(&f, 1, true);
    check(&f, 3, true);
    assert_eq!(run(clear_completed(&f.ctx, &uid(LIST))), Ok(1));
    assert_eq!(item_titles(&f, LIST), ["B"]);
    assert_eq!(items(&f, OTHER_LIST).len(), 1);
    assert_eq!(run(clear_completed(&f.ctx, &uid(LIST))), Ok(0));
}

/// TS: "listDue: keeps active todos due within the bounds (inclusive), across lists".
#[test]
fn due_keeps_active_todos_within_the_inclusive_bounds_across_lists() {
    let f = fixture();
    add_due(&f, 1, LIST, "before", "2026-11-09");
    add_due(&f, 2, LIST, "first", "2026-11-10");
    add(&f, 3, LIST, "none");
    add_due(&f, 4, OTHER_LIST, "last", "2026-11-20");
    add_due(&f, 5, OTHER_LIST, "after", "2026-11-21");
    add_due(&f, 6, OTHER_LIST, "done", "2026-11-15");
    check(&f, 6, true);
    let due = run(list_due(&f.ctx, "2026-11-10", "2026-11-20", 10)).expect("due");
    assert_eq!(
        due.iter().map(|t| t.title.as_str()).collect::<Vec<_>>(),
        ["first", "last"]
    );
    assert_eq!(due[0].list_id, uid(LIST));
    assert_eq!(due[0].due_on.as_deref(), Some("2026-11-10"));
    assert_eq!(due[0].completed_at, None);
}

/// TS: "listDue: orders by due_on, sort_order then id".
#[test]
fn due_orders_by_due_on_sort_order_then_id() {
    let f = fixture();
    add_due(&f, 1, LIST, "a", "2026-11-11");
    add_due(&f, 2, LIST, "b", "2026-11-11");
    add_due(&f, 3, LIST, "late", "2026-11-12");
    add_due(&f, 4, OTHER_LIST, "c", "2026-11-11");
    reorder(&f, LIST, &[2, 1, 3]).expect("reorder");
    // b and c share due_on and sort_order 0: the id decides; a has sort_order 1.
    let due = run(list_due(&f.ctx, "2026-11-10", "2026-11-20", 10)).expect("due");
    assert_eq!(titles(due), ["b", "c", "a", "late"]);
}

/// TS: "listDue: respects the limit".
#[test]
fn due_respects_the_limit() {
    let f = fixture();
    for (n, day) in [(1, "11"), (2, "12"), (3, "13")] {
        add_due(&f, n, LIST, &format!("t{day}"), &format!("2026-11-{day}"));
    }
    let due = |limit| run(list_due(&f.ctx, "2026-11-10", "2026-11-20", limit)).expect("due");
    assert_eq!(titles(due(2)), ["t11", "t12"]);
    assert_eq!(due(1000).len(), 3);
}

/// TS: "listDue: refuses invalid arguments before any query" (the non-integer limits of the TS
/// case, 1.5, NaN and -1, are refused by the deserialization of the `u32` argument, S2).
#[test]
fn due_refuses_invalid_arguments_before_the_disk() {
    let f = fixture();
    let offline = f.without_disk();
    assert_eq!(
        run(list_due(&offline, "2026-1-10", "2026-11-20", 5)),
        Err(DataError::invalid("fromOn"))
    );
    assert_eq!(
        run(list_due(&offline, "2026-11-10", "nope", 5)),
        Err(DataError::invalid("toOn"))
    );
    assert_eq!(
        run(list_due(&offline, "2026-11-21", "2026-11-20", 5)),
        Err(DataError::invalid("toOn"))
    );
    for limit in [0, 1001] {
        assert_eq!(
            run(list_due(&offline, "2026-11-10", "2026-11-20", limit)),
            Err(DataError::invalid("limit")),
            "{limit}"
        );
    }
    for bad in [
        serde_json::json!(1.5),
        serde_json::json!(-1),
        serde_json::json!("5"),
    ] {
        assert!(serde_json::from_value::<u32>(bad).is_err());
    }
    assert!(run(list_due(&f.ctx, "2026-11-20", "2026-11-20", 1)).is_ok());
}

fn repeating(f: &Fixture, id: u32, list: u32, title: &str, due: &str, rrule: Option<&str>) {
    add_due(f, id, list, title, due);
    if let Some(r) = rrule {
        rule(f, id, r);
    }
}

/// TS: "listRepeatingDueBy: keeps active repeating todos due on or before the bound".
#[test]
fn repeating_keeps_active_repeating_todos_due_on_or_before_the_bound() {
    let f = fixture();
    let weekly = Some("FREQ=WEEKLY");
    repeating(&f, 1, LIST, "plain", "2026-11-10", None);
    repeating(&f, 2, LIST, "old", "2026-10-01", weekly);
    repeating(&f, 3, OTHER_LIST, "bound", "2026-11-20", weekly);
    repeating(&f, 4, OTHER_LIST, "after", "2026-11-21", weekly);
    repeating(&f, 5, OTHER_LIST, "done", "2026-11-05", weekly);
    check(&f, 5, true);
    let found = run(list_repeating_due(&f.ctx, "2026-11-20", 10)).expect("repeating");
    assert_eq!(found[0].rrule.as_deref(), Some("FREQ=WEEKLY"));
    assert_eq!(found[0].completed_at, None);
    assert_eq!(titles(found), ["old", "bound"]);
}

/// TS: "listRepeatingDueBy: orders by due_on, sort_order then id and respects the limit".
#[test]
fn repeating_orders_by_due_on_sort_order_then_id_and_respects_the_limit() {
    let f = fixture();
    let weekly = Some("FREQ=WEEKLY");
    repeating(&f, 1, LIST, "a", "2026-11-11", weekly);
    repeating(&f, 2, LIST, "b", "2026-11-11", weekly);
    repeating(&f, 3, LIST, "c", "2026-11-09", weekly);
    reorder(&f, LIST, &[2, 1, 3]).expect("reorder");
    let all = run(list_repeating_due(&f.ctx, "2026-11-30", 10)).expect("all");
    assert_eq!(titles(all), ["c", "b", "a"]);
    let two = run(list_repeating_due(&f.ctx, "2026-11-30", 2)).expect("two");
    assert_eq!(titles(two), ["c", "b"]);
}

/// TS: "listRepeatingDueBy: refuses invalid arguments before any query".
#[test]
fn repeating_refuses_invalid_arguments_before_the_disk() {
    let f = fixture();
    let offline = f.without_disk();
    for bad in ["2026-1-10", "nope"] {
        assert_eq!(
            run(list_repeating_due(&offline, bad, 5)),
            Err(DataError::invalid("toOn"))
        );
    }
    for limit in [0, 1001] {
        assert_eq!(
            run(list_repeating_due(&offline, "2026-11-20", limit)),
            Err(DataError::invalid("limit"))
        );
    }
    assert!(run(list_repeating_due(&f.ctx, "2026-11-20", 1000)).is_ok());
}

/// TS: "listOverdueBefore: keeps active dated todos strictly before the bound, across lists".
#[test]
fn overdue_keeps_active_dated_todos_strictly_before_the_bound() {
    let f = fixture();
    add_due(&f, 1, LIST, "old", "2026-01-01");
    add_due(&f, 2, OTHER_LIST, "yesterday", "2026-11-17");
    add_due(&f, 3, LIST, "today", "2026-11-18");
    add(&f, 4, LIST, "no date");
    add_due(&f, 5, LIST, "done", "2026-11-01");
    check(&f, 5, true);
    let found = run(list_overdue(&f.ctx, "2026-11-18", 10)).expect("overdue");
    assert_eq!(titles(found), ["old", "yesterday"]);
}

/// TS: "listOverdueBefore: orders by due_on, sort_order then id and respects the limit".
#[test]
fn overdue_orders_by_due_on_sort_order_then_id_and_respects_the_limit() {
    let f = fixture();
    add_due(&f, 1, LIST, "a", "2026-11-11");
    add_due(&f, 2, LIST, "b", "2026-11-11");
    add_due(&f, 3, LIST, "c", "2026-11-09");
    reorder(&f, LIST, &[2, 1]).expect("reorder");
    let all = run(list_overdue(&f.ctx, "2026-11-30", 10)).expect("all");
    assert_eq!(titles(all), ["c", "b", "a"]);
    let two = run(list_overdue(&f.ctx, "2026-11-30", 2)).expect("two");
    assert_eq!(titles(two), ["c", "b"]);
}

/// TS: "listOverdueBefore: refuses invalid arguments before any query".
#[test]
fn overdue_refuses_invalid_arguments_before_the_disk() {
    let f = fixture();
    let offline = f.without_disk();
    for bad in ["2026-1-10", "nope"] {
        assert_eq!(
            run(list_overdue(&offline, bad, 5)),
            Err(DataError::invalid("beforeOn"))
        );
    }
    for limit in [0, 1001] {
        assert_eq!(
            run(list_overdue(&offline, "2026-11-20", limit)),
            Err(DataError::invalid("limit"))
        );
    }
    assert!(run(list_overdue(&f.ctx, "2026-11-20", 1000)).is_ok());
}

/// TS: "cascades: instance deletion removes its list and todos, keeping others".
#[test]
fn instance_deletion_removes_its_list_and_todos_keeping_others() {
    let f = Fixture::create();
    owned_list(&f, LIST, 10);
    owned_list(&f, OTHER_LIST, 11);
    add(&f, 1, LIST, "A");
    add(&f, 2, OTHER_LIST, "B");
    assert_eq!(run(delete_widget(&f.ctx, &uid(10))), Ok(true));
    assert_eq!(run(get_list_for_widget(&f.ctx, &uid(10))), Ok(None));
    assert!(items(&f, LIST).is_empty());
    assert_eq!(items(&f, OTHER_LIST).len(), 1);
}

/// TS: "cascades: dashboard deletion removes everything" (the import's deletion: there is no
/// dashboard deletion command in `data`).
#[test]
fn dashboard_deletion_removes_everything() {
    let f = Fixture::create();
    owned_list(&f, LIST, 10);
    add(&f, 1, LIST, "A");
    f.exec(&format!("DELETE FROM dashboards WHERE id = '{}'", uid(900)));
    assert_eq!(run(get_list_for_widget(&f.ctx, &uid(10))), Ok(None));
    assert_eq!(f.scalar("SELECT COUNT(*) FROM todos"), 0);
    assert_eq!(f.scalar("SELECT COUNT(*) FROM todo_lists"), 0);
}

fn hits(f: &Fixture, query: &str, limit: u32) -> Vec<TodoHitDto> {
    run(search_todos(&f.ctx, query, limit)).expect("search")
}

fn hit_titles(f: &Fixture, query: &str, limit: u32) -> Vec<String> {
    hits(f, query, limit).into_iter().map(|h| h.title).collect()
}

/// TS (search): "matches active and completed todos, active first, with list instance".
#[test]
fn search_matches_active_and_completed_todos_active_first() {
    let f = Fixture::create();
    owned_list(&f, LIST, 10);
    add(&f, 1, LIST, "payer facture");
    check(&f, 1, true);
    f.at("2026-02-01T00:00:00.000Z");
    add(&f, 2, LIST, "Facture EDF");
    add(&f, 3, LIST, "sans rapport");
    let found = hits(&f, "facture", 10);
    assert_eq!(
        found.iter().map(|h| h.title.as_str()).collect::<Vec<_>>(),
        ["Facture EDF", "payer facture"]
    );
    assert_eq!(found[0].list_id, uid(LIST));
    assert_eq!(found[0].widget_instance_id, Some(uid(10)));
    assert_eq!(found[0].completed_at, None);
    assert_eq!(found[1].completed_at.as_deref(), Some(T0));
}

/// TS (search): "finds a word present only in the description, with an excerpt" (the hit carries
/// the whole description; the excerpt is the front's, T9).
#[test]
fn search_finds_a_word_present_only_in_the_description() {
    let f = fixture();
    add(&f, 1, LIST, "Ranger");
    describe(&f, 1, "penser au zinzolin\nsous le lit").expect("description");
    add(&f, 2, LIST, "autre");
    let found = hits(&f, "ZINZOLIN", 10);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].title, "Ranger");
    assert_eq!(found[0].description, "penser au zinzolin\nsous le lit");
    assert_eq!(
        hits(&f, "Ranger", 10)[0].description,
        "penser au zinzolin\nsous le lit"
    );
    assert_eq!(found[0].widget_instance_id, None);
}

/// TS (search): "orders active first, then title matches, then most recent".
#[test]
fn search_orders_active_first_then_title_matches_then_most_recent() {
    let f = fixture();
    add(&f, 1, LIST, "mot fini");
    check(&f, 1, true);
    f.at("2026-03-01T00:00:00.000Z");
    add(&f, 2, LIST, "z");
    describe(&f, 2, "mot").expect("description");
    f.at("2026-02-01T00:00:00.000Z");
    add(&f, 3, LIST, "mot ancien");
    f.at("2026-02-15T00:00:00.000Z");
    add(&f, 4, LIST, "mot récent");
    assert_eq!(
        hit_titles(&f, "mot", 10),
        ["mot récent", "mot ancien", "z", "mot fini"]
    );
}

/// TS (search): "matches % and _ literally in descriptions".
#[test]
fn search_matches_wildcards_literally_in_descriptions() {
    let f = fixture();
    add(&f, 1, LIST, "a");
    describe(&f, 1, "remise 5% ici").expect("description");
    add(&f, 2, LIST, "b");
    describe(&f, 2, "x_y").expect("description");
    add(&f, 3, LIST, "c");
    assert_eq!(hit_titles(&f, "5%", 10), ["a"]);
    assert_eq!(hit_titles(&f, "x_y", 10), ["b"]);
    assert!(hit_titles(&f, "xzy", 10).is_empty());
}

/// TS (search): "finds %, _ and \ literally and honours the limit" (+ validation, quotes).
#[test]
fn search_finds_wildcards_literally_honours_the_limit_and_validates() {
    let f = fixture();
    add(&f, 1, LIST, "solde 20%");
    add(&f, 2, LIST, "a_b");
    add(&f, 3, LIST, "x\\y");
    add(&f, 4, LIST, "axb");
    assert_eq!(hit_titles(&f, "%", 10), ["solde 20%"]);
    assert_eq!(hit_titles(&f, "a_b", 10), ["a_b"]);
    assert_eq!(hit_titles(&f, "\\", 10), ["x\\y"]);
    assert_eq!(hits(&f, "x", 1).len(), 1);
    let offline = f.without_disk();
    assert_eq!(
        run(search_todos(&offline, "x", 0)),
        Err(DataError::invalid("limit"))
    );
    assert_eq!(
        run(search_todos(&offline, "  ", 5)),
        Err(DataError::invalid("query"))
    );
    assert!(hits(&f, "'; DROP TABLE todos; --", 5).is_empty());
    assert_eq!(f.scalar("SELECT COUNT(*) FROM todos"), 4);
}

/// T7: every write is `unavailable`, nothing changes; reads work.
#[test]
fn writes_are_unavailable_when_a_restoration_is_staged() {
    let f = fixture();
    add_due(&f, 1, LIST, "A", "2026-03-04");
    rule(&f, 1, "FREQ=WEEKLY");
    let ro = f.read_only();
    let unavailable = || Err::<(), DataError>(DataError::Unavailable);
    assert_eq!(
        run(create_list(&ro, &list_new(5, None, "x"))).map(|_| ()),
        unavailable()
    );
    assert_eq!(
        run(create_todo(&ro, &todo_new(2, LIST, "B", None))).map(|_| ()),
        unavailable()
    );
    assert_eq!(
        run(update_todo(&ro, &uid(1), &TodoChangesDto::default())).map(|_| ()),
        unavailable()
    );
    assert_eq!(
        run(shift_repeat_due(&ro, &uid(1), "2026-03-04", "2026-03-11")).map(|_| ()),
        unavailable()
    );
    assert_eq!(
        run(set_completed(&ro, &uid(1), true)).map(|_| ()),
        unavailable()
    );
    assert_eq!(run(delete_todo(&ro, &uid(1))).map(|_| ()), unavailable());
    assert_eq!(
        run(reorder_todos(&ro, &uid(LIST), &[uid(1)])),
        unavailable()
    );
    assert_eq!(run(reorder_todos(&ro, &uid(LIST), &[])), unavailable());
    assert_eq!(
        run(clear_completed(&ro, &uid(LIST))).map(|_| ()),
        unavailable()
    );
    assert_eq!(f.scalar("SELECT COUNT(*) FROM todos"), 1);
    assert_eq!(f.scalar("SELECT COUNT(*) FROM todo_lists"), 2);
    assert_eq!(f.text("SELECT title FROM todos"), "A");
    assert_eq!(f.text("SELECT due_on FROM todos"), "2026-03-04");
    assert_eq!(f.scalar("SELECT completed_at IS NULL FROM todos"), 1);
    assert_eq!(run(list_todos(&ro, &uid(LIST))).expect("items").len(), 1);
    assert_eq!(
        run(list_due(&ro, "2026-03-01", "2026-03-31", 5))
            .expect("due")
            .len(),
        1
    );
    assert_eq!(run(search_todos(&ro, "a", 5)).expect("search").len(), 1);
}

/// Timestamps come from the injected clock.
#[test]
fn timestamps_come_from_the_injected_clock() {
    let f = fixture();
    f.at("2031-07-08T09:10:11.012Z");
    let t = add(&f, 1, LIST, "A");
    assert_eq!(t.created_at, "2031-07-08T09:10:11.012Z");
    assert_eq!(t.updated_at, "2031-07-08T09:10:11.012Z");
    let list = new_list(&f, 5, "L");
    assert_eq!(list.created_at, "2031-07-08T09:10:11.012Z");
    f.at("2031-08-09T00:00:00.000Z");
    assert_eq!(
        check(&f, 1, true).completed_at.as_deref(),
        Some("2031-08-09T00:00:00.000Z")
    );
}

/// DTO: camelCase exact, unknown field refused (one test per input DTO).
#[test]
fn todo_dtos_are_camel_case_and_inputs_refuse_unknown_fields() {
    let f = Fixture::create();
    let list = owned_list(&f, LIST, 10);
    assert_eq!(
        serde_json::to_value(&list).expect("json"),
        serde_json::json!({
            "id": uid(LIST), "widgetInstanceId": uid(10), "name": "Tâches",
            "createdAt": T0, "updatedAt": T0
        })
    );
    let t = add_due(&f, 1, LIST, "A", "2026-03-04");
    assert_eq!(
        serde_json::to_value(&t).expect("json"),
        serde_json::json!({
            "id": uid(1), "listId": uid(LIST), "title": "A", "description": "",
            "dueOn": "2026-03-04", "rrule": null, "important": false, "completedAt": null,
            "sortOrder": 0, "createdAt": T0, "updatedAt": T0
        })
    );
    assert_eq!(
        serde_json::to_value(&hits(&f, "A", 5)[0]).expect("json"),
        serde_json::json!({
            "id": uid(1), "title": "A", "description": "", "listId": uid(LIST),
            "widgetInstanceId": uid(10), "completedAt": null
        })
    );
    let list_in = serde_json::json!({ "id": uid(2), "widgetInstanceId": null, "name": "x" });
    assert!(serde_json::from_value::<TodoListNewDto>(list_in.clone()).is_ok());
    let mut extra = list_in;
    extra["extra"] = serde_json::json!(1);
    assert!(serde_json::from_value::<TodoListNewDto>(extra).is_err());
    let todo_in = serde_json::json!({
        "id": uid(2), "listId": uid(LIST), "title": "x", "dueOn": null
    });
    assert!(serde_json::from_value::<TodoNewDto>(todo_in.clone()).is_ok());
    let mut extra = todo_in.clone();
    extra["extra"] = serde_json::json!(1);
    assert!(serde_json::from_value::<TodoNewDto>(extra).is_err());
    let mut snake = todo_in;
    snake["list_id"] = serde_json::json!("x");
    assert!(serde_json::from_value::<TodoNewDto>(snake).is_err());
}
