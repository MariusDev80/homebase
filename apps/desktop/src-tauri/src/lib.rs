mod backup;
#[cfg(test)]
mod capability_tests;
mod db;
mod net;
mod schedule;
mod spike;
mod time;
mod tray;
mod weather;

use tauri::{Manager, Runtime, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

/// Debug builds also expose the test-notification spike command.
#[cfg(debug_assertions)]
fn invoke_handler<R: tauri::Runtime>(
) -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        spike::schedule_test_notification,
        spike::get_autostart,
        spike::set_autostart,
        weather::weather_forecast,
        weather::weather_geocode,
        backup::commands::backup_list,
        backup::commands::backup_create,
        backup::commands::backup_open_folder,
        backup::commands::backup_restore,
        backup::commands::backup_export,
        backup::commands::backup_pick_external,
        backup::commands::backup_acknowledge,
        backup::commands::config_export_save,
        backup::commands::config_import_pick,
        backup::commands::config_import_apply,
        backup::commands::dashboard_delete,
        time::commands::time_validate,
        time::commands::time_expand,
        schedule::commands::reminder_list,
        schedule::commands::reminder_create,
        schedule::commands::reminder_update,
        schedule::commands::reminder_delete,
        schedule::commands::reminder_unseen_deliveries,
        schedule::commands::reminder_mark_seen,
        schedule::commands::session_list_running,
        schedule::commands::session_history,
        schedule::commands::session_start,
        schedule::commands::session_stop,
        schedule::commands::session_rename,
        schedule::commands::session_delete,
        schedule::habit_commands::habit_list,
        schedule::habit_commands::habit_create,
        schedule::habit_commands::habit_update,
        schedule::habit_commands::habit_set_archived,
        schedule::habit_commands::habit_delete,
        schedule::habit_commands::habit_checks,
        schedule::habit_commands::habit_set_check,
    ]
}

#[cfg(not(debug_assertions))]
fn invoke_handler<R: tauri::Runtime>(
) -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        spike::get_autostart,
        spike::set_autostart,
        weather::weather_forecast,
        weather::weather_geocode,
        backup::commands::backup_list,
        backup::commands::backup_create,
        backup::commands::backup_open_folder,
        backup::commands::backup_restore,
        backup::commands::backup_export,
        backup::commands::backup_pick_external,
        backup::commands::backup_acknowledge,
        backup::commands::config_export_save,
        backup::commands::config_import_pick,
        backup::commands::config_import_apply,
        backup::commands::dashboard_delete,
        time::commands::time_validate,
        time::commands::time_expand,
        schedule::commands::reminder_list,
        schedule::commands::reminder_create,
        schedule::commands::reminder_update,
        schedule::commands::reminder_delete,
        schedule::commands::reminder_unseen_deliveries,
        schedule::commands::reminder_mark_seen,
        schedule::commands::session_list_running,
        schedule::commands::session_history,
        schedule::commands::session_start,
        schedule::commands::session_stop,
        schedule::commands::session_rename,
        schedule::commands::session_delete,
        schedule::habit_commands::habit_list,
        schedule::habit_commands::habit_create,
        schedule::habit_commands::habit_update,
        schedule::habit_commands::habit_set_archived,
        schedule::habit_commands::habit_delete,
        schedule::habit_commands::habit_checks,
        schedule::habit_commands::habit_set_check,
    ]
}

/// The dialog plugin is used from Rust only (no permission in any capability). Not registered in
/// tests: nothing there may link the native dialog code (S11).
#[cfg(not(test))]
fn register_dialog<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.plugin(tauri_plugin_dialog::init())
}

#[cfg(test)]
fn register_dialog<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // The single-instance plugin must be the very first one: a second launch exits inside its
    // setup, before the backup plugin takes `homebase.lock` or touches the restore exchange.
    // On Windows it holds a named mutex until `RunEvent::Exit` (dispatched to plugins before our
    // `on_exit` and before the restart spawn), so a restart after a restoration is not refused.
    let builder =
        tauri::Builder::default().plugin(tauri_plugin_single_instance::init(on_second_launch));
    register_dialog(builder)
        .manage(net::NetClient::new())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        // MacosLauncher is ignored on Windows (registry Run key).
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![MINIMIZED_ARG]),
        ))
        // Must stay right before the SQL plugin: its setup runs the startup sequence (restore
        // exchange) and, on `StartupBlocked`, fails so that the SQL plugin never initialises.
        .plugin(backup::startup::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(db::DB_URL, db::migrations())
                .build(),
        )
        .invoke_handler(invoke_handler())
        .setup(|app| {
            // First, before anything else: confirms a restoration done in this process.
            backup::startup::on_app_ready(app.handle())?;
            tray::setup(app.handle())?;
            schedule::start(app.handle())?;
            refresh_autostart(app.handle());
            // The window is declared invisible: a manual launch must show it.
            if !launched_minimized(std::env::args()) {
                show_main_window(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Close to tray: hide instead of closing the main window.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Homebase")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // Before the backup exit. Tauri calls this callback (so both waits) before
                // `process::restart`; the bounded waits are a prudence measure.
                schedule::shutdown(app);
                backup::startup::on_exit(app);
            }
        });
}

/// Fixed argument written in the autostart entry (no user input).
const MINIMIZED_ARG: &str = "--minimized";

/// True when the process was started by the autostart entry (exact `--minimized` argument).
/// The executable path (first item) can never equal the argument.
pub(crate) fn launched_minimized(args: impl IntoIterator<Item = String>) -> bool {
    args.into_iter().any(|arg| arg == MINIMIZED_ARG)
}

/// Rewrites the autostart entry (current path and argument) when it is enabled. Never blocking.
fn refresh_autostart<R: Runtime>(app: &tauri::AppHandle<R>) {
    let manager = app.autolaunch();
    match manager.is_enabled() {
        Ok(true) => {
            if let Err(error) = manager.enable() {
                eprintln!("autostart refresh failed: {error}");
            }
        }
        Ok(false) => {}
        Err(error) => eprintln!("autostart state unavailable: {error}"),
    }
}

/// Called in the running instance when the user launches Homebase again (Start menu, shortcut):
/// brings the existing window back from the tray. Arguments and cwd are ignored.
fn on_second_launch<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    _args: Vec<String>,
    _cwd: String,
) {
    show_main_window(app);
}

/// Shows and focuses the main window (used by the tray).
pub(crate) fn show_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::launched_minimized;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn launched_minimized_requires_the_exact_argument() {
        assert!(launched_minimized(args(&["homebase.exe", "--minimized"])));
        assert!(!launched_minimized(args(&["homebase.exe"])));
        assert!(!launched_minimized(args(&[])));
        assert!(!launched_minimized(args(&[
            "homebase.exe",
            "--minimized=1"
        ])));
        assert!(!launched_minimized(args(&["homebase.exe", "--Minimized"])));
        assert!(launched_minimized(args(&[
            "homebase.exe",
            "--other",
            "--minimized"
        ])));
    }

    #[test]
    fn setup_refreshes_autostart_then_shows_the_window_unless_minimized() {
        let source = include_str!("lib.rs");
        let production = source
            .split("#[cfg(test)]\nmod tests")
            .next()
            .expect("production part");
        let start = production.find("schedule::start(").expect("start");
        let refresh = production.find("refresh_autostart(app").expect("refresh");
        let show = production
            .find("if !launched_minimized(std::env::args())")
            .expect("show");
        assert!(start < refresh && refresh < show);
        assert!(production.contains("Some(vec![MINIMIZED_ARG])"));
    }

    /// Both `invoke_handler` variants (debug and release) must list the backup commands and
    /// keep the weather ones.
    #[test]
    fn commands_are_registered_in_both_invoke_handlers() {
        let source = include_str!("lib.rs");
        let production = source
            .split("#[cfg(test)]\nmod tests")
            .next()
            .expect("production part");
        for command in [
            "backup::commands::backup_list",
            "backup::commands::backup_create",
            "backup::commands::backup_open_folder",
            "backup::commands::backup_restore",
            "backup::commands::backup_export",
            "backup::commands::backup_pick_external",
            "backup::commands::backup_acknowledge",
            "backup::commands::config_export_save",
            "backup::commands::config_import_pick",
            "backup::commands::config_import_apply",
            "backup::commands::dashboard_delete",
            "weather::weather_forecast",
            "weather::weather_geocode",
            "time::commands::time_validate",
            "time::commands::time_expand",
            "schedule::commands::reminder_list",
            "schedule::commands::reminder_create",
            "schedule::commands::reminder_update",
            "schedule::commands::reminder_delete",
            "schedule::commands::reminder_unseen_deliveries",
            "schedule::commands::reminder_mark_seen",
            "schedule::commands::session_list_running",
            "schedule::commands::session_history",
            "schedule::commands::session_start",
            "schedule::commands::session_stop",
            "schedule::commands::session_rename",
            "schedule::commands::session_delete",
            "schedule::habit_commands::habit_list",
            "schedule::habit_commands::habit_create",
            "schedule::habit_commands::habit_update",
            "schedule::habit_commands::habit_set_archived",
            "schedule::habit_commands::habit_delete",
            "schedule::habit_commands::habit_checks",
            "schedule::habit_commands::habit_set_check",
        ] {
            assert_eq!(
                production.matches(&format!("        {command},")).count(),
                2,
                "{command} must be in both invoke handlers"
            );
        }
    }

    #[test]
    fn build_rs_lists_the_commands() {
        let build = include_str!("../build.rs");
        for command in [
            "weather_forecast",
            "weather_geocode",
            "backup_list",
            "backup_create",
            "backup_open_folder",
            "backup_restore",
            "backup_export",
            "backup_pick_external",
            "backup_acknowledge",
            "config_export_save",
            "config_import_pick",
            "config_import_apply",
            "dashboard_delete",
            "time_validate",
            "time_expand",
            "reminder_list",
            "reminder_create",
            "reminder_update",
            "reminder_delete",
            "reminder_unseen_deliveries",
            "reminder_mark_seen",
            "session_list_running",
            "session_history",
            "session_start",
            "session_stop",
            "session_rename",
            "session_delete",
            "habit_list",
            "habit_create",
            "habit_update",
            "habit_set_archived",
            "habit_delete",
            "habit_checks",
            "habit_set_check",
        ] {
            assert!(build.contains(&format!("\"{command}\",")), "{command}");
        }
    }

    #[test]
    fn single_instance_is_the_first_plugin_and_before_backup() {
        let source = include_str!("lib.rs");
        let production = source
            .split("#[cfg(test)]\nmod tests")
            .next()
            .expect("production part");
        let single = production
            .find("tauri_plugin_single_instance::init(")
            .expect("single-instance plugin");
        let backup = production
            .find(".plugin(backup::startup::init())")
            .expect("backup plugin");
        assert!(
            single < backup,
            "single-instance must precede the backup plugin"
        );
        for other in [
            "register_dialog(builder)",
            "tauri_plugin_notification::init()",
            "tauri_plugin_opener::Builder",
            "tauri_plugin_autostart::init(",
            "tauri_plugin_sql::Builder",
        ] {
            assert!(
                single < production.find(other).expect(other),
                "single-instance must precede {other}"
            );
        }
        assert!(production.contains("init(on_second_launch)"));
        assert_eq!(
            production.matches("tauri_plugin_single_instance").count(),
            1
        );
    }

    #[test]
    fn backup_plugin_is_before_sql_and_confirmation_before_tray() {
        let source = include_str!("lib.rs");
        let production = source
            .split("#[cfg(test)]\nmod tests")
            .next()
            .expect("production part");
        let backup = production
            .find(".plugin(backup::startup::init())")
            .expect("backup plugin");
        let sql = production
            .find("tauri_plugin_sql::Builder")
            .expect("sql plugin");
        assert!(backup < sql, "backup::startup::init() must come first");
        let between = &production[backup + ".plugin(backup::startup::init())".len()..sql];
        assert_eq!(
            between.trim(),
            ".plugin(",
            "backup::startup::init() must be registered right before tauri_plugin_sql"
        );
        let ready = production
            .find("backup::startup::on_app_ready(")
            .expect("on_app_ready");
        let tray = production.find("tray::setup(").expect("tray");
        assert!(ready < tray, "on_app_ready must come before tray::setup");
        assert!(!production.contains("app_restart"));
        assert!(!production.contains("tauri_plugin_process"));
    }

    #[test]
    fn scheduler_starts_after_the_tray_and_stops_before_the_backup_exit() {
        let source = include_str!("lib.rs");
        let production = source
            .split("#[cfg(test)]\nmod tests")
            .next()
            .expect("production part");
        let ready = production
            .find("backup::startup::on_app_ready(")
            .expect("on_app_ready");
        let tray = production.find("tray::setup(").expect("tray");
        let start = production.find("schedule::start(").expect("schedule start");
        assert!(
            ready < start,
            "schedule::start must come after on_app_ready"
        );
        assert!(tray < start, "schedule::start must come after tray::setup");
        let stop = production
            .find("schedule::shutdown(")
            .expect("schedule shutdown");
        let exit = production
            .find("backup::startup::on_exit(")
            .expect("backup exit");
        assert!(
            stop < exit,
            "schedule::shutdown must precede the backup exit"
        );
    }
}
