use super::create::create_backup;
use super::dashboard_delete::{delete_dashboard, delete_row};
use super::error::BackupError;
use super::list::list_backups;
use super::names::{BackupKind, BackupName};
use super::paths::DataRoot;
use super::sqlite::supported_schema_version;
use super::test_support::{make_database_with_migrator, run};
use super::BackupState;
use crate::time::clock::FixedClock;
use crate::time::formats::parse_instant;
use jiff::SignedDuration;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, SqliteConnection};
use std::fs;
use std::sync::Arc;
use tempfile::TempDir;

const HOME: &str = "3f0c2a5e-8f0b-4c55-9a43-0d2a1d6c9b11";
const OTHER: &str = "11111111-8f0b-4c55-9a43-0d2a1d6c9b11";
const WIDGET: &str = "22222222-8f0b-4c55-9a43-0d2a1d6c9b11";
const NOTE: &str = "33333333-8f0b-4c55-9a43-0d2a1d6c9b11";
const LIST: &str = "44444444-8f0b-4c55-9a43-0d2a1d6c9b11";
const TODO: &str = "55555555-8f0b-4c55-9a43-0d2a1d6c9b11";
const SHORTCUT: &str = "66666666-8f0b-4c55-9a43-0d2a1d6c9b11";
const AT: &str = "2026-10-21T08:15:00.123Z";

fn clock() -> Arc<FixedClock> {
    Arc::new(FixedClock::new(parse_instant(AT).expect("instant")))
}

/// `Home` (empty); with `two`, also `Other` holding a widget with a note, a list and a todo, plus
/// a shortcut.
fn setup(two: bool) -> (TempDir, BackupState, Arc<FixedClock>) {
    let dir = TempDir::new().expect("tmp");
    let root = DataRoot::new(dir.path().to_path_buf());
    make_database_with_migrator(&root.db(), true);
    if two {
        let statements = [
            format!("INSERT INTO dashboards (id, name, sort_order, created_at, updated_at) VALUES ('{OTHER}', 'Other', 1, '{AT}', '{AT}')"),
            format!("INSERT INTO widget_instances (id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h, config, config_version, created_at, updated_at) VALUES ('{WIDGET}', '{OTHER}', 'notes', 0, 0, 2, 2, '{{}}', 1, '{AT}', '{AT}')"),
            format!("INSERT INTO notes (id, widget_instance_id, title, body, created_at, updated_at) VALUES ('{NOTE}', '{WIDGET}', 't', 'b', '{AT}', '{AT}')"),
            format!("INSERT INTO todo_lists (id, widget_instance_id, name, created_at, updated_at) VALUES ('{LIST}', '{WIDGET}', 'l', '{AT}', '{AT}')"),
            format!("INSERT INTO todos (id, list_id, title, sort_order, created_at, updated_at) VALUES ('{TODO}', '{LIST}', 'x', 0, '{AT}', '{AT}')"),
            format!("INSERT INTO shortcuts (id, label, url, sort_order, created_at, updated_at) VALUES ('{SHORTCUT}', 's', 'https://example.org', 0, '{AT}', '{AT}')"),
        ];
        exec(&root, &statements);
    }
    let c = clock();
    let state = BackupState::new(root, c.clone(), None);
    (dir, state, c)
}

fn options(root: &DataRoot) -> SqliteConnectOptions {
    SqliteConnectOptions::new()
        .filename(root.db())
        .create_if_missing(false)
        .foreign_keys(true)
}

fn exec(root: &DataRoot, statements: &[String]) {
    run(async {
        let mut conn = SqliteConnection::connect_with(&options(root))
            .await
            .expect("open");
        for s in statements {
            sqlx::query(s).execute(&mut conn).await.expect(s);
        }
        conn.close().await.expect("close");
    });
}

fn count(root: &DataRoot, table: &str) -> i64 {
    run(async {
        let mut conn = SqliteConnection::connect_with(&options(root))
            .await
            .expect("open");
        let n: (i64,) = sqlx::query_as(&format!("SELECT COUNT(*) FROM {table}"))
            .fetch_one(&mut conn)
            .await
            .expect("count");
        conn.close().await.expect("close");
        n.0
    })
}

fn archives(root: &DataRoot) -> usize {
    list_backups(root).len()
}

#[test]
fn deletes_with_cascade_and_keeps_shortcuts() {
    let (_d, state, _c) = setup(true);
    run(delete_dashboard(&state, OTHER)).expect("delete");
    assert_eq!(count(&state.root, "dashboards"), 1);
    for table in ["widget_instances", "notes", "todo_lists", "todos"] {
        assert_eq!(count(&state.root, table), 0, "{table}");
    }
    assert_eq!(count(&state.root, "shortcuts"), 1);
}

#[test]
fn pre_delete_archive_is_database_only_and_current_schema() {
    let (_d, state, _c) = setup(true);
    run(delete_dashboard(&state, OTHER)).expect("delete");
    let list = list_backups(&state.root);
    assert_eq!(list.len(), 1);
    let info = &list[0];
    assert_eq!(info.kind, BackupKind::PreDelete);
    assert!(!info.damaged);
    assert_eq!(info.includes_images, Some(false));
    assert_eq!(info.image_count, Some(0));
    assert_eq!(info.schema_version, Some(supported_schema_version()));
}

#[test]
fn backup_failure_cancels_the_deletion() {
    let (_d, state, _c) = setup(true);
    // The archive name of this very instant is already taken.
    let name = BackupName::new(state.clock.now(), BackupKind::PreDelete).file_name();
    fs::create_dir_all(state.root.backups()).expect("dir");
    fs::write(state.root.backups().join(&name), b"x").expect("write");
    let result = run(delete_dashboard(&state, OTHER));
    assert_eq!(
        result,
        Err(BackupError::Io {
            code: "AlreadyExists".into()
        })
    );
    assert_eq!(count(&state.root, "dashboards"), 2);
    assert_eq!(count(&state.root, "todos"), 1);
    assert_eq!(
        fs::read(state.root.backups().join(&name)).expect("kept"),
        b"x"
    );
}

#[test]
fn last_dashboard_is_refused_without_archive() {
    let (_d, state, _c) = setup(false);
    assert_eq!(
        run(delete_dashboard(&state, HOME)),
        Err(BackupError::LastDashboard)
    );
    assert_eq!(count(&state.root, "dashboards"), 1);
    assert_eq!(archives(&state.root), 0);
}

#[test]
fn absent_dashboard_is_not_found_without_archive() {
    let (_d, state, _c) = setup(true);
    let absent = "99999999-8f0b-4c55-9a43-0d2a1d6c9b11";
    assert_eq!(
        run(delete_dashboard(&state, absent)),
        Err(BackupError::NotFound)
    );
    assert_eq!(count(&state.root, "dashboards"), 2);
    assert_eq!(archives(&state.root), 0);
}

#[test]
fn malformed_id_is_invalid_without_archive() {
    let (_d, state, _c) = setup(true);
    for bad in ["", "x", "../x", &OTHER.to_uppercase(), "1' OR '1'='1"] {
        assert_eq!(
            run(delete_dashboard(&state, bad)),
            Err(BackupError::InvalidId),
            "{bad:?}"
        );
    }
    assert_eq!(count(&state.root, "dashboards"), 2);
    assert_eq!(archives(&state.root), 0);
}

#[test]
fn busy_lock_refuses_without_archive() {
    let (_d, state, _c) = setup(true);
    let guard = state.try_acquire().expect("lock");
    assert_eq!(run(delete_dashboard(&state, OTHER)), Err(BackupError::Busy));
    drop(guard);
    assert_eq!(count(&state.root, "dashboards"), 2);
    assert_eq!(archives(&state.root), 0);
}

#[test]
fn restart_pending_refuses_without_archive() {
    let (_d, state, _c) = setup(true);
    state.mark_restart_pending();
    assert_eq!(
        run(delete_dashboard(&state, OTHER)),
        Err(BackupError::RestartPending)
    );
    assert_eq!(count(&state.root, "dashboards"), 2);
    assert_eq!(archives(&state.root), 0);
}

#[test]
fn sixth_safety_backup_evicts_the_oldest_of_any_safety_type() {
    let (_d, state, c) = setup(true);
    let mut ids = Vec::new();
    for i in 0..5 {
        c.advance(SignedDuration::from_secs(60));
        let kind = if i % 2 == 0 {
            BackupKind::PreRestore
        } else {
            BackupKind::PreImport
        };
        ids.push(
            run(create_backup(&state.root, c.as_ref(), kind, &[]))
                .expect("create")
                .id,
        );
    }
    c.advance(SignedDuration::from_secs(60));
    run(delete_dashboard(&state, OTHER)).expect("delete");
    let list = list_backups(&state.root);
    assert_eq!(list.len(), 5);
    assert!(list.iter().all(|b| b.id != ids[0]));
    assert!(list.iter().any(|b| b.kind == BackupKind::PreDelete));
}

#[test]
fn delete_row_refuses_the_last_dashboard_itself() {
    let (_d, state, _c) = setup(false);
    assert_eq!(run(delete_row(&state.root.db(), HOME)).expect("ran"), 0);
    assert_eq!(count(&state.root, "dashboards"), 1);
}

#[test]
fn missing_database_is_reported() {
    let (_d, state, _c) = setup(true);
    fs::remove_file(state.root.db()).expect("remove");
    assert_eq!(
        run(delete_dashboard(&state, OTHER)),
        Err(BackupError::NoDatabase)
    );
}

#[test]
fn archive_snapshot_still_holds_the_deleted_rows() {
    let (_d, state, _c) = setup(true);
    run(delete_dashboard(&state, OTHER)).expect("delete");
    let info = list_backups(&state.root).remove(0);
    let file = fs::File::open(state.root.backups().join(&info.id)).expect("open");
    let mut zip = zip::ZipArchive::new(file).expect("zip");
    let out = state.root.backups_tmp().join("check.db");
    fs::create_dir_all(state.root.backups_tmp()).expect("dir");
    let mut db = zip.by_name("homebase.db").expect("db entry");
    std::io::copy(&mut db, &mut fs::File::create(&out).expect("create")).expect("copy");
    drop(db);
    let found: (i64, i64) = run(async {
        let options = SqliteConnectOptions::new().filename(&out).read_only(true);
        let mut conn = SqliteConnection::connect_with(&options)
            .await
            .expect("open");
        let row = sqlx::query_as(&format!(
            "SELECT (SELECT COUNT(*) FROM dashboards WHERE id = '{OTHER}'), (SELECT COUNT(*) FROM todos WHERE id = '{TODO}')"
        ))
        .fetch_one(&mut conn)
        .await
        .expect("row");
        conn.close().await.expect("close");
        row
    });
    assert_eq!(found, (1, 1));
}
