use super::config_transfer::*;
use super::error::{BackupError, ImportProblem};
use super::paths::DataRoot;
use super::test_support::{make_database, run};
use crate::time::clock::FixedClock;
use crate::time::formats::parse_instant;
use serde_json::json;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, Row, SqliteConnection};
use std::fs;
use std::time::Duration;
use tempfile::TempDir;

const D1: &str = "3f0c2a5e-8f0b-4c55-9a43-0d2a1d6c9b11";
const D2: &str = "4a1d3b6f-9a1c-4d66-8b54-1e3b2e7d0c22";
const D3: &str = "5b2e4c70-ab2d-4e77-9c65-2f4c3f8e1d33";
const W1: &str = "6c3f5d81-bc3e-4f88-8d76-305d4a9f2e44";
const W2: &str = "7d406e92-cd4f-4099-9e87-416e5bad3f55";
const W3: &str = "8e517fa3-de50-41aa-8f98-527f6cbe4066";
const AT: &str = "2026-10-20T08:00:00.000Z";

fn clock() -> FixedClock {
    FixedClock::new(parse_instant("2026-10-22T09:30:00.500Z").expect("instant"))
}

fn widget(id: &str, kind: &str) -> serde_json::Value {
    json!({"id": id, "widgetType": kind, "grid": {"x": 0, "y": 1, "w": 4, "h": 2},
           "config": "{\"a\":1}", "configVersion": 1})
}

fn plan(value: serde_json::Value) -> ConfigImportPlan {
    serde_json::from_value(value).expect("plan")
}

fn base_plan() -> ConfigImportPlan {
    plan(json!({
        "dashboards": [{"id": D1, "name": "Home", "sortOrder": 0, "widgets": [widget(W1, "notes")]}],
        "settings": []
    }))
}

fn db_conn(root: &DataRoot) -> SqliteConnection {
    let options = SqliteConnectOptions::new().filename(root.db());
    run(SqliteConnection::connect_with(&options)).expect("connect")
}

fn exec(conn: &mut SqliteConnection, sql: &str, binds: &[&str]) {
    let mut q = sqlx::query(sql);
    for b in binds {
        q = q.bind(*b);
    }
    run(q.execute(conn)).expect(sql);
}

fn count(conn: &mut SqliteConnection, table: &str) -> i64 {
    let sql = format!("SELECT COUNT(*) FROM {table}");
    run(sqlx::query(&sql).fetch_one(conn))
        .expect("count")
        .get(0)
}

/// Dashboards D1 (Home) and D2; widgets W1 (notes, D1, with a note) and W2 (todo, D2, with a list
/// and a task); setting `theme`.
fn seeded() -> (TempDir, DataRoot) {
    let dir = TempDir::new().expect("tmp");
    let root = DataRoot::new(dir.path().to_path_buf());
    make_database(&root.db(), 3, true);
    let mut c = db_conn(&root);
    exec(
        &mut c,
        "INSERT INTO dashboards VALUES (?1, 'Second', 1, ?2, ?2)",
        &[D2, AT],
    );
    let w = "INSERT INTO widget_instances VALUES (?1, ?2, ?3, 0, 0, 3, 3, '{}', 1, ?4, ?4)";
    exec(&mut c, w, &[W1, D1, "notes", AT]);
    exec(&mut c, w, &[W2, D2, "todo", AT]);
    exec(&mut c, "INSERT INTO notes VALUES ('a0000000-0000-4000-8000-000000000001', ?1, 'T', 'body', ?2, ?2)", &[W1, AT]);
    exec(
        &mut c,
        "INSERT INTO todo_lists VALUES ('a0000000-0000-4000-8000-000000000002', ?1, 'L', ?2, ?2)",
        &[W2, AT],
    );
    exec(&mut c, "INSERT INTO todos VALUES ('a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002', 'x', NULL, NULL, 0, ?1, ?1)", &[AT]);
    run(c.close()).expect("close");
    (dir, root)
}

fn apply(root: &DataRoot, p: &ConfigImportPlan) -> Result<ImportOutcome, BackupError> {
    run(apply_config_import(root, &clock(), p))
}

fn problem_of(r: Result<impl std::fmt::Debug, BackupError>) -> ImportProblem {
    match r {
        Err(BackupError::InvalidImport { problem }) => problem,
        other => panic!("unexpected {other:?}"),
    }
}

fn pre_import_archives(root: &DataRoot) -> Vec<String> {
    match fs::read_dir(root.backups()) {
        Ok(rd) => rd
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with("-pre-import.zip"))
            .collect(),
        Err(_) => Vec::new(),
    }
}

// ---- validate_plan ----

fn invalid(value: serde_json::Value) -> ImportProblem {
    problem_of(validate_plan(&plan(value)))
}

fn one_dashboard(d: serde_json::Value) -> serde_json::Value {
    json!({"dashboards": [d], "settings": []})
}

fn dash(mutate: impl FnOnce(&mut serde_json::Value)) -> serde_json::Value {
    let mut d = json!({"id": D1, "name": "Home", "sortOrder": 0, "widgets": [widget(W1, "notes")]});
    mutate(&mut d);
    one_dashboard(d)
}

fn with_widget(mutate: impl FnOnce(&mut serde_json::Value)) -> serde_json::Value {
    dash(|d| mutate(&mut d["widgets"][0]))
}

#[test]
fn valid_plan_is_accepted() {
    validate_plan(&base_plan()).expect("valid");
}

#[test]
fn structural_problems() {
    use ImportProblem::*;
    assert_eq!(
        invalid(json!({"dashboards": [], "settings": []})),
        NoDashboard
    );
    let many: Vec<_> = (0..101)
        .map(|i| json!({"id": format!("3f0c2a5e-8f0b-4c55-9a43-{i:012x}"), "name": "d", "sortOrder": 0, "widgets": []}))
        .collect();
    assert_eq!(
        invalid(json!({"dashboards": many, "settings": []})),
        TooManyDashboards
    );
    let too_many_in_one: Vec<_> = (0..201)
        .map(|i| widget(&format!("6c3f5d81-bc3e-4f88-8d76-{i:012x}"), "notes"))
        .collect();
    assert_eq!(
        invalid(dash(|d| d["widgets"] = json!(too_many_in_one))),
        TooManyWidgets
    );
    // 6 dashboards of 200 widgets: each below the per-dashboard cap, 1200 in total.
    let dashboards: Vec<_> = (0..6)
        .map(|d| {
            let widgets: Vec<_> = (0..200)
                .map(|i| widget(&format!("6c3f5d81-bc3e-4f88-{d:04x}-{i:012x}"), "notes"))
                .collect();
            json!({"id": format!("3f0c2a5e-8f0b-4c55-9a43-{d:012x}"), "name": "d", "sortOrder": 0, "widgets": widgets})
        })
        .collect();
    assert_eq!(
        invalid(json!({"dashboards": dashboards, "settings": []})),
        TooManyWidgets
    );
    let settings: Vec<_> = (0..201)
        .map(|i| json!({"key": format!("k{i}"), "value": "1"}))
        .collect();
    assert_eq!(
        invalid(json!({"dashboards": base_dashboards(), "settings": settings})),
        TooManySettings
    );

    assert_eq!(invalid(dash(|d| d["id"] = json!("ABC"))), InvalidId);
    assert_eq!(
        invalid(dash(|d| d["id"] = json!(D1.to_uppercase()))),
        InvalidId
    );
    assert_eq!(invalid(with_widget(|w| w["id"] = json!("nope"))), InvalidId);
    let dup_dash = json!({"dashboards": [
        {"id": D1, "name": "a", "sortOrder": 0, "widgets": []},
        {"id": D1, "name": "b", "sortOrder": 1, "widgets": []}], "settings": []});
    assert_eq!(invalid(dup_dash), DuplicateId);
    let dup_widget = json!({"dashboards": [
        {"id": D1, "name": "a", "sortOrder": 0, "widgets": [widget(W1, "x")]},
        {"id": D2, "name": "b", "sortOrder": 1, "widgets": [widget(W1, "x")]}], "settings": []});
    assert_eq!(invalid(dup_widget), DuplicateId);
    let dup_setting = json!({"dashboards": base_dashboards(), "settings": [
        {"key": "a", "value": "1"}, {"key": "a", "value": "2"}]});
    assert_eq!(invalid(dup_setting), DuplicateId);

    assert_eq!(invalid(dash(|d| d["name"] = json!(""))), InvalidName);
    assert_eq!(invalid(dash(|d| d["name"] = json!("   "))), InvalidName);
    assert_eq!(
        invalid(dash(|d| d["name"] = json!(" Accueil"))),
        InvalidName
    );
    assert_eq!(
        invalid(dash(|d| d["name"] = json!("Accueil\u{0085}"))),
        InvalidName
    );
    assert_eq!(
        invalid(dash(|d| d["name"] = json!("\u{FEFF}Accueil"))),
        InvalidName
    );
    assert_eq!(
        invalid(dash(|d| d["sortOrder"] = json!(-1))),
        InvalidSortOrder
    );
    assert_eq!(
        invalid(dash(|d| d["sortOrder"] = json!(1_000_001))),
        InvalidSortOrder
    );

    assert_eq!(
        invalid(with_widget(|w| w["widgetType"] = json!(""))),
        InvalidWidgetType
    );
    assert_eq!(
        invalid(with_widget(|w| w["widgetType"] = json!("x".repeat(65)))),
        InvalidWidgetType
    );
    for (field, value) in [("x", -1), ("y", 10_001), ("w", 0), ("h", 0), ("w", 10_001)] {
        assert_eq!(
            invalid(with_widget(|w| w["grid"][field] = json!(value))),
            InvalidGrid,
            "{field}"
        );
    }
    assert_eq!(
        invalid(with_widget(|w| w["configVersion"] = json!(0))),
        InvalidConfigVersion
    );
    assert_eq!(
        invalid(with_widget(|w| w["configVersion"] = json!(10_001))),
        InvalidConfigVersion
    );
    for bad in ["[]", "1", "\"s\"", "null", "not json", "", "{\"a\":"] {
        assert_eq!(
            invalid(with_widget(|w| w["config"] = json!(bad))),
            InvalidConfig,
            "{bad}"
        );
    }
    let big = format!("{{\"a\":\"{}\"}}", "x".repeat(65_540));
    assert_eq!(
        invalid(with_widget(|w| w["config"] = json!(big))),
        InvalidConfig
    );

    let setting = |k: &str, v: &str| json!({"dashboards": base_dashboards(), "settings": [{"key": k, "value": v}]});
    for key in [
        "",
        "Theme",
        "1a",
        "_a",
        "a b",
        "a/b",
        "__proto__",
        "é",
        &"a".repeat(129),
    ] {
        assert_eq!(invalid(setting(key, "1")), InvalidSettingKey, "{key:?}");
    }
    assert_eq!(invalid(setting("a", "{")), InvalidSettingValue);
    assert_eq!(invalid(setting("a", "")), InvalidSettingValue);
    let big_value = format!("\"{}\"", "x".repeat(65_536));
    assert_eq!(invalid(setting("a", &big_value)), InvalidSettingValue);
}

fn base_dashboards() -> serde_json::Value {
    json!([{"id": D1, "name": "Home", "sortOrder": 0, "widgets": []}])
}

#[test]
fn secret_keys_are_refused_whatever_the_case() {
    for key in [
        "token",
        "github.token",
        "password",
        "passwd",
        "my-secret",
        "credentials",
        "apikey",
        "apiKey",
        "api_key",
        "api-key",
        "api.key",
        "API_KEY",
        "Hypixel.ApiKey",
    ] {
        assert!(is_secret_setting_key(key), "{key}");
        let p = plan(
            json!({"dashboards": base_dashboards(), "settings": [{"key": key, "value": "1"}]}),
        );
        assert_eq!(
            problem_of(validate_plan(&p)),
            ImportProblem::SecretSetting,
            "{key}"
        );
    }
    for key in ["theme", "locale", "api", "key"] {
        assert!(!is_secret_setting_key(key), "{key}");
    }
}

#[test]
fn code_points_and_hb_trim_limits() {
    let name = |n: String| dash(|d| d["name"] = json!(n));
    validate_plan(&plan(name("\u{1F600}".repeat(100)))).expect("100 emoji");
    assert_eq!(
        invalid(name("\u{1F600}".repeat(101))),
        ImportProblem::InvalidName
    );
    validate_plan(&plan(name("é".repeat(100)))).expect("100 accents");
    assert_eq!(invalid(name("é".repeat(101))), ImportProblem::InvalidName);
    let kind = |n: String| with_widget(|w| w["widgetType"] = json!(n));
    validate_plan(&plan(kind("\u{1F600}".repeat(64)))).expect("64 emoji");
    assert_eq!(
        invalid(kind("\u{1F600}".repeat(65))),
        ImportProblem::InvalidWidgetType
    );
    // Inner spaces are fine, only the edges count.
    validate_plan(&plan(name("a b\u{00A0}c".into()))).expect("inner");
    let setting_value = format!("\"{}\"", "\u{1F600}".repeat(65_534));
    validate_plan(&plan(json!({"dashboards": base_dashboards(), "settings": [{"key": "a", "value": setting_value}]})))
        .expect("65536 code points");
}

#[test]
fn unknown_and_missing_fields_do_not_deserialize() {
    let good = r#"{"dashboards":[],"settings":[]}"#;
    assert!(serde_json::from_str::<ConfigImportPlan>(good).is_ok());
    for bad in [
        r#"{"dashboards":[],"settings":[],"extra":1}"#,
        r#"{"dashboards":[]}"#,
        r#"{"settings":[]}"#,
        r#"{"dashboards":[],"settings":[],"__proto__":{}}"#,
        r#"{"dashboards":[{"id":"x","name":"n","sortOrder":0,"widgets":[],"__proto__":1}],"settings":[]}"#,
        r#"{"dashboards":[{"id":"x","name":"n","sortOrder":0}],"settings":[]}"#,
        r#"{"dashboards":[],"settings":[{"key":"a","value":"1","x":1}]}"#,
        r#"{"dashboards":[{"id":"x","name":"n","sortOrder":0,"widgets":[{"id":"x","widgetType":"t","grid":{"x":0,"y":0,"w":1,"h":1,"z":1},"config":"{}","configVersion":1}]}],"settings":[]}"#,
    ] {
        assert!(
            serde_json::from_str::<ConfigImportPlan>(bad).is_err(),
            "{bad}"
        );
    }
}

// ---- apply_config_import ----

#[test]
fn identical_reimport_keeps_notes_and_created_at() {
    let (_dir, root) = seeded();
    let p = plan(json!({
        "dashboards": [
            {"id": D1, "name": "Home", "sortOrder": 0, "widgets": [widget(W1, "notes")]},
            {"id": D2, "name": "Second", "sortOrder": 1, "widgets": [widget(W2, "todo")]}],
        "settings": [{"key": "theme", "value": "\"dark\""}]
    }));
    let out = apply(&root, &p).expect("apply");
    assert_eq!(
        out,
        ImportOutcome {
            dashboards: 2,
            widgets: 2,
            settings: 1
        }
    );
    let mut c = db_conn(&root);
    assert_eq!(count(&mut c, "notes"), 1);
    assert_eq!(count(&mut c, "todo_lists"), 1);
    assert_eq!(count(&mut c, "todos"), 1);
    let row = run(sqlx::query(
        "SELECT created_at, updated_at, grid_w, config FROM widget_instances WHERE id = ?1",
    )
    .bind(W1)
    .fetch_one(&mut c))
    .expect("row");
    assert_eq!(row.get::<String, _>(0), AT);
    assert_eq!(row.get::<String, _>(1), "2026-10-22T09:30:00.500Z");
    assert_eq!(row.get::<i64, _>(2), 4);
    assert_eq!(row.get::<String, _>(3), "{\"a\":1}");
    let row = run(
        sqlx::query("SELECT created_at FROM dashboards WHERE id = ?1")
            .bind(D1)
            .fetch_one(&mut c),
    )
    .expect("row");
    assert_eq!(row.get::<String, _>(0), "2026-10-21T08:15:00.123Z");
    run(c.close()).expect("close");
}

#[test]
fn absent_widget_is_deleted_with_its_note() {
    let (_dir, root) = seeded();
    let p = plan(json!({
        "dashboards": [
            {"id": D1, "name": "Home", "sortOrder": 0, "widgets": []},
            {"id": D2, "name": "Second", "sortOrder": 1, "widgets": [widget(W2, "todo")]}],
        "settings": []
    }));
    let out = apply(&root, &p).expect("apply");
    assert_eq!(
        out,
        ImportOutcome {
            dashboards: 2,
            widgets: 1,
            settings: 0
        }
    );
    let mut c = db_conn(&root);
    assert_eq!(count(&mut c, "widget_instances"), 1);
    assert_eq!(count(&mut c, "notes"), 0);
    assert_eq!(count(&mut c, "todo_lists"), 1);
    run(c.close()).expect("close");
}

#[test]
fn absent_dashboard_is_deleted_with_its_widgets_and_data() {
    let (_dir, root) = seeded();
    let out = apply(&root, &base_plan()).expect("apply");
    assert_eq!(
        out,
        ImportOutcome {
            dashboards: 1,
            widgets: 1,
            settings: 0
        }
    );
    let mut c = db_conn(&root);
    assert_eq!(count(&mut c, "dashboards"), 1);
    assert_eq!(count(&mut c, "widget_instances"), 1);
    assert_eq!(count(&mut c, "notes"), 1);
    assert_eq!(count(&mut c, "todo_lists"), 0);
    assert_eq!(count(&mut c, "todos"), 0);
    run(c.close()).expect("close");
}

#[test]
fn instance_moved_out_of_a_deleted_dashboard_keeps_its_data() {
    let (_dir, root) = seeded();
    // D2 disappears, but its widget W2 (todo list + task) moves to D1.
    let p = plan(json!({
        "dashboards": [{"id": D1, "name": "Home", "sortOrder": 0,
                        "widgets": [widget(W1, "notes"), widget(W2, "todo")]}],
        "settings": []
    }));
    apply(&root, &p).expect("apply");
    let mut c = db_conn(&root);
    assert_eq!(count(&mut c, "dashboards"), 1);
    assert_eq!(count(&mut c, "widget_instances"), 2);
    assert_eq!(count(&mut c, "notes"), 1);
    assert_eq!(count(&mut c, "todo_lists"), 1);
    assert_eq!(count(&mut c, "todos"), 1);
    let row = run(
        sqlx::query("SELECT dashboard_id FROM widget_instances WHERE id = ?1")
            .bind(W2)
            .fetch_one(&mut c),
    )
    .expect("row");
    assert_eq!(row.get::<String, _>(0), D1);
    run(c.close()).expect("close");
}

#[test]
fn type_change_recreates_the_instance_and_drops_its_note() {
    let (_dir, root) = seeded();
    let p = plan(json!({
        "dashboards": [
            {"id": D1, "name": "Home", "sortOrder": 0, "widgets": [widget(W1, "clock")]},
            {"id": D2, "name": "Second", "sortOrder": 1, "widgets": [widget(W2, "todo")]}],
        "settings": []
    }));
    apply(&root, &p).expect("apply");
    let mut c = db_conn(&root);
    assert_eq!(count(&mut c, "notes"), 0);
    assert_eq!(count(&mut c, "todo_lists"), 1);
    let row = run(sqlx::query(
        "SELECT widget_type, created_at FROM widget_instances WHERE id = ?1",
    )
    .bind(W1)
    .fetch_one(&mut c))
    .expect("row");
    assert_eq!(row.get::<String, _>(0), "clock");
    assert_eq!(row.get::<String, _>(1), "2026-10-22T09:30:00.500Z");
    run(c.close()).expect("close");
}

#[test]
fn new_dashboard_and_widget_are_created() {
    let (_dir, root) = seeded();
    let p = plan(json!({
        "dashboards": [
            {"id": D1, "name": "Home", "sortOrder": 0, "widgets": [widget(W1, "notes")]},
            {"id": D3, "name": "Neuf", "sortOrder": 2, "widgets": [widget(W3, "clock")]}],
        "settings": []
    }));
    let out = apply(&root, &p).expect("apply");
    assert_eq!(
        out,
        ImportOutcome {
            dashboards: 2,
            widgets: 2,
            settings: 0
        }
    );
    let mut c = db_conn(&root);
    assert_eq!(count(&mut c, "dashboards"), 2);
    run(c.close()).expect("close");
}

#[test]
fn settings_are_merged() {
    let (_dir, root) = seeded();
    let mut p = base_plan();
    p.settings = vec![
        PlanSetting {
            key: "locale".into(),
            value: "\"fr\"".into(),
        },
        PlanSetting {
            key: "theme".into(),
            value: "\"light\"".into(),
        },
    ];
    let mut c = db_conn(&root);
    exec(
        &mut c,
        "INSERT INTO settings VALUES ('keep.me', '1', ?1, ?1)",
        &[AT],
    );
    run(c.close()).expect("close");
    let out = apply(&root, &p).expect("apply");
    assert_eq!(out.settings, 2);
    let mut c = db_conn(&root);
    assert_eq!(count(&mut c, "settings"), 3);
    let row = run(
        sqlx::query("SELECT value, created_at FROM settings WHERE key = 'theme'").fetch_one(&mut c),
    )
    .expect("row");
    assert_eq!(row.get::<String, _>(0), "\"light\"");
    assert_eq!(row.get::<String, _>(1), "2026-10-21T08:15:00.123Z");
    run(c.close()).expect("close");
}

/// Snapshot of every table, to compare before and after.
fn dump(root: &DataRoot) -> Vec<String> {
    let mut c = db_conn(root);
    let mut out = Vec::new();
    for (table, order) in [
        ("settings", "key"),
        ("dashboards", "id"),
        ("widget_instances", "id"),
        ("notes", "id"),
        ("todo_lists", "id"),
        ("todos", "id"),
    ] {
        let cols: Vec<String> = run(sqlx::query(
            "SELECT name FROM pragma_table_info(?1) ORDER BY cid",
        )
        .bind(table)
        .fetch_all(&mut c))
        .expect("columns")
        .iter()
        .map(|r| r.get::<String, _>(0))
        .collect();
        let sql = format!(
            "SELECT json_group_array(json_array({})) FROM (SELECT * FROM {table} ORDER BY {order})",
            cols.join(", ")
        );
        let row = run(sqlx::query(&sql).fetch_one(&mut c)).expect("dump");
        out.push(format!("{table}:{}", row.get::<String, _>(0)));
    }
    run(c.close()).expect("close");
    out
}

#[test]
fn failure_in_the_middle_changes_nothing() {
    let (_dir, root) = seeded();
    let before = dump(&root);
    // The third instance has w = 0: it passes `write_plan` (validation bypassed) and hits the CHECK.
    let mut bad = widget("b0000000-0000-4000-8000-000000000003", "clock");
    bad["grid"]["w"] = json!(0);
    let p = plan(json!({
        "dashboards": [{"id": D1, "name": "Renamed", "sortOrder": 5, "widgets": [
            widget(W1, "clock"), widget("b0000000-0000-4000-8000-000000000002", "clock"), bad]}],
        "settings": [{"key": "theme", "value": "\"light\""}]
    }));
    let err = run(write_plan(
        &root.db(),
        &p,
        "2026-10-22T09:30:00.500Z",
        Duration::from_secs(1),
    ))
    .expect_err("must fail");
    assert_eq!(
        err,
        BackupError::InvalidImport {
            problem: ImportProblem::Constraint
        }
    );
    assert_eq!(dump(&root), before);
    // And through the full path, validation refuses w = 0 before any write.
    assert_eq!(problem_of(apply(&root, &p)), ImportProblem::InvalidGrid);
    assert_eq!(dump(&root), before);
}

#[test]
fn pre_import_backup_holds_the_database_only_and_precedes_the_write() {
    let (_dir, root) = seeded();
    let before = dump(&root);
    apply(&root, &base_plan()).expect("apply");
    let names = pre_import_archives(&root);
    assert_eq!(names.len(), 1, "{names:?}");
    assert!(names[0].starts_with("homebase-20261022T093000.500Z"));
    let mut zip =
        zip::ZipArchive::new(fs::File::open(root.backups().join(&names[0])).expect("open"))
            .expect("zip");
    let mut entries: Vec<String> = (0..zip.len())
        .map(|i| String::from_utf8(zip.by_index(i).expect("e").name_raw().to_vec()).expect("utf-8"))
        .collect();
    entries.sort();
    assert_eq!(entries, ["homebase.db", "manifest.json"]);
    // Extract the database and compare it with the state before the import.
    let extracted = root.path().join("extracted.db");
    {
        let mut entry = zip.by_name("homebase.db").expect("db");
        let mut out = fs::File::create(&extracted).expect("create");
        std::io::copy(&mut entry, &mut out).expect("copy");
    }
    let options = SqliteConnectOptions::new()
        .filename(&extracted)
        .read_only(true);
    let mut c = run(SqliteConnection::connect_with(&options)).expect("open");
    assert_eq!(count(&mut c, "widget_instances"), 2);
    assert_eq!(count(&mut c, "notes"), 1);
    assert_eq!(count(&mut c, "todos"), 1);
    run(c.close()).expect("close");
    assert_ne!(dump(&root), before);
}

#[test]
fn pre_import_failure_cancels_the_import() {
    let (_dir, root) = seeded();
    let before = dump(&root);
    // A directory where the archive must go makes `create_backup` fail with AlreadyExists.
    fs::create_dir_all(
        root.backups()
            .join("homebase-20261022T093000.500Z-pre-import.zip"),
    )
    .expect("dir");
    let err = apply(&root, &base_plan()).expect_err("must fail");
    assert!(matches!(err, BackupError::Io { .. }), "{err:?}");
    assert_eq!(dump(&root), before);
}

#[test]
fn missing_database_cancels_the_import() {
    let dir = TempDir::new().expect("tmp");
    let root = DataRoot::new(dir.path().to_path_buf());
    assert_eq!(apply(&root, &base_plan()), Err(BackupError::NoDatabase));
    assert!(!root.db().exists());
}

#[test]
fn invalid_plan_creates_no_backup_and_writes_nothing() {
    let (_dir, root) = seeded();
    let before = dump(&root);
    let mut p = base_plan();
    p.dashboards[0].name = " Accueil".into();
    assert_eq!(problem_of(apply(&root, &p)), ImportProblem::InvalidName);
    assert!(pre_import_archives(&root).is_empty());
    assert_eq!(dump(&root), before);
}

#[test]
fn a_concurrent_writer_makes_the_import_fail_busy_without_changes() {
    let (_dir, root) = seeded();
    let before = dump(&root);
    let mut other = db_conn(&root);
    run(sqlx::query("BEGIN IMMEDIATE").execute(&mut other)).expect("lock");
    let err = run(apply_config_import_with(
        &root,
        &clock(),
        &base_plan(),
        Duration::from_millis(150),
    ))
    .expect_err("must fail");
    assert_eq!(err, BackupError::Database { code: "5".into() });
    run(sqlx::query("ROLLBACK").execute(&mut other)).expect("rollback");
    run(other.close()).expect("close");
    assert_eq!(dump(&root), before);
}

// ---- check_config_export / check_config_import_text / read_config_file ----

fn doc(extra: serde_json::Value) -> String {
    let mut v = json!({"format": "homebase/dashboard-config", "formatVersion": 1,
        "exportedAt": AT, "dashboards": [], "settings": {}});
    for (k, val) in extra.as_object().expect("object") {
        v[k] = val.clone();
    }
    serde_json::to_string_pretty(&v).expect("json")
}

#[test]
fn export_check() {
    check_config_export(&doc(json!({}))).expect("ok");
    check_config_export(&doc(json!({"settings": {"theme": "dark"}}))).expect("ok");
    for bad in [
        "[]",
        "1",
        "null",
        "\"x\"",
        "{",
        "",
        "{\"format\":\"other\"}",
        "{\"format\":1}",
        "{}",
    ] {
        assert_eq!(
            problem_of(check_config_export(bad)),
            ImportProblem::NotConfig,
            "{bad}"
        );
    }
    assert_eq!(
        problem_of(check_config_export(&doc(
            json!({"format": "homebase/other"})
        ))),
        ImportProblem::NotConfig
    );
    for key in ["token", "apiKey", "password", "github.token"] {
        let d = doc(json!({"settings": {"theme": "dark", key: "x"}}));
        assert_eq!(
            problem_of(check_config_export(&d)),
            ImportProblem::SecretSetting,
            "{key}"
        );
    }
    let huge = format!("{}{}", doc(json!({})), " ".repeat(1_048_576));
    assert_eq!(check_config_export(&huge), Err(BackupError::TooLarge));
}

#[test]
fn import_text_check() {
    check_config_import_text(&doc(json!({}))).expect("ok");
    // Secrets and the rest are the front's business at this stage.
    check_config_import_text(&doc(json!({"settings": {"token": "x"}}))).expect("format only");
    for bad in [
        "[]",
        "42",
        "null",
        "nope",
        "{\"format\":\"x\"}",
        "\u{0}\u{1}",
    ] {
        assert_eq!(
            problem_of(check_config_import_text(bad)),
            ImportProblem::NotConfig,
            "{bad:?}"
        );
    }
}

#[test]
fn read_file_cases() {
    let dir = TempDir::new().expect("tmp");
    let path = dir.path().join("c.json");
    let text = doc(json!({}));

    fs::write(&path, &text).expect("write");
    assert_eq!(read_config_file(&path).expect("read"), text);

    let mut with_bom = vec![0xEF, 0xBB, 0xBF];
    with_bom.extend_from_slice(text.as_bytes());
    fs::write(&path, &with_bom).expect("write");
    assert_eq!(read_config_file(&path).expect("read"), text);

    fs::write(&path, [0xFF, 0xFE, 0x00, 0x80]).expect("write");
    assert_eq!(problem_of(read_config_file(&path)), ImportProblem::NotUtf8);

    let mut bin = text.clone().into_bytes();
    bin.push(0xC3);
    fs::write(&path, &bin).expect("write");
    assert_eq!(problem_of(read_config_file(&path)), ImportProblem::NotUtf8);

    // Exactly at the limit: accepted by the reader; one byte more: too large.
    let mut at_limit = text.clone().into_bytes();
    at_limit.resize(1_048_576, b' ');
    fs::write(&path, &at_limit).expect("write");
    assert_eq!(read_config_file(&path).expect("read").len(), 1_048_576);
    at_limit.push(b' ');
    fs::write(&path, &at_limit).expect("write");
    assert_eq!(read_config_file(&path), Err(BackupError::TooLarge));

    assert!(matches!(
        read_config_file(&dir.path().join("absent.json")),
        Err(BackupError::Io { .. })
    ));
}

#[test]
fn a_binary_file_is_not_a_config() {
    let dir = TempDir::new().expect("tmp");
    let path = dir.path().join("b.json");
    fs::write(&path, b"PK\x03\x04\x00\x00binary").expect("write");
    let text = read_config_file(&path).expect("valid utf-8");
    assert_eq!(
        problem_of(check_config_import_text(&text)),
        ImportProblem::NotConfig
    );
}

#[test]
fn write_config_to_goes_through_a_temporary_file() {
    let data = TempDir::new().expect("tmp");
    let root = DataRoot::new(data.path().to_path_buf());
    let out = TempDir::new().expect("tmp");
    let dest = out.path().join("homebase-config.JSON");
    fs::write(&dest, "old").expect("old");
    write_config_to(&root, &dest, "{\"a\":1}").expect("write");
    assert_eq!(fs::read_to_string(&dest).expect("read"), "{\"a\":1}");
    assert_eq!(fs::read_dir(out.path()).expect("dir").count(), 1);

    let bad_ext = out.path().join("c.txt");
    assert_eq!(
        write_config_to(&root, &bad_ext, "x"),
        Err(BackupError::Io {
            code: "bad_extension".into()
        })
    );
    assert!(!bad_ext.exists());
    let in_root = data.path().join("c.json");
    assert_eq!(
        write_config_to(&root, &in_root, "x"),
        Err(BackupError::Io {
            code: "destination_in_data_root".into()
        })
    );
    assert!(!in_root.exists());
}

#[test]
fn import_outcome_serializes_in_camel_case() {
    let json = serde_json::to_string(&ImportOutcome {
        dashboards: 1,
        widgets: 2,
        settings: 3,
    })
    .expect("json");
    assert_eq!(json, r#"{"dashboards":1,"widgets":2,"settings":3}"#);
}

#[test]
fn nul_characters_are_refused_in_names_and_types() {
    assert_eq!(
        invalid(dash(|d| d["name"] = json!("Ac\u{0}cueil"))),
        ImportProblem::InvalidName
    );
    assert_eq!(
        invalid(with_widget(|w| w["widgetType"] = json!("no\u{0}tes"))),
        ImportProblem::InvalidWidgetType
    );
}

#[test]
fn boundaries_are_accepted() {
    let dashboards: Vec<_> = (0..5)
        .map(|d| {
            let widgets: Vec<_> = (0..200)
                .map(|i| widget(&format!("6c3f5d81-bc3e-4f88-{d:04x}-{i:012x}"), "notes"))
                .collect();
            json!({"id": format!("3f0c2a5e-8f0b-4c55-9a43-{d:012x}"), "name": "d", "sortOrder": 0, "widgets": widgets})
        })
        .collect();
    validate_plan(&plan(json!({"dashboards": dashboards, "settings": []}))).expect("1000 widgets");
    let key = "a".repeat(128);
    validate_plan(&plan(
        json!({"dashboards": base_dashboards(), "settings": [{"key": key, "value": "1"}]}),
    ))
    .expect("128-char key");
}

#[test]
fn export_requires_a_settings_object() {
    for bad in [
        r#"{"format":"homebase/dashboard-config"}"#,
        r#"{"format":"homebase/dashboard-config","settings":[]}"#,
        r#"{"format":"homebase/dashboard-config","settings":null}"#,
    ] {
        assert_eq!(
            problem_of(check_config_export(bad)),
            ImportProblem::NotConfig,
            "{bad}"
        );
    }
}

#[test]
fn renamed_dashboard_keeps_its_widget_and_note() {
    let (_dir, root) = seeded();
    let mut p = base_plan();
    p.dashboards[0].name = "Accueil".into();
    apply(&root, &p).expect("apply");
    let mut c = db_conn(&root);
    let row = run(sqlx::query("SELECT name FROM dashboards WHERE id = ?1")
        .bind(D1)
        .fetch_one(&mut c))
    .expect("row");
    assert_eq!(row.get::<String, _>(0), "Accueil");
    assert_eq!(count(&mut c, "widget_instances"), 1);
    assert_eq!(count(&mut c, "notes"), 1);
    run(c.close()).expect("close");
}

static OTHER_WRITER_CODE: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

fn try_foreign_write(
    db: std::path::PathBuf,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> {
    Box::pin(async move {
        let options = SqliteConnectOptions::new()
            .filename(&db)
            .busy_timeout(Duration::ZERO);
        let mut conn = SqliteConnection::connect_with(&options)
            .await
            .expect("connect");
        let result = sqlx::query(
            "INSERT INTO settings VALUES ('foreign.write', '1', '2026-10-20T08:00:00.000Z', '2026-10-20T08:00:00.000Z')",
        )
        .execute(&mut conn)
        .await;
        let code = match result {
            Ok(_) => "ok".to_owned(),
            Err(e) => e
                .as_database_error()
                .and_then(|d| d.code())
                .map(|c| c.into_owned())
                .unwrap_or_else(|| "other".into()),
        };
        *OTHER_WRITER_CODE.lock().expect("lock") = Some(code);
        let _ = conn.close().await;
    })
}

#[test]
fn the_write_lock_is_taken_by_begin_immediate() {
    let (_dir, root) = seeded();
    *AFTER_BEGIN.lock().expect("lock") = Some((root.db(), try_foreign_write));
    apply(&root, &base_plan()).expect("apply");
    *AFTER_BEGIN.lock().expect("lock") = None;
    // SQLITE_BUSY: with a deferred BEGIN, the foreign write would have succeeded here.
    assert_eq!(
        OTHER_WRITER_CODE.lock().expect("lock").as_deref(),
        Some("5")
    );
    let mut c = db_conn(&root);
    assert_eq!(count(&mut c, "settings"), 1);
    run(c.close()).expect("close");
}
