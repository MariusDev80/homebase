mod backup;
#[cfg(test)]
mod capability_tests;
mod db;
mod net;
mod spike;
mod time;
mod tray;
mod weather;

use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

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
            None,
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
                backup::startup::on_exit(app);
            }
        });
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
}
