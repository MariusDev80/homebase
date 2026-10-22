//! Native dialogs (spec D5, 4.10). They are opened from Rust only: the front never sees a path and
//! the `dialog` plugin has no permission in any capability.
//!
//! Every function here blocks until the user answers: callers run them inside `spawn_blocking`
//! (`create::blocking`). `rfd` and the `blocking_*` calls of the plugin appear only in this file,
//! under `cfg(not(test))`; the `cfg(test)` stubs have the same signatures and never reach `rfd`
//! (S11: a test binary that links `rfd` with `common-controls-v6` dies with `0xc0000139`).

use std::path::Path;

/// Text of the blocking message shown when the startup is refused (spec 4.8). Pure, so it can be
/// tested without any dialog.
pub fn startup_blocked_text(root: &Path) -> String {
    let root = root.display();
    format!(
        "Homebase ne peut pas démarrer : une restauration n'a pu être ni terminée ni annulée. \
Pour protéger vos données, rien n'a été supprimé. Vos données d'origine se trouvent dans le \
dossier {root}\\restore-rollback (la base homebase.db et les fichiers homebase.db-wal, -shm, \
-journal éventuels vont ensemble). Fermez les programmes qui pourraient utiliser ce dossier \
(antivirus, synchronisation), puis relancez Homebase. Une sauvegarde « avant restauration » se \
trouve aussi dans {root}\\backups."
    )
}

#[cfg(not(test))]
mod native {
    use super::startup_blocked_text;
    use std::path::{Path, PathBuf};
    use tauri::{AppHandle, Manager, Runtime};
    use tauri_plugin_dialog::{DialogExt, FileDialogBuilder};

    fn with_parent<R: Runtime>(
        app: &AppHandle<R>,
        builder: FileDialogBuilder<R>,
    ) -> FileDialogBuilder<R> {
        match app.get_webview_window("main") {
            Some(window) => builder.set_parent(&window),
            None => builder,
        }
    }

    pub fn pick_archive<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
        let builder = app
            .dialog()
            .file()
            .set_title("Choisir une sauvegarde Homebase")
            .add_filter("Sauvegarde Homebase (*.zip)", &["zip"]);
        with_parent(app, builder)
            .blocking_pick_file()
            .and_then(|p| p.into_path().ok())
    }

    pub fn save_archive<R: Runtime>(app: &AppHandle<R>, suggested_name: &str) -> Option<PathBuf> {
        let builder = app
            .dialog()
            .file()
            .set_title("Exporter la sauvegarde")
            .set_file_name(suggested_name)
            .add_filter("Sauvegarde Homebase (*.zip)", &["zip"]);
        with_parent(app, builder)
            .blocking_save_file()
            .and_then(|p| p.into_path().ok())
    }

    #[allow(dead_code)] // used from lot B4a
    pub fn pick_config<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
        let builder = app
            .dialog()
            .file()
            .set_title("Importer une configuration")
            .add_filter("Configuration Homebase (*.json)", &["json"]);
        with_parent(app, builder)
            .blocking_pick_file()
            .and_then(|p| p.into_path().ok())
    }

    #[allow(dead_code)] // used from lot B4a
    pub fn save_config<R: Runtime>(app: &AppHandle<R>, suggested_name: &str) -> Option<PathBuf> {
        let builder = app
            .dialog()
            .file()
            .set_title("Exporter la configuration")
            .set_file_name(suggested_name)
            .add_filter("Configuration Homebase (*.json)", &["json"]);
        with_parent(app, builder)
            .blocking_save_file()
            .and_then(|p| p.into_path().ok())
    }

    /// Blocking native message (level Error, button OK). Works before the event loop exists (S14,
    /// to check with M11).
    pub fn show_startup_blocked(root: &Path) {
        let _ = rfd::MessageDialog::new()
            .set_level(rfd::MessageLevel::Error)
            .set_title("Homebase")
            .set_description(startup_blocked_text(root))
            .set_buttons(rfd::MessageButtons::Ok)
            .show();
    }
}

#[cfg(not(test))]
pub use native::*;

/// Test stubs: same signatures, no reference to `rfd`.
#[cfg(test)]
mod stub {
    use std::path::{Path, PathBuf};
    use tauri::{AppHandle, Runtime};

    pub fn pick_archive<R: Runtime>(_app: &AppHandle<R>) -> Option<PathBuf> {
        None
    }

    pub fn save_archive<R: Runtime>(_app: &AppHandle<R>, _suggested_name: &str) -> Option<PathBuf> {
        None
    }

    #[allow(dead_code)] // used from lot B4a
    pub fn pick_config<R: Runtime>(_app: &AppHandle<R>) -> Option<PathBuf> {
        None
    }

    #[allow(dead_code)] // used from lot B4a
    pub fn save_config<R: Runtime>(_app: &AppHandle<R>, _suggested_name: &str) -> Option<PathBuf> {
        None
    }

    pub fn show_startup_blocked(_root: &Path) {}
}

#[cfg(test)]
pub use stub::*;

#[cfg(test)]
mod tests {
    use super::startup_blocked_text;
    use std::path::Path;

    #[test]
    fn blocked_text_names_the_rollback_and_backups_folders() {
        let text = startup_blocked_text(Path::new(r"C:\Users\x\AppData\Roaming\app"));
        assert!(text.starts_with("Homebase ne peut pas démarrer"));
        assert!(text.contains(r"C:\Users\x\AppData\Roaming\app\restore-rollback"));
        assert!(text.contains(r"C:\Users\x\AppData\Roaming\app\backups."));
        assert!(text.contains("rien n'a été supprimé"));
    }
}
