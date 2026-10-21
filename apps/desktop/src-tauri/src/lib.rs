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
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
        .run(tauri::generate_context!())
        .expect("error while running Homebase");
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
        ] {
            assert!(build.contains(&format!("\"{command}\",")), "{command}");
        }
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
        let ready = production
            .find("backup::startup::on_app_ready(")
            .expect("on_app_ready");
        let tray = production.find("tray::setup(").expect("tray");
        assert!(ready < tray, "on_app_ready must come before tray::setup");
        assert!(!production.contains("app_restart"));
        assert!(!production.contains("tauri_plugin_process"));
    }
}
