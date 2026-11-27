//! Widget instance commands: port of `sqlite-widget-instance.repository.spec.ts` (the
//! `moveToDashboard` cases are in `dashboards_tests.rs`, T3) plus the cases of 4.11 (DTO,
//! atomicity, T6, T7, timestamps).

use super::support::{uid, Fixture, T0};
use crate::backup::test_support::run;
use crate::data::dashboards::{create_dashboard, DashboardNewDto};
use crate::data::error::DataError;
use crate::data::widgets::{
    create_widget, delete_widget, find_first_widget_of_type, get_widget, list_widgets,
    update_widget_config, update_widget_layout, write_layout, GridDto, LayoutItemDto, WidgetDto,
    WidgetNewDto,
};
use crate::data::{MAX_BATCH, MAX_WIDGETS, MAX_WIDGETS_PER_DASHBOARD};

const MISSING: u32 = 0xff;
const DASHBOARD: u32 = 1;

fn grid(x: i64, y: i64, w: i64, h: i64) -> GridDto {
    GridDto { x, y, w, h }
}

fn rect(x: i64, y: i64) -> GridDto {
    grid(x, y, 2, 2)
}

fn dashboard(f: &Fixture, id: u32, name: &str) {
    run(create_dashboard(
        &f.ctx,
        &DashboardNewDto {
            id: uid(id),
            name: name.to_owned(),
            icon: None,
            theme_json: None,
            theme_version: None,
        },
    ))
    .expect("dashboard");
}

fn fixture() -> Fixture {
    let f = Fixture::create();
    dashboard(&f, DASHBOARD, "Main");
    f
}

fn input(id: u32, dashboard_id: u32, widget_type: &str, g: GridDto) -> WidgetNewDto {
    WidgetNewDto {
        id: uid(id),
        dashboard_id: uid(dashboard_id),
        widget_type: widget_type.to_owned(),
        grid: g,
        config_json: "{}".to_owned(),
        config_version: 1,
    }
}

fn add(f: &Fixture, id: u32, g: GridDto) -> WidgetDto {
    run(create_widget(&f.ctx, &input(id, DASHBOARD, "todo", g))).expect("create")
}

fn ids(f: &Fixture, dashboard_id: u32) -> Vec<String> {
    run(list_widgets(&f.ctx, &uid(dashboard_id)))
        .expect("list")
        .into_iter()
        .map(|w| w.id)
        .collect()
}

fn grid_of(f: &Fixture, id: u32) -> GridDto {
    run(get_widget(&f.ctx, &uid(id)))
        .expect("get")
        .expect("exists")
        .grid
}

fn item(id: u32, g: GridDto) -> LayoutItemDto {
    LayoutItemDto {
        id: uid(id),
        grid: g,
    }
}

fn layout(f: &Fixture, items: &[LayoutItemDto]) -> Result<u32, DataError> {
    run(update_widget_layout(&f.ctx, &uid(DASHBOARD), items))
}

/// TS: "creates and reads back a record with a nested config" (+ get of an absent id).
#[test]
fn creates_and_reads_back_a_record_with_a_nested_config() {
    let f = fixture();
    let config = r#"{"filters":{"done":false,"tags":["a","b"]},"limit":10}"#;
    let created = run(create_widget(
        &f.ctx,
        &WidgetNewDto {
            config_json: config.to_owned(),
            config_version: 2,
            ..input(2, DASHBOARD, "todo", grid(1, 2, 3, 4))
        },
    ))
    .expect("create");
    assert_eq!(
        created,
        WidgetDto {
            id: uid(2),
            dashboard_id: uid(DASHBOARD),
            widget_type: "todo".to_owned(),
            grid: grid(1, 2, 3, 4),
            config_json: config.to_owned(),
            config_version: 2,
            created_at: T0.to_owned(),
            updated_at: T0.to_owned(),
        }
    );
    assert_eq!(run(get_widget(&f.ctx, &uid(2))), Ok(Some(created)));
    assert_eq!(run(get_widget(&f.ctx, &uid(MISSING))), Ok(None));
    // L14: a malformed id designates nothing.
    assert_eq!(run(get_widget(&f.ctx, "../etc")), Ok(None));
}

/// TS: "refuses an instance on a missing dashboard with constraint".
#[test]
fn an_instance_on_a_missing_dashboard_is_a_constraint() {
    let f = fixture();
    assert_eq!(
        run(create_widget(
            &f.ctx,
            &input(2, MISSING, "todo", rect(0, 0))
        )),
        Err(DataError::Constraint)
    );
    assert_eq!(f.scalar("SELECT COUNT(*) FROM widget_instances"), 0);
}

/// Creation: id shape first (4.9 item 1), same id twice is a conflict (L1), the rectangle and
/// the config are the `CHECK`'s business (current contract), the IPC cap is `invalid_input`.
#[test]
fn creation_checks_the_id_then_lets_the_check_decide() {
    let f = fixture();
    let bad_id = WidgetNewDto {
        id: "NOT-A-UUID".to_owned(),
        ..input(2, DASHBOARD, "todo", rect(0, 0))
    };
    assert_eq!(
        run(create_widget(&f.ctx, &bad_id)),
        Err(DataError::invalid("id"))
    );
    add(&f, 2, rect(0, 0));
    assert_eq!(
        run(create_widget(
            &f.ctx,
            &input(2, DASHBOARD, "todo", rect(1, 1))
        )),
        Err(DataError::Conflict)
    );
    for bad in [grid(0, 0, 0, 1), grid(-1, 0, 1, 1), grid(0, 0, 1, 0)] {
        assert_eq!(
            run(create_widget(&f.ctx, &input(3, DASHBOARD, "todo", bad))),
            Err(DataError::invalid("grid")),
            "{bad:?}"
        );
    }
    for config in ["[1]", "not json", "\"s\""] {
        let bad = WidgetNewDto {
            config_json: config.to_owned(),
            ..input(3, DASHBOARD, "todo", rect(0, 0))
        };
        assert_eq!(run(create_widget(&f.ctx, &bad)), Err(DataError::Constraint));
    }
    let huge = WidgetNewDto {
        config_json: "x".repeat(262_145),
        ..input(3, DASHBOARD, "todo", rect(0, 0))
    };
    assert_eq!(
        run(create_widget(&f.without_disk(), &huge)),
        Err(DataError::invalid("configJson"))
    );
    assert_eq!(
        run(create_widget(&f.ctx, &input(3, DASHBOARD, "", rect(0, 0)))),
        Err(DataError::invalid("widgetType"))
    );
    assert_eq!(ids(&f, DASHBOARD), [uid(2)]);
}

/// TS: "reports corrupt_data when the stored config is not an object": the text is returned as
/// stored (L17); the front adapter raises `corrupt_data` when it parses it.
#[test]
fn a_corrupted_config_is_returned_as_stored() {
    let f = fixture();
    add(&f, 2, rect(0, 0));
    f.exec_unchecked(&format!(
        "UPDATE widget_instances SET config = '[1]' WHERE id = '{}'",
        uid(2)
    ));
    let widget = run(get_widget(&f.ctx, &uid(2))).expect("get").expect("row");
    assert_eq!(widget.config_json, "[1]");
}

/// TS: "updates config, version and updated_at, or throws not_found".
#[test]
fn update_config_bumps_version_and_updated_at_or_is_not_found() {
    let f = fixture();
    add(&f, 2, rect(0, 0));
    f.at("2026-04-04T00:00:00.000Z");
    let updated = run(update_widget_config(&f.ctx, &uid(2), r#"{"a":1}"#, 3)).expect("update");
    assert_eq!(updated.config_json, r#"{"a":1}"#);
    assert_eq!(updated.config_version, 3);
    assert_eq!(updated.updated_at, "2026-04-04T00:00:00.000Z");
    assert_eq!(updated.created_at, T0);
    assert_eq!(
        run(update_widget_config(&f.ctx, &uid(MISSING), "{}", 1)),
        Err(DataError::NotFound)
    );
    assert_eq!(
        run(update_widget_config(&f.ctx, "malformed", "{}", 1)),
        Err(DataError::NotFound)
    );
    assert_eq!(
        run(update_widget_config(&f.ctx, &uid(2), "[]", 1)),
        Err(DataError::Constraint)
    );
    assert_eq!(
        run(update_widget_config(&f.ctx, &uid(2), "{}", 0)),
        Err(DataError::invalid("configVersion"))
    );
    assert_eq!(
        run(update_widget_config(
            &f.without_disk(),
            &uid(2),
            &"x".repeat(262_145),
            1
        )),
        Err(DataError::invalid("configJson"))
    );
}

/// TS: "updates the layout of a batch of 3".
#[test]
fn updates_the_layout_of_a_batch_of_3() {
    let f = fixture();
    for (id, x) in [(2, 0), (3, 1), (4, 2)] {
        add(&f, id, rect(x, 0));
    }
    let n = layout(
        &f,
        &[
            item(2, grid(5, 5, 1, 1)),
            item(3, grid(6, 6, 2, 2)),
            item(4, grid(7, 7, 3, 3)),
        ],
    );
    assert_eq!(n, Ok(3));
    assert_eq!(grid_of(&f, 2), grid(5, 5, 1, 1));
    assert_eq!(grid_of(&f, 3), grid(6, 6, 2, 2));
    assert_eq!(grid_of(&f, 4), grid(7, 7, 3, 3));
}

/// TS: "ignores unknown ids in a layout batch".
#[test]
fn ignores_unknown_ids_in_a_layout_batch() {
    let f = fixture();
    add(&f, 2, rect(0, 0));
    let n = layout(&f, &[item(2, rect(3, 3)), item(MISSING, rect(4, 4))]);
    assert_eq!(n, Ok(1));
    assert_eq!(grid_of(&f, 2), rect(3, 3));
}

/// TS: "does not touch an instance of another dashboard".
#[test]
fn does_not_touch_an_instance_of_another_dashboard() {
    let f = fixture();
    dashboard(&f, 9, "Other");
    add(&f, 2, rect(0, 0));
    let n = run(update_widget_layout(
        &f.ctx,
        &uid(9),
        &[item(2, rect(9, 9))],
    ));
    assert_eq!(n, Ok(0));
    assert_eq!(grid_of(&f, 2), rect(0, 0));
}

/// TS: "returns 0 for an empty batch without querying" (no disk: the file does not exist).
#[test]
fn an_empty_layout_batch_is_zero_without_disk_access() {
    let f = fixture();
    assert_eq!(
        run(update_widget_layout(
            &f.without_disk(),
            &uid(DASHBOARD),
            &[]
        )),
        Ok(0)
    );
}

/// TS: "rejects invalid batches with invalid_input before any query" (no disk: `invalid_input`,
/// not `unavailable`).
#[test]
fn invalid_layout_batches_are_refused_before_the_disk() {
    let f = fixture();
    let ctx = f.without_disk();
    let run_layout =
        |items: &[LayoutItemDto]| run(update_widget_layout(&ctx, &uid(DASHBOARD), items));
    assert_eq!(
        run_layout(&[item(2, rect(1, 1)), item(2, rect(2, 2))]),
        Err(DataError::invalid("items"))
    );
    for bad in [
        grid(1, 1, 0, 1),
        grid(1, 1, 1, 0),
        grid(-1, 1, 1, 1),
        grid(1, -1, 1, 1),
        grid(10_001, 1, 1, 1),
        grid(1, 10_001, 1, 1),
        grid(1, 1, 10_001, 1),
        grid(1, 1, 1, 10_001),
    ] {
        assert_eq!(
            run_layout(&[item(2, bad)]),
            Err(DataError::invalid("grid")),
            "{bad:?}"
        );
    }
    // Bounds included are valid up to the disk.
    assert_eq!(
        run_layout(&[item(2, grid(10_000, 10_000, 10_000, 10_000))]),
        Err(DataError::Unavailable)
    );
    let too_many: Vec<LayoutItemDto> = (1..=u32::try_from(MAX_BATCH + 1).expect("u32"))
        .map(|i| item(i, rect(0, 0)))
        .collect();
    assert_eq!(run_layout(&too_many), Err(DataError::invalid("items")));
    assert_eq!(
        run_layout(&too_many[..MAX_BATCH]),
        Err(DataError::Unavailable)
    );
}

/// TS: "is atomic: one invalid row in the statement leaves all rows untouched" (the validation
/// is bypassed by calling the statement function with a payload it would have refused).
#[test]
fn the_layout_statement_is_atomic() {
    let f = fixture();
    for (id, x) in [(2, 0), (3, 1), (4, 2)] {
        add(&f, id, rect(x, 0));
    }
    let payload = format!(
        r#"[{{"id":"{}","x":5,"y":5,"w":1,"h":1}},{{"id":"{}","x":6,"y":6,"w":0,"h":1}},{{"id":"{}","x":7,"y":7,"w":1,"h":1}}]"#,
        uid(2),
        uid(3),
        uid(4)
    );
    assert_eq!(
        run(write_layout(&f.ctx, &uid(DASHBOARD), &payload)),
        Err(DataError::Constraint)
    );
    for (id, x) in [(2, 0), (3, 1), (4, 2)] {
        assert_eq!(grid_of(&f, id), rect(x, 0));
    }
}

/// Layout writes stamp `updated_at` with the clock.
#[test]
fn the_layout_bumps_updated_at() {
    let f = fixture();
    add(&f, 2, rect(0, 0));
    f.at("2026-06-06T00:00:00.000Z");
    assert_eq!(layout(&f, &[item(2, rect(1, 1))]), Ok(1));
    assert_eq!(
        f.text(&format!(
            "SELECT updated_at FROM widget_instances WHERE id = '{}'",
            uid(2)
        )),
        "2026-06-06T00:00:00.000Z"
    );
}

/// TS (findFirstOfType): "returns null when no instance has the type".
#[test]
fn find_first_of_type_is_none_without_a_match() {
    let f = fixture();
    add(&f, 2, rect(0, 0));
    assert_eq!(run(find_first_widget_of_type(&f.ctx, "search")), Ok(None));
    // More than 64 characters matches nothing (and is not an error).
    assert_eq!(
        run(find_first_widget_of_type(
            &f.without_disk(),
            &"x".repeat(65)
        )),
        Ok(None)
    );
}

/// TS (findFirstOfType): "follows the dashboard order, then the grid order".
#[test]
fn find_first_of_type_follows_the_dashboard_then_the_grid_order() {
    let f = fixture();
    dashboard(&f, 9, "Second");
    // Created first, but on the later dashboard.
    let late = run(create_widget(&f.ctx, &input(2, 9, "search", rect(0, 0)))).expect("late");
    let first = |f: &Fixture| {
        run(find_first_widget_of_type(&f.ctx, "search"))
            .expect("find")
            .expect("some")
    };
    assert_eq!(first(&f).id, late.id);
    run(create_widget(
        &f.ctx,
        &input(3, DASHBOARD, "search", rect(0, 3)),
    ))
    .expect("lower");
    let upper = run(create_widget(
        &f.ctx,
        &input(4, DASHBOARD, "search", rect(4, 0)),
    ))
    .expect("upper");
    assert_eq!(first(&f), upper);
}

/// TS: "lists ordered by grid_y, grid_x, created_at, id".
#[test]
fn lists_ordered_by_grid_y_grid_x_created_at_id() {
    let f = fixture();
    add(&f, 2, rect(1, 0));
    add(&f, 3, rect(0, 1));
    add(&f, 4, rect(0, 0));
    assert_eq!(ids(&f, DASHBOARD), [uid(4), uid(2), uid(3)]);
    // Same position: created_at, then id.
    f.at("2026-02-02T00:00:00.000Z");
    add(&f, 6, rect(5, 5));
    f.at("2026-01-01T00:00:00.000Z");
    add(&f, 7, rect(5, 5));
    add(&f, 5, rect(5, 5));
    assert_eq!(ids(&f, DASHBOARD)[3..], [uid(5), uid(7), uid(6)]);
    assert_eq!(ids(&f, 9), Vec::<String>::new());
}

/// TS: "removes idempotently" (+ the cascade to its notes).
#[test]
fn delete_is_idempotent_and_cascades() {
    let f = fixture();
    add(&f, 2, rect(0, 0));
    f.exec(&format!(
        "INSERT INTO notes (id, widget_instance_id, title, body, created_at, updated_at)
         VALUES ('{}', '{}', 't', 'b', '{T0}', '{T0}')",
        uid(50),
        uid(2)
    ));
    assert_eq!(run(delete_widget(&f.ctx, &uid(2))), Ok(true));
    assert_eq!(run(delete_widget(&f.ctx, &uid(2))), Ok(false));
    assert_eq!(run(delete_widget(&f.ctx, "malformed")), Ok(false));
    assert_eq!(f.scalar("SELECT COUNT(*) FROM notes"), 0);
}

/// T6: 200 instances per dashboard.
#[test]
fn the_201st_widget_of_a_dashboard_is_refused() {
    let f = fixture();
    insert_widgets(&f, DASHBOARD, 1000, MAX_WIDGETS_PER_DASHBOARD);
    assert_eq!(
        run(create_widget(
            &f.ctx,
            &input(1, DASHBOARD, "todo", rect(0, 0))
        )),
        Err(DataError::LimitReached)
    );
    assert_eq!(
        f.scalar("SELECT COUNT(*) FROM widget_instances"),
        MAX_WIDGETS_PER_DASHBOARD
    );
    // Another dashboard is not affected.
    dashboard(&f, 9, "Other");
    assert!(run(create_widget(&f.ctx, &input(1, 9, "todo", rect(0, 0)))).is_ok());
}

/// T6: 1 000 instances in total.
#[test]
fn the_1001st_widget_is_refused() {
    let f = fixture();
    let per = MAX_WIDGETS_PER_DASHBOARD;
    for d in 0..5u32 {
        dashboard(&f, 10 + d, "D");
        insert_widgets(&f, 10 + d, 10_000 + d * 1000, per);
    }
    assert_eq!(
        f.scalar("SELECT COUNT(*) FROM widget_instances"),
        MAX_WIDGETS
    );
    assert_eq!(
        run(create_widget(
            &f.ctx,
            &input(1, DASHBOARD, "todo", rect(0, 0))
        )),
        Err(DataError::LimitReached)
    );
    assert_eq!(
        f.scalar("SELECT COUNT(*) FROM widget_instances"),
        MAX_WIDGETS
    );
}

fn insert_widgets(f: &Fixture, dashboard_id: u32, first: u32, count: i64) {
    f.exec(&format!(
        "WITH RECURSIVE n(i) AS (SELECT {first} UNION ALL SELECT i + 1 FROM n WHERE i < {})
         INSERT INTO widget_instances
           (id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h, config, config_version,
            created_at, updated_at)
         SELECT printf('00000000-0000-4000-8000-%012x', i), '{}', 'todo', 0, 0, 2, 2, '{{}}', 1,
                '{T0}', '{T0}' FROM n",
        i64::from(first) + count - 1,
        uid(dashboard_id)
    ));
}

/// T7: every write is `unavailable`, nothing changes; reads work.
#[test]
fn writes_are_unavailable_when_a_restoration_is_staged() {
    let f = fixture();
    add(&f, 2, rect(0, 0));
    let ro = f.read_only();
    assert_eq!(
        run(create_widget(&ro, &input(3, DASHBOARD, "todo", rect(0, 0)))),
        Err(DataError::Unavailable)
    );
    assert_eq!(
        run(update_widget_config(&ro, &uid(2), r#"{"a":1}"#, 2)),
        Err(DataError::Unavailable)
    );
    assert_eq!(
        run(update_widget_layout(
            &ro,
            &uid(DASHBOARD),
            &[item(2, rect(7, 7))]
        )),
        Err(DataError::Unavailable)
    );
    assert_eq!(
        run(update_widget_layout(&ro, &uid(DASHBOARD), &[])),
        Err(DataError::Unavailable)
    );
    assert_eq!(
        run(delete_widget(&ro, &uid(2))),
        Err(DataError::Unavailable)
    );
    assert_eq!(ids(&f, DASHBOARD), [uid(2)]);
    assert_eq!(grid_of(&f, 2), rect(0, 0));
    assert!(run(get_widget(&ro, &uid(2))).expect("get").is_some());
    assert_eq!(
        run(list_widgets(&ro, &uid(DASHBOARD))).expect("list").len(),
        1
    );
    assert!(run(find_first_widget_of_type(&ro, "todo"))
        .expect("find")
        .is_some());
}

/// Timestamps come from the injected clock.
#[test]
fn timestamps_come_from_the_injected_clock() {
    let f = fixture();
    f.at("2031-07-08T09:10:11.012Z");
    let w = add(&f, 2, rect(0, 0));
    assert_eq!(w.created_at, "2031-07-08T09:10:11.012Z");
    assert_eq!(w.updated_at, "2031-07-08T09:10:11.012Z");
}

/// DTO: camelCase exact, unknown field refused (one test per input DTO), a non-integer number
/// is refused by the deserialization (S2).
#[test]
fn widget_dtos_are_camel_case_and_inputs_refuse_unknown_fields() {
    let f = fixture();
    let created = add(&f, 2, grid(1, 2, 3, 4));
    assert_eq!(
        serde_json::to_value(&created).expect("json"),
        serde_json::json!({
            "id": uid(2), "dashboardId": uid(1), "widgetType": "todo",
            "grid": { "x": 1, "y": 2, "w": 3, "h": 4 },
            "configJson": "{}", "configVersion": 1, "createdAt": T0, "updatedAt": T0
        })
    );
    let ok = serde_json::json!({
        "id": uid(2), "dashboardId": uid(1), "widgetType": "todo",
        "grid": { "x": 1, "y": 2, "w": 3, "h": 4 }, "configJson": "{}", "configVersion": 1
    });
    assert!(serde_json::from_value::<WidgetNewDto>(ok.clone()).is_ok());
    let mut extra = ok.clone();
    extra["extra"] = serde_json::json!(true);
    assert!(serde_json::from_value::<WidgetNewDto>(extra).is_err());
    let mut extra = ok.clone();
    extra["grid"]["z"] = serde_json::json!(1);
    assert!(serde_json::from_value::<WidgetNewDto>(extra).is_err());
    let mut fractional = ok.clone();
    fractional["grid"]["x"] = serde_json::json!(1.5);
    assert!(serde_json::from_value::<WidgetNewDto>(fractional).is_err());
    let mut text = ok;
    text["configVersion"] = serde_json::json!("1");
    assert!(serde_json::from_value::<WidgetNewDto>(text).is_err());
    let layout = serde_json::json!({ "id": uid(2), "grid": { "x": 0, "y": 0, "w": 1, "h": 1 } });
    assert!(serde_json::from_value::<LayoutItemDto>(layout.clone()).is_ok());
    let mut extra = layout;
    extra["extra"] = serde_json::json!(1);
    assert!(serde_json::from_value::<LayoutItemDto>(extra).is_err());
}

/// T6: what a command accepts the import accepts; checked before the disk.
#[test]
fn widget_type_is_bounded_like_the_import() {
    let f = fixture();
    let offline = f.without_disk();
    for bad in ["", &"x".repeat(65), "to\0do", "\0"] {
        assert_eq!(
            run(create_widget(
                &offline,
                &input(2, DASHBOARD, bad, rect(0, 0))
            )),
            Err(DataError::invalid("widgetType")),
            "{bad:?}"
        );
    }
    // The import counts code points: 64 of them pass, 65 do not.
    run(create_widget(&f.ctx, &input(3, DASHBOARD, "a", rect(0, 0)))).expect("1");
    run(create_widget(
        &f.ctx,
        &input(4, DASHBOARD, &"𝔸".repeat(64), rect(0, 0)),
    ))
    .expect("64 code points");
    assert_eq!(
        run(create_widget(
            &f.ctx,
            &input(5, DASHBOARD, &"𝔸".repeat(65), rect(0, 0))
        )),
        Err(DataError::invalid("widgetType"))
    );
}

#[test]
fn widget_grid_is_bounded_to_10_000_on_creation() {
    let f = fixture();
    let offline = f.without_disk();
    for bad in [
        grid(10_001, 0, 1, 1),
        grid(0, 10_001, 1, 1),
        grid(0, 0, 10_001, 1),
        grid(0, 0, 1, 10_001),
    ] {
        assert_eq!(
            run(create_widget(&offline, &input(2, DASHBOARD, "todo", bad))),
            Err(DataError::invalid("grid")),
            "{bad:?}"
        );
    }
    let edge = grid(10_000, 10_000, 10_000, 10_000);
    assert_eq!(add(&f, 2, edge).grid, edge);
}

#[test]
fn config_version_is_bounded_to_1_10_000() {
    let f = fixture();
    let offline = f.without_disk();
    for bad in [0, -1, 10_001, i64::MAX] {
        let new = WidgetNewDto {
            config_version: bad,
            ..input(2, DASHBOARD, "todo", rect(0, 0))
        };
        assert_eq!(
            run(create_widget(&offline, &new)),
            Err(DataError::invalid("configVersion")),
            "{bad}"
        );
        assert_eq!(
            run(update_widget_config(&offline, &uid(2), "{}", bad)),
            Err(DataError::invalid("configVersion")),
            "{bad}"
        );
    }
    for good in [1, 10_000] {
        let new = WidgetNewDto {
            config_version: good,
            ..input(2, DASHBOARD, "todo", rect(0, 0))
        };
        run(create_widget(&f.ctx, &new)).expect("create");
        let updated = run(update_widget_config(&f.ctx, &uid(2), "{}", good)).expect("update");
        assert_eq!(updated.config_version, good);
        run(delete_widget(&f.ctx, &uid(2))).expect("delete");
    }
}
