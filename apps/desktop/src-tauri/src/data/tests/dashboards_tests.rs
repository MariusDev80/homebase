//! Dashboard commands: port of `sqlite-dashboard.repository.spec.ts` and of the `moveToDashboard`
//! cases of `sqlite-widget-instance.repository.spec.ts` (now `dashboard_create_with_widgets`, T3),
//! plus the cases of 4.11 (DTO, atomicity, T6, T7, timestamps).

use super::support::{uid, Fixture, T0};
use crate::backup::test_support::run;
use crate::data::dashboards::{
    create_dashboard, create_with_widgets, create_with_widgets_unchecked, ensure_default_dashboard,
    get_dashboard, list_dashboards, update_dashboard, update_dashboard_theme, DashboardDto,
    DashboardNewDto, DashboardWithWidgetsDto, DashboardWithWidgetsResult,
};
use crate::data::error::DataError;
use crate::data::widgets::{GridDto, LayoutItemDto};
use crate::data::MAX_DASHBOARDS;

fn new(id: u32, name: &str) -> DashboardNewDto {
    DashboardNewDto {
        id: uid(id),
        name: name.to_owned(),
        icon: None,
        theme_json: None,
        theme_version: None,
    }
}

fn create(f: &Fixture, input: &DashboardNewDto) -> Result<DashboardDto, DataError> {
    run(create_dashboard(&f.ctx, input))
}

fn names(f: &Fixture) -> Vec<String> {
    run(list_dashboards(&f.ctx))
        .expect("list")
        .into_iter()
        .map(|d| d.name)
        .collect()
}

/// Text of a theme whose serialized size is exactly `chars` code points.
fn sized(filler: &str, chars: usize) -> String {
    format!(
        r#"{{"a":"{}"}}"#,
        filler.repeat(chars - r#"{"a":""}"#.len())
    )
}

const MISSING: u32 = 0xff;

/// TS: "creates with a deterministic id and a frozen timestamp".
#[test]
fn creates_with_defaults_and_the_clock_timestamp() {
    let f = Fixture::create();
    let d = create(&f, &new(1, "Home")).expect("create");
    assert_eq!(
        d,
        DashboardDto {
            id: uid(1),
            name: "Home".to_owned(),
            sort_order: 0,
            icon: "th-large".to_owned(),
            theme_json: "{}".to_owned(),
            theme_version: 1,
            created_at: T0.to_owned(),
            updated_at: T0.to_owned(),
        }
    );
}

/// TS: "increments sortOrder and lists in order" (+ get, + L14 unknown or malformed id).
#[test]
fn increments_sort_order_lists_in_order_and_gets_by_id() {
    let f = Fixture::create();
    let a = create(&f, &new(1, "A")).expect("a");
    let b = create(&f, &new(2, "B")).expect("b");
    let c = create(&f, &new(3, "C")).expect("c");
    assert_eq!([a.sort_order, b.sort_order, c.sort_order], [0, 1, 2]);
    assert_eq!(names(&f), ["A", "B", "C"]);
    assert_eq!(run(get_dashboard(&f.ctx, &b.id)), Ok(Some(b)));
    assert_eq!(run(get_dashboard(&f.ctx, &uid(MISSING))), Ok(None));
    assert_eq!(run(get_dashboard(&f.ctx, "not an id")), Ok(None));
}

/// Same sort order: created_at then id.
#[test]
fn list_breaks_ties_by_created_at_then_id() {
    let f = Fixture::create();
    f.exec(&format!(
        "INSERT INTO dashboards (id, name, sort_order, created_at, updated_at) VALUES
         ('{}', 'late', 0, '2026-01-02T00:00:00.000Z', '{T0}'),
         ('{}', 'b', 0, '{T0}', '{T0}'),
         ('{}', 'a', 0, '{T0}', '{T0}')",
        uid(1),
        uid(3),
        uid(2)
    ));
    assert_eq!(names(&f), ["a", "b", "late"]);
}

/// TS: "createIfNone creates once only".
#[test]
fn ensure_default_creates_once_only() {
    let f = Fixture::create();
    assert_eq!(
        run(ensure_default_dashboard(&f.ctx, &new(1, "First"))),
        Ok(true)
    );
    assert_eq!(
        run(ensure_default_dashboard(&f.ctx, &new(2, "Second"))),
        Ok(false)
    );
    assert_eq!(names(&f), ["First"]);
}

/// L2: concurrent calls of `dashboard_ensure_default` give one dashboard.
#[test]
fn ensure_default_in_parallel_creates_one_dashboard() {
    let f = Fixture::create();
    let (a, b) = (new(1, "A"), new(2, "B"));
    let (ra, rb) = std::thread::scope(|s| {
        let first = s.spawn(|| run(ensure_default_dashboard(&f.ctx, &a)));
        let second = s.spawn(|| run(ensure_default_dashboard(&f.ctx, &b)));
        (first.join().expect("first"), second.join().expect("second"))
    });
    let created = [ra, rb].iter().filter(|r| **r == Ok(true)).count();
    assert_eq!(created, 1);
    assert_eq!(f.scalar("SELECT COUNT(*) FROM dashboards"), 1);
}

/// The input is checked even when nothing is inserted.
#[test]
fn ensure_default_validates_even_when_a_dashboard_exists() {
    let f = Fixture::create();
    create(&f, &new(1, "A")).expect("a");
    assert_eq!(
        run(ensure_default_dashboard(&f.ctx, &new(2, "  "))),
        Err(DataError::invalid("name"))
    );
}

/// TS: "creates with and without an icon".
#[test]
fn icon_defaults_and_is_validated() {
    let f = Fixture::create();
    assert_eq!(create(&f, &new(1, "A")).expect("a").icon, "th-large");
    let with_icon = DashboardNewDto {
        icon: Some("briefcase".to_owned()),
        ..new(2, "B")
    };
    assert_eq!(create(&f, &with_icon).expect("b").icon, "briefcase");
    for icon in ["pi pi-x", "", "A", &"a".repeat(33)] {
        let input = DashboardNewDto {
            icon: Some(icon.to_owned()),
            ..new(3, "C")
        };
        assert_eq!(
            create(&f, &input),
            Err(DataError::invalid("icon")),
            "{icon}"
        );
    }
    assert_eq!(names(&f).len(), 2);
}

#[test]
fn creation_checks_id_name_in_order_and_trims() {
    let f = Fixture::create();
    let bad_id = DashboardNewDto {
        id: "nope".to_owned(),
        name: String::new(),
        ..new(1, "x")
    };
    assert_eq!(create(&f, &bad_id), Err(DataError::invalid("id")));
    assert_eq!(create(&f, &new(1, "   ")), Err(DataError::invalid("name")));
    // Like the import: a NUL is refused (the `CHECK` `length()` stops at it).
    for name in ["a\0b", "\0", "\0\0 x"] {
        assert_eq!(
            create(&f, &new(1, name)),
            Err(DataError::invalid("name")),
            "{name:?}"
        );
        assert_eq!(
            run(update_dashboard(&f.ctx, &uid(1), name, "home")),
            Err(DataError::invalid("name"))
        );
    }
    assert_eq!(
        create(&f, &new(1, &"x".repeat(101))),
        Err(DataError::invalid("name"))
    );
    assert_eq!(
        create(&f, &new(1, "  Padded  ")).expect("ok").name,
        "Padded"
    );
    // L1: the same id twice is a conflict.
    assert_eq!(create(&f, &new(1, "Again")), Err(DataError::Conflict));
    assert_eq!(names(&f), ["Padded"]);
}

/// TS: "updates name and icon with trim, not_found and invalid_input" (+ L14).
#[test]
fn update_trims_bumps_updated_at_and_reports_not_found() {
    let f = Fixture::create();
    let d = create(&f, &new(1, "Old")).expect("create");
    f.at("2026-03-03T00:00:00.000Z");
    let updated = run(update_dashboard(&f.ctx, &d.id, "  New  ", "home")).expect("update");
    assert_eq!(updated.name, "New");
    assert_eq!(updated.icon, "home");
    assert_eq!(updated.updated_at, "2026-03-03T00:00:00.000Z");
    assert_eq!(updated.created_at, T0);
    assert_eq!(run(get_dashboard(&f.ctx, &d.id)), Ok(Some(updated.clone())));
    assert_eq!(
        run(update_dashboard(&f.ctx, &uid(MISSING), "x", "home")),
        Err(DataError::NotFound)
    );
    assert_eq!(
        run(update_dashboard(&f.ctx, "malformed", "x", "home")),
        Err(DataError::NotFound)
    );
    assert_eq!(
        run(update_dashboard(&f.ctx, &d.id, "   ", "home")),
        Err(DataError::invalid("name"))
    );
    assert_eq!(
        run(update_dashboard(&f.ctx, &d.id, &"x".repeat(101), "home")),
        Err(DataError::invalid("name"))
    );
    for icon in ["", "A", "pi pi-x", &"a".repeat(33)] {
        assert_eq!(
            run(update_dashboard(&f.ctx, &d.id, "x", icon)),
            Err(DataError::invalid("icon")),
            "{icon}"
        );
    }
    assert_eq!(run(get_dashboard(&f.ctx, &d.id)), Ok(Some(updated)));
}

/// TS: "remove cascades to widget instances": the removal itself is `dashboard_delete`
/// (`backup/dashboard_delete.rs`, its own tests); here, the cascade proves `foreign_keys` is on.
#[test]
fn deleting_a_dashboard_cascades_to_its_instances() {
    let f = Fixture::create();
    create(&f, &new(1, "D")).expect("create");
    insert_widgets(&f, 1, 1, 1);
    f.exec("DELETE FROM dashboards");
    assert_eq!(f.scalar("SELECT COUNT(*) FROM widget_instances"), 0);
}

// ---- theme (V5) ----

/// TS: "create without a theme gives {} and version 1; list and get return them".
#[test]
fn theme_defaults_to_empty_object_version_1() {
    let f = Fixture::create();
    let d = create(&f, &new(1, "A")).expect("create");
    assert_eq!((d.theme_json.as_str(), d.theme_version), ("{}", 1));
    assert_eq!(run(list_dashboards(&f.ctx)).expect("list")[0], d);
    assert_eq!(run(get_dashboard(&f.ctx, &d.id)), Ok(Some(d)));
}

/// TS: "create copies the theme and its version as is" (the text is kept byte for byte).
#[test]
fn creation_copies_the_theme_text_as_is() {
    let f = Fixture::create();
    let theme = r#"{"future":{"nested":[1,2]},"cardBody":"rose","n":1.0}"#;
    let input = DashboardNewDto {
        theme_json: Some(theme.to_owned()),
        theme_version: Some(7),
        ..new(1, "A")
    };
    let d = create(&f, &input).expect("create");
    assert_eq!((d.theme_json.as_str(), d.theme_version), (theme, 7));
    assert_eq!(run(get_dashboard(&f.ctx, &d.id)), Ok(Some(d)));
}

/// TS: "createIfNone uses the defaults, or the given theme".
#[test]
fn ensure_default_uses_the_defaults_or_the_given_theme() {
    let f = Fixture::create();
    assert_eq!(
        run(ensure_default_dashboard(&f.ctx, &new(1, "A"))),
        Ok(true)
    );
    let first = run(list_dashboards(&f.ctx)).expect("list").remove(0);
    assert_eq!((first.theme_json.as_str(), first.theme_version), ("{}", 1));
    f.exec("DELETE FROM dashboards");
    let input = DashboardNewDto {
        theme_json: Some(r#"{"cardBody":"sky"}"#.to_owned()),
        theme_version: Some(2),
        ..new(2, "B")
    };
    assert_eq!(run(ensure_default_dashboard(&f.ctx, &input)), Ok(true));
    let second = run(list_dashboards(&f.ctx)).expect("list").remove(0);
    assert_eq!(
        (second.theme_json.as_str(), second.theme_version),
        (r#"{"cardBody":"sky"}"#, 2)
    );
}

/// TS: "updateTheme writes, bumps updated_at and returns the dashboard".
#[test]
fn update_theme_writes_bumps_updated_at_and_returns_the_dashboard() {
    let f = Fixture::create();
    let d = create(&f, &new(1, "A")).expect("create");
    f.at("2026-02-02T00:00:00.000Z");
    let theme = r#"{"cardBody":"rose","cardHeader":"sky"}"#;
    let updated = run(update_dashboard_theme(&f.ctx, &d.id, theme, 1)).expect("update");
    assert_eq!(
        updated,
        DashboardDto {
            theme_json: theme.to_owned(),
            theme_version: 1,
            updated_at: "2026-02-02T00:00:00.000Z".to_owned(),
            ..d.clone()
        }
    );
    assert_eq!(run(get_dashboard(&f.ctx, &d.id)), Ok(Some(updated)));
}

/// TS: "updateTheme: not_found when absent".
#[test]
fn update_theme_is_not_found_when_absent() {
    let f = Fixture::create();
    assert_eq!(
        run(update_dashboard_theme(&f.ctx, &uid(MISSING), "{}", 1)),
        Err(DataError::NotFound)
    );
}

/// TS: "rejects an invalid version or an oversized object, also at creation". The version of
/// the TS test (1.5, NaN) cannot be an `i64`: it is refused by the deserialization (DTO test).
/// M6: both the version and the form are checked in one order (version first), so the `field` of
/// a theme with two defects differs from `validTheme` (shape first); only the kind is observable.
#[test]
fn invalid_version_or_oversized_theme_is_refused_everywhere() {
    let f = Fixture::create();
    let d = create(&f, &new(1, "A")).expect("create");
    let too_long = sized("x", 4097);
    for version in [0, -1, i64::MIN] {
        assert_eq!(
            run(update_dashboard_theme(&f.ctx, &d.id, "{}", version)),
            Err(DataError::invalid("themeVersion")),
            "{version}"
        );
        let input = DashboardNewDto {
            theme_version: Some(version),
            ..new(2, "B")
        };
        assert_eq!(create(&f, &input), Err(DataError::invalid("themeVersion")));
    }
    let beyond_js = 10_001;
    assert_eq!(
        run(update_dashboard_theme(&f.ctx, &d.id, "{}", beyond_js)),
        Err(DataError::invalid("themeVersion"))
    );
    assert_eq!(
        run(update_dashboard_theme(&f.ctx, &d.id, &too_long, 1)),
        Err(DataError::invalid("theme"))
    );
    let input = DashboardNewDto {
        theme_json: Some(too_long.clone()),
        ..new(2, "B")
    };
    assert_eq!(create(&f, &input), Err(DataError::invalid("theme")));
    assert_eq!(
        run(ensure_default_dashboard(&f.ctx, &input)),
        Err(DataError::invalid("theme"))
    );
    // Not an object (TS: `[]`), and nested too deep.
    assert_eq!(
        run(update_dashboard_theme(&f.ctx, &d.id, "[]", 1)),
        Err(DataError::invalid("theme"))
    );
    let deep = format!("{}{}", r#"{"a":"#.repeat(101), "}".repeat(101));
    assert_eq!(
        run(update_dashboard_theme(&f.ctx, &d.id, &deep, 1)),
        Err(DataError::invalid("theme"))
    );
    // Valid shape, invalid JSON: the `CHECK` is the filter.
    assert_eq!(
        run(update_dashboard_theme(&f.ctx, &d.id, "{oops", 1)),
        Err(DataError::Constraint)
    );
    assert_eq!(run(list_dashboards(&f.ctx)), Ok(vec![d]));
}

/// TS: "accepts 4096 code points, including outside the BMP (more than 4096 UTF-16 units)".
#[test]
fn theme_limit_counts_code_points() {
    let f = Fixture::create();
    let d = create(&f, &new(1, "A")).expect("create");
    let bmp = sized("x", 4096);
    assert_eq!(
        run(update_dashboard_theme(&f.ctx, &d.id, &bmp, 1))
            .expect("bmp")
            .theme_json,
        bmp
    );
    let astral = sized("\u{1F600}", 4096);
    assert_eq!(
        run(update_dashboard_theme(&f.ctx, &d.id, &astral, 1))
            .expect("astral")
            .theme_json,
        astral
    );
    let input = DashboardNewDto {
        theme_json: Some(astral.clone()),
        ..new(2, "B")
    };
    assert_eq!(create(&f, &input).expect("created").theme_json, astral);
    assert_eq!(
        run(update_dashboard_theme(
            &f.ctx,
            &d.id,
            &sized("\u{1F600}", 4097),
            1
        )),
        Err(DataError::invalid("theme"))
    );
}

/// TS: "update(name, icon) keeps the theme".
#[test]
fn update_keeps_the_theme() {
    let f = Fixture::create();
    let input = DashboardNewDto {
        theme_json: Some(r#"{"cardBody":"rose"}"#.to_owned()),
        theme_version: Some(3),
        ..new(1, "A")
    };
    let d = create(&f, &input).expect("create");
    let updated = run(update_dashboard(&f.ctx, &d.id, "B", "home")).expect("update");
    assert_eq!(updated.theme_json, r#"{"cardBody":"rose"}"#);
    assert_eq!(updated.theme_version, 3);
}

// ---- T6, T7 ----

/// T6: at most 100 dashboards; the refused creation leaves nothing behind.
#[test]
fn the_101st_dashboard_is_refused() {
    let f = Fixture::create();
    insert_dashboards(&f, MAX_DASHBOARDS);
    assert_eq!(f.scalar("SELECT COUNT(*) FROM dashboards"), MAX_DASHBOARDS);
    assert_eq!(
        create(&f, &new(1000, "one too many")),
        Err(DataError::LimitReached)
    );
    assert_eq!(f.scalar("SELECT COUNT(*) FROM dashboards"), MAX_DASHBOARDS);
    // The id of an existing dashboard is a conflict whatever the count.
    assert_eq!(create(&f, &new(1, "dup")), Err(DataError::Conflict));
}

/// T7: every write is `unavailable` and the database is unchanged; reads work.
#[test]
fn writes_are_unavailable_when_a_restoration_is_staged() {
    let f = Fixture::create();
    let d = create(&f, &new(1, "A")).expect("create");
    insert_widgets(&f, 1, 1, 1);
    let ro = f.read_only();
    assert_eq!(
        run(create_dashboard(&ro, &new(2, "B"))),
        Err(DataError::Unavailable)
    );
    assert_eq!(
        run(ensure_default_dashboard(&ro, &new(2, "B"))),
        Err(DataError::Unavailable)
    );
    assert_eq!(
        run(update_dashboard(&ro, &d.id, "X", "home")),
        Err(DataError::Unavailable)
    );
    assert_eq!(
        run(update_dashboard_theme(&ro, &d.id, "{}", 2)),
        Err(DataError::Unavailable)
    );
    let overflow = overflow_input(2, &d.id, &[(uid(1), grid(0, 0, 2, 2))]);
    assert_eq!(
        run(create_with_widgets(&ro, &overflow)),
        Err(DataError::Unavailable)
    );
    assert_eq!(names(&f), ["A"]);
    assert_eq!(run(get_dashboard(&ro, &d.id)), Ok(Some(d)));
    assert_eq!(run(list_dashboards(&ro)).expect("list").len(), 1);
    assert_eq!(f.text("SELECT dashboard_id FROM widget_instances"), uid(1));
}

// ---- T3: dashboard_create_with_widgets ----

fn grid(x: i64, y: i64, w: i64, h: i64) -> GridDto {
    GridDto { x, y, w, h }
}

fn overflow_input(id: u32, source: &str, items: &[(String, GridDto)]) -> DashboardWithWidgetsDto {
    DashboardWithWidgetsDto {
        dashboard: new(id, "A (next)"),
        source_dashboard_id: source.to_owned(),
        items: items
            .iter()
            .map(|(id, grid)| LayoutItemDto {
                id: id.clone(),
                grid: *grid,
            })
            .collect(),
    }
}

/// `count` widgets of ids `first..first + count` on the dashboard `dashboard`.
fn insert_widgets(f: &Fixture, dashboard: u32, first: u32, count: u32) {
    f.exec(&format!(
        "WITH RECURSIVE n(i) AS (SELECT {first} UNION ALL SELECT i + 1 FROM n WHERE i < {})
         INSERT INTO widget_instances
           (id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h, config, config_version,
            created_at, updated_at)
         SELECT printf('00000000-0000-4000-8000-%012x', i), '{}', 'todo', i % 50, i / 50, 2, 2, '{{}}', 1,
                '{T0}', '{T0}' FROM n",
        first + count - 1,
        uid(dashboard)
    ));
}

fn insert_dashboards(f: &Fixture, count: i64) {
    f.exec(&format!(
        "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < {count})
         INSERT INTO dashboards (id, name, sort_order, created_at, updated_at)
         SELECT printf('00000000-0000-4000-8000-%012x', i), 'D' || i, i, '{T0}', '{T0}' FROM n"
    ));
}

/// TS (`moveToDashboard`): "moves instances with their new rectangles and updated_at", now with
/// the creation of the target in the same transaction; `moved` is exact and the others stay.
#[test]
fn create_with_widgets_creates_the_target_and_moves_the_widgets() {
    let f = Fixture::create();
    let source = create(&f, &new(1, "A")).expect("source");
    insert_widgets(&f, 1, 11, 3);
    f.at("2026-05-05T00:00:00.000Z");
    let input = overflow_input(
        2,
        &source.id,
        &[(uid(11), grid(0, 0, 3, 3)), (uid(12), grid(3, 0, 2, 2))],
    );
    let result = run(create_with_widgets(&f.ctx, &input)).expect("overflow");
    assert_eq!(result.moved, 2);
    assert_eq!(result.dashboard.id, uid(2));
    assert_eq!(result.dashboard.name, "A (next)");
    assert_eq!(result.dashboard.sort_order, 1);
    assert_eq!(result.dashboard.created_at, "2026-05-05T00:00:00.000Z");
    assert_eq!(result.dashboard.updated_at, "2026-05-05T00:00:00.000Z");
    let moved = format!(
        "SELECT dashboard_id || '|' || grid_x || ',' || grid_y || ',' || grid_w || ',' || grid_h || '|' || updated_at \
         FROM widget_instances WHERE id = '{}'",
        uid(11)
    );
    assert_eq!(
        f.text(&moved),
        format!("{}|0,0,3,3|2026-05-05T00:00:00.000Z", uid(2))
    );
    assert_eq!(
        f.text(&format!(
            "SELECT dashboard_id FROM widget_instances WHERE id = '{}'",
            uid(12)
        )),
        uid(2)
    );
    // The widget that was not listed stays where it was, untouched.
    assert_eq!(
        f.text(&format!(
            "SELECT dashboard_id || updated_at FROM widget_instances WHERE id = '{}'",
            uid(13)
        )),
        format!("{}{T0}", uid(1))
    );
    // No deletion happened: both dashboards exist.
    assert_eq!(names(&f), ["A", "A (next)"]);
}

#[test]
fn the_result_serializes_in_camel_case() {
    let f = Fixture::create();
    let source = create(&f, &new(1, "A")).expect("source");
    insert_widgets(&f, 1, 11, 1);
    let input = overflow_input(2, &source.id, &[(uid(11), grid(0, 0, 2, 2))]);
    let result: DashboardWithWidgetsResult =
        run(create_with_widgets(&f.ctx, &input)).expect("overflow");
    let json = serde_json::to_value(&result).expect("json");
    assert_eq!(json["moved"], 1);
    assert_eq!(json["dashboard"]["sortOrder"], 1);
    assert_eq!(json["dashboard"]["themeJson"], "{}");
    assert_eq!(json["dashboard"]["createdAt"], T0);
}

/// TS: "refuses a missing target dashboard ..." is replaced by T3: widgets of another dashboard
/// (stale front state) are not moved, the transaction is cancelled and no dashboard is created.
#[test]
fn create_with_widgets_conflicts_on_stale_ids_and_creates_nothing() {
    let f = Fixture::create();
    let source = create(&f, &new(1, "A")).expect("source");
    let other = create(&f, &new(2, "B")).expect("other");
    insert_widgets(&f, 2, 21, 2);
    // Widgets of `other`, claimed as coming from `source`; an unknown id too.
    let input = overflow_input(
        3,
        &source.id,
        &[
            (uid(21), grid(0, 0, 2, 2)),
            (uid(MISSING), grid(2, 0, 2, 2)),
        ],
    );
    assert_eq!(
        run(create_with_widgets(&f.ctx, &input)),
        Err(DataError::Conflict)
    );
    assert_eq!(names(&f), ["A", "B"]);
    assert_eq!(
        f.text(&format!(
            "SELECT dashboard_id FROM widget_instances WHERE id = '{}'",
            uid(21)
        )),
        other.id
    );
}

/// Only the instances of the source move: one valid and one stale id give `moved = 1`.
#[test]
fn create_with_widgets_counts_only_the_moved_rows() {
    let f = Fixture::create();
    let source = create(&f, &new(1, "A")).expect("source");
    insert_widgets(&f, 1, 11, 1);
    let input = overflow_input(
        2,
        &source.id,
        &[
            (uid(11), grid(0, 0, 2, 2)),
            (uid(MISSING), grid(2, 0, 2, 2)),
        ],
    );
    let result = run(create_with_widgets(&f.ctx, &input)).expect("overflow");
    assert_eq!(result.moved, 1);
}

/// Atomicity (4.11): a payload the validation would have refused (width 0) reaches the `CHECK`;
/// nothing is created and no widget moves.
#[test]
fn create_with_widgets_is_atomic_when_a_row_violates_a_check() {
    let f = Fixture::create();
    let source = create(&f, &new(1, "A")).expect("source");
    insert_widgets(&f, 1, 11, 3);
    let payload = format!(
        r#"[{{"id":"{}","x":5,"y":5,"w":1,"h":1}},{{"id":"{}","x":6,"y":6,"w":0,"h":1}},{{"id":"{}","x":7,"y":7,"w":1,"h":1}}]"#,
        uid(11),
        uid(12),
        uid(13)
    );
    assert_eq!(
        run(create_with_widgets_unchecked(
            &f.ctx,
            &new(2, "A (next)"),
            &source.id,
            &payload
        )),
        Err(DataError::Constraint)
    );
    assert_eq!(names(&f), ["A"]);
    assert_eq!(
        f.scalar(&format!(
            "SELECT COUNT(*) FROM widget_instances WHERE dashboard_id = '{}'",
            uid(1)
        )),
        3
    );
    assert_eq!(
        f.scalar("SELECT COUNT(*) FROM widget_instances WHERE grid_y >= 5"),
        0
    );
}

/// TS: "rejects duplicate ids and invalid rectangles with invalid_input before any query"
/// (checked before the disk: the database file does not exist).
#[test]
fn create_with_widgets_rejects_bad_input_before_the_disk() {
    let f = Fixture::create();
    let ctx = f.without_disk();
    let src = uid(1);
    let ok = grid(0, 0, 2, 2);
    let check = |input: DashboardWithWidgetsDto, field: &str| {
        assert_eq!(
            run(create_with_widgets(&ctx, &input)),
            Err(DataError::invalid(field)),
            "{field}"
        );
    };
    // Empty batch: unlike the old `moveToDashboard`, nothing to move is an error.
    check(overflow_input(2, &src, &[]), "items");
    check(
        overflow_input(2, &src, &[(uid(11), ok), (uid(11), grid(1, 1, 2, 2))]),
        "items",
    );
    check(
        overflow_input(2, &src, &[(uid(11), grid(1, 1, 0, 1))]),
        "grid",
    );
    check(
        overflow_input(2, &src, &[(uid(11), grid(10_001, 0, 1, 1))]),
        "grid",
    );
    check(
        overflow_input(2, "not a uuid", &[(uid(11), ok)]),
        "sourceDashboardId",
    );
    let many: Vec<(String, GridDto)> = (1..=201).map(|i| (uid(i), ok)).collect();
    check(overflow_input(2, &src, &many), "items");
    // The new dashboard is checked like `dashboard_create` (id, name, icon, theme).
    let mut bad_name = overflow_input(2, &src, &[(uid(11), ok)]);
    bad_name.dashboard.name = " ".to_owned();
    check(bad_name, "name");
    let mut bad_id = overflow_input(2, &src, &[(uid(11), ok)]);
    bad_id.dashboard.id = "x".to_owned();
    check(bad_id, "id");
    // 200 items are fine up to the disk.
    let max: Vec<(String, GridDto)> = (1..=200).map(|i| (uid(i), ok)).collect();
    assert_eq!(
        run(create_with_widgets(&ctx, &overflow_input(2, &src, &max))),
        Err(DataError::Unavailable)
    );
}

/// L4: overflow while 100 dashboards exist: nothing is created, nothing moves.
#[test]
fn create_with_widgets_respects_the_dashboard_limit() {
    let f = Fixture::create();
    insert_dashboards(&f, MAX_DASHBOARDS);
    insert_widgets(&f, 1, 5000, 1);
    let input = overflow_input(1000, &uid(1), &[(uid(5000), grid(0, 0, 2, 2))]);
    assert_eq!(
        run(create_with_widgets(&f.ctx, &input)),
        Err(DataError::LimitReached)
    );
    assert_eq!(f.scalar("SELECT COUNT(*) FROM dashboards"), MAX_DASHBOARDS);
    assert_eq!(
        f.text(&format!(
            "SELECT dashboard_id FROM widget_instances WHERE id = '{}'",
            uid(5000)
        )),
        uid(1)
    );
}

// ---- DTO ----

#[test]
fn dashboard_dto_is_camel_case_and_inputs_refuse_unknown_fields() {
    let d = DashboardDto {
        id: "i".to_owned(),
        name: "n".to_owned(),
        sort_order: 2,
        icon: "home".to_owned(),
        theme_json: "{}".to_owned(),
        theme_version: 1,
        created_at: "c".to_owned(),
        updated_at: "u".to_owned(),
    };
    assert_eq!(
        serde_json::to_string(&d).expect("json"),
        r#"{"id":"i","name":"n","sortOrder":2,"icon":"home","themeJson":"{}","themeVersion":1,"createdAt":"c","updatedAt":"u"}"#
    );
    let ok = serde_json::json!({ "id": uid(1), "name": "n", "icon": null, "themeJson": null, "themeVersion": null });
    let parsed: DashboardNewDto = serde_json::from_value(ok.clone()).expect("dto");
    assert_eq!(parsed.icon, None);
    let minimal = serde_json::json!({ "id": uid(1), "name": "n" });
    assert!(serde_json::from_value::<DashboardNewDto>(minimal).is_ok());
    let mut unknown = ok.clone();
    unknown["extra"] = serde_json::json!(1);
    assert!(serde_json::from_value::<DashboardNewDto>(unknown).is_err());
    // A non-integer theme version cannot be deserialized (S2: `invalid args`).
    let mut fractional = ok;
    fractional["themeVersion"] = serde_json::json!(1.5);
    assert!(serde_json::from_value::<DashboardNewDto>(fractional).is_err());
    let with_widgets = serde_json::json!({
        "dashboard": { "id": uid(1), "name": "n" },
        "sourceDashboardId": uid(2),
        "items": [{ "id": uid(3), "grid": { "x": 0, "y": 0, "w": 1, "h": 1 } }]
    });
    assert!(serde_json::from_value::<DashboardWithWidgetsDto>(with_widgets.clone()).is_ok());
    let mut extra = with_widgets.clone();
    extra["items"][0]["grid"]["z"] = serde_json::json!(1);
    assert!(serde_json::from_value::<DashboardWithWidgetsDto>(extra).is_err());
    let mut extra = with_widgets.clone();
    extra["items"][0]["extra"] = serde_json::json!(1);
    assert!(serde_json::from_value::<DashboardWithWidgetsDto>(extra).is_err());
    let mut extra = with_widgets;
    extra["unknown"] = serde_json::json!(1);
    assert!(serde_json::from_value::<DashboardWithWidgetsDto>(extra).is_err());
}

/// P4 (CA-TC2-6): no production source outside `backup/dashboard_delete.rs` and
/// `backup/config_transfer.rs` deletes from `dashboards` (any case, any spacing).
#[test]
fn only_the_backup_modules_delete_dashboards() {
    fn walk(dir: &std::path::Path, found: &mut Vec<String>) {
        for entry in std::fs::read_dir(dir).expect("dir") {
            let path = entry.expect("entry").path();
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default();
            if path.is_dir() {
                if name != "tests" {
                    walk(&path, found);
                }
                continue;
            }
            let allowed = path.ends_with("backup/dashboard_delete.rs")
                || path.ends_with("backup/config_transfer.rs");
            if !name.ends_with(".rs") || name.ends_with("_tests.rs") || allowed {
                continue;
            }
            let text = std::fs::read_to_string(&path)
                .expect("source")
                .to_lowercase();
            let words: Vec<&str> = text.split_whitespace().collect();
            if words
                .windows(3)
                .any(|w| w[0] == "delete" && w[1] == "from" && w[2].starts_with("dashboards"))
            {
                found.push(path.display().to_string());
            }
        }
    }
    let mut found = Vec::new();
    walk(
        &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
        &mut found,
    );
    assert!(found.is_empty(), "{found:?}");
}

/// T6: the theme version stops at 10 000, like the import.
#[test]
fn theme_version_is_bounded_to_10_000() {
    let f = Fixture::create();
    let d = create(&f, &new(1, "A")).expect("create");
    assert_eq!(
        run(update_dashboard_theme(&f.ctx, &d.id, "{}", 10_001)),
        Err(DataError::invalid("themeVersion"))
    );
    let top = run(update_dashboard_theme(&f.ctx, &d.id, "{}", 10_000)).expect("10 000");
    assert_eq!(top.theme_version, 10_000);
}

/// A well formed source id that designates nothing moves nothing: `Conflict`, no dashboard.
#[test]
fn create_with_widgets_with_an_unknown_source_is_a_conflict() {
    let f = Fixture::create();
    let input = overflow_input(2, &uid(MISSING), &[(uid(11), grid(0, 0, 2, 2))]);
    assert_eq!(
        run(create_with_widgets(&f.ctx, &input)),
        Err(DataError::Conflict)
    );
    assert_eq!(f.scalar("SELECT COUNT(*) FROM dashboards"), 0);
}

/// `BEGIN IMMEDIATE` serializes the count and the insert: at 99 dashboards, two concurrent
/// creations give exactly one success and 100 dashboards.
#[test]
fn two_concurrent_creations_at_99_dashboards_give_one_success() {
    let f = Fixture::create();
    insert_dashboards(&f, MAX_DASHBOARDS - 1);
    let (a, b) = (new(1000, "X"), new(1001, "Y"));
    let (ra, rb) = std::thread::scope(|s| {
        let ha = s.spawn(|| create(&f, &a));
        let hb = s.spawn(|| create(&f, &b));
        (ha.join().expect("a"), hb.join().expect("b"))
    });
    let results = [ra, rb];
    assert_eq!(
        results.iter().filter(|r| r.is_ok()).count(),
        1,
        "{results:?}"
    );
    assert!(
        results.contains(&Err(DataError::LimitReached)),
        "{results:?}"
    );
    assert_eq!(f.scalar("SELECT COUNT(*) FROM dashboards"), MAX_DASHBOARDS);
}
