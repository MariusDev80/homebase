//! Startup sequence (spec 4.8): cleanup, confirmed folders, rollback, swap. Runs in the setup of
//! the internal `homebase-backup` plugin, registered **before** `tauri_plugin_sql`.
//!
//! Also steps 6 (R6 detection) and 7 (`pre-migration`), the native message of `StartupBlocked`
//! and the start of the daily thread.

use super::create::create_backup;
use super::dialogs;
use super::fsutil::{remove_with_retry, rename_with_retry};
use super::lock;
use super::names::{BackupKind, BackupName};
use super::paths::DataRoot;
use super::restore::{
    confirm_restore, confirmed_dirs, present, read_restore_info, remove_confirmed_dir, rollback,
    swap, verify_pending, write_report, Faults, RestoreInfo, StartupStep,
};
use super::sqlite::{read_schema_version, supported_schema_version};
use super::status::{
    clear_db_missing, clear_pre_migration_failed, clear_startup_blocked, db_missing_alert,
    read_last_restore, startup_blocked_exists, write_db_missing, write_pre_migration_failed,
    write_startup_blocked, RestoreOutcome, StartupBlockedReason,
};
use super::BackupState;
use crate::time::clock::{Clock, SystemClock};
use crate::time::formats::parse_instant;
use std::fmt;
use std::fs;
use std::sync::Arc;
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{AppHandle, Manager, Runtime};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StartupOutcome {
    /// An exchange took place in this process (the confirmation is due in `.setup()`).
    pub swapped: bool,
    /// The `restore-info.json` of that exchange, kept in memory for the confirmation.
    pub swap_info: Option<RestoreInfo>,
}

/// The original state could not be put back (or its description is unreadable): the application
/// must not start, and nothing has been deleted.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StartupBlocked {
    pub reason: StartupBlockedReason,
}

impl fmt::Display for StartupBlocked {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "startup blocked: {:?}", self.reason)
    }
}

impl std::error::Error for StartupBlocked {}

/// Empties a folder but keeps it. Failures are only logged.
fn empty_dir(dir: &std::path::Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if let Err(e) = remove_with_retry(&entry.path()) {
            eprintln!("startup: cleanup failed: {:?}", e.kind());
        }
    }
}

pub fn startup_sequence(
    root: &DataRoot,
    clock: &dyn Clock,
) -> Result<StartupOutcome, StartupBlocked> {
    startup_sequence_with(root, clock, &Faults::default())
}

/// Steps 1 to 8 of spec 4.8.
pub fn startup_sequence_with(
    root: &DataRoot,
    clock: &dyn Clock,
    faults: &Faults,
) -> Result<StartupOutcome, StartupBlocked> {
    // 1. cleanup
    empty_dir(&root.backups_tmp());
    empty_dir(&root.incoming());
    if let Err(e) = remove_with_retry(&root.restore_staging()) {
        eprintln!("startup: cannot remove the staging folder: {:?}", e.kind());
    }

    // 2. confirmed restorations: finish the deletion, never restore.
    for dir in confirmed_dirs(root) {
        if let Some(info) = read_restore_info(&dir.join("restore-info.json")) {
            // Only write when the last report is absent, unreadable or older than the swap: a
            // more recent report (a later restoration, a rollback) must not be overwritten.
            if let Ok(started) = parse_instant(&info.started_at) {
                let stale = read_last_restore(root)
                    .and_then(|r| parse_instant(&r.at).ok())
                    .is_none_or(|at| at < started);
                if stale {
                    write_report(
                        root,
                        RestoreOutcome::Applied,
                        started,
                        Some(info.backup_created_at.clone()),
                        Some(info.backup_kind),
                    );
                    if let Err(e) = clear_db_missing(root) {
                        eprintln!("startup: cannot remove db-missing.json: {:?}", e.kind());
                    }
                }
            }
        }
        if let Err(e) = remove_confirmed_dir(&dir, &Faults::default()) {
            eprintln!(
                "startup: confirmed folder not deleted ({:?}), retry at next startup",
                e.kind()
            );
        }
    }

    // 3. unconfirmed exchange: back to the original state.
    if present(&root.restore_rollback()).unwrap_or(true) {
        let info = read_restore_info(&root.restore_info());
        match rollback(root, faults) {
            Ok(()) => {
                if !present(&root.restore_pending()).unwrap_or(true) {
                    write_report(
                        root,
                        RestoreOutcome::RolledBack,
                        clock.now(),
                        info.as_ref().map(|i| i.backup_created_at.clone()),
                        info.as_ref().map(|i| i.backup_kind),
                    );
                }
            }
            Err(e) => {
                eprintln!("startup: rollback failed: {e}");
                return Err(StartupBlocked { reason: e.reason() });
            }
        }
    }

    // 4. pending restoration.
    let mut swap_info = None;
    if present(&root.restore_pending()).unwrap_or(false) {
        match verify_pending(root) {
            Err(invalid) => {
                eprintln!("startup: restore-pending is not valid, discarded");
                discard_pending(root, clock, invalid.manifest.as_ref(), faults);
            }
            Ok(manifest) => match swap(root, clock, &manifest, faults) {
                Ok(info) => swap_info = Some(info),
                Err(e) => {
                    eprintln!("startup: swap failed ({:?}), rolling back", e.kind());
                    match rollback(root, faults) {
                        Ok(()) => discard_pending(root, clock, Some(&manifest), faults),
                        Err(e) => {
                            eprintln!("startup: rollback after a failed swap failed: {e}");
                            return Err(StartupBlocked { reason: e.reason() });
                        }
                    }
                }
            },
        }
    }

    // 5. no blocking on steps 3 and 4.
    if startup_blocked_exists(root) {
        if let Err(e) = clear_startup_blocked(root) {
            eprintln!(
                "startup: cannot remove startup-blocked.json: {:?}",
                e.kind()
            );
        }
    }

    // 6. R6: no database although backups exist.
    if detect_missing_db(root) && !db_missing_alert(root) {
        if let Err(e) = write_db_missing(root, clock.now()) {
            eprintln!("startup: cannot write db-missing.json: {:?}", e.kind());
        }
    }

    // 7. `pre-migration` (database only) when the binary is newer than the database. An absent
    // database (or table) gives nothing, not even a marker.
    pre_migration(root, clock);

    // 8.
    Ok(StartupOutcome {
        swapped: swap_info.is_some(),
        swap_info,
    })
}

/// Removes `restore-pending\` and records `failed`. When it cannot be removed it is renamed to
/// `restore-pending.discarded-<stamp>` so that no later startup can ever apply it.
fn discard_pending(
    root: &DataRoot,
    clock: &dyn Clock,
    manifest: Option<&super::manifest::Manifest>,
    faults: &Faults,
) {
    let pending = root.restore_pending();
    let removed = faults
        .at_startup(StartupStep::DiscardRemove)
        .and_then(|()| remove_with_retry(&pending));
    if let Err(e) = removed {
        eprintln!("startup: cannot remove restore-pending: {:?}", e.kind());
        let stamp = BackupName::new(clock.now(), BackupKind::Manual).stamp();
        if let Err(e) = rename_with_retry(&pending, &root.restore_pending_discarded(&stamp)) {
            eprintln!("startup: cannot set restore-pending aside: {:?}", e.kind());
        }
    }
    write_report(
        root,
        RestoreOutcome::Failed,
        clock.now(),
        manifest.map(|m| m.created_at.clone()),
        manifest.map(|m| m.kind),
    );
}

/// Native blocking message (French text of spec 4.8). A no-op under `cfg(test)`.
fn show_blocking_message(root: &DataRoot) {
    dialogs::show_startup_blocked(root.path());
}

/// Native blocking message for a restoration that could not be confirmed. A no-op under
/// `cfg(test)`.
fn show_confirm_failed_message(root: &DataRoot) {
    dialogs::show_confirm_failed(root.path());
}

/// R6 (spec D8): the database is absent while at least one archive (valid name, regular file)
/// exists in `backups\`.
pub fn detect_missing_db(root: &DataRoot) -> bool {
    if present(&root.db()).unwrap_or(true) {
        return false;
    }
    let Ok(entries) = fs::read_dir(root.backups()) else {
        return false;
    };
    entries.flatten().any(|entry| {
        entry.file_type().is_ok_and(|t| t.is_file())
            && entry
                .file_name()
                .to_str()
                .is_some_and(|name| BackupName::parse(name).is_some())
    })
}

/// `1 <= current < supported`: only a database that exists, has been migrated at least once, and
/// is older than the binary.
pub fn pre_migration_needed(current: Option<i64>, supported: i64) -> bool {
    matches!(current, Some(v) if v >= 1 && v < supported)
}

/// The file starts with the SQLite header. Anything else is never opened (opening a foreign file
/// next to leftover companions could touch them), the SQL plugin will report it.
fn has_sqlite_header(path: &std::path::Path) -> bool {
    use std::io::Read;
    let mut header = [0u8; 16];
    fs::File::open(path)
        .and_then(|mut f| f.read_exact(&mut header))
        .is_ok()
        && &header == b"SQLite format 3\0"
}

fn pre_migration(root: &DataRoot, clock: &dyn Clock) {
    if !has_sqlite_header(&root.db()) {
        return;
    }
    let current = match tauri::async_runtime::block_on(read_schema_version(&root.db())) {
        Ok(current) => current,
        Err(e) => {
            // Valid header but unreadable: the SQL plugin would migrate it with no safety copy,
            // so the marker tells the user (the startup goes on, as for a failed copy).
            eprintln!("startup: cannot read the schema version: {e:?}");
            if let Err(e) = write_pre_migration_failed(root, clock.now()) {
                eprintln!(
                    "startup: cannot write pre-migration-failed.json: {:?}",
                    e.kind()
                );
            }
            return;
        }
    };
    if !pre_migration_needed(current, supported_schema_version()) {
        return;
    }
    match tauri::async_runtime::block_on(create_backup(root, clock, BackupKind::PreMigration, &[]))
    {
        Ok(_) => {
            if let Err(e) = clear_pre_migration_failed(root) {
                eprintln!(
                    "startup: cannot remove pre-migration-failed.json: {:?}",
                    e.kind()
                );
            }
        }
        Err(e) => {
            // The startup goes on: the migration is not blocked by a failed safety copy.
            eprintln!("startup: pre-migration backup failed: {e:?}");
            if let Err(e) = write_pre_migration_failed(root, clock.now()) {
                eprintln!(
                    "startup: cannot write pre-migration-failed.json: {:?}",
                    e.kind()
                );
            }
        }
    }
}

/// What the plugin does on `StartupBlocked`, before returning the setup error: journal, marker,
/// native message.
pub fn report_blocked(root: &DataRoot, clock: &dyn Clock, blocked: &StartupBlocked) {
    eprintln!("startup: {blocked}");
    if let Err(e) = write_startup_blocked(root, clock.now(), blocked.reason) {
        eprintln!("startup: cannot write startup-blocked.json: {:?}", e.kind());
    }
    show_blocking_message(root);
}

/// Internal plugin: runs the startup sequence in its setup and manages `BackupState`. An `Err`
/// aborts the plugin initialisation, so `tauri_plugin_sql` (registered after it) never runs.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("homebase-backup")
        .setup(|app, _api| {
            let root = DataRoot::new(app.path().app_config_dir()?);
            // Before anything else, and without touching a single file of the root: a second
            // instance stops here (no marker, no exchange, the SQL plugin never initialises).
            let process_lock = lock::acquire(&root)?;
            let clock: Arc<dyn Clock> = Arc::new(SystemClock);
            match startup_sequence(&root, clock.as_ref()) {
                Ok(outcome) => {
                    app.manage(
                        BackupState::new(root, clock, outcome.swap_info)
                            .with_process_lock(process_lock),
                    );
                    Ok(())
                }
                Err(blocked) => {
                    report_blocked(&root, clock.as_ref(), &blocked);
                    Err(Box::new(blocked))
                }
            }
        })
        .build()
}

/// First call of the app `.setup()`, before `tray::setup`: confirms a restoration done in this
/// process and propagates the error (Tauri then stops the application).
pub fn on_app_ready<R: Runtime>(app: &AppHandle<R>) -> Result<(), Box<dyn std::error::Error>> {
    let state = app.state::<BackupState>();
    if let Err(e) = confirm_restore(&state.root, state.clock.as_ref(), state.swap_info.as_ref()) {
        // Tauri creates the `main` window before `.setup()` and the SQL plugin has already opened
        // the restored database; the message box pumps messages, so the WebView could load
        // Angular and accept data that the next rollback would lose. The main thread is blocked
        // here (the front is not running yet): destroy the window before showing anything.
        if let Some(window) = app.get_webview_window("main") {
            if let Err(e) = window.destroy() {
                eprintln!("startup: cannot destroy the main window: {e}");
            }
        }
        show_confirm_failed_message(&state.root);
        return Err(Box::new(e));
    }
    super::daily::spawn(app);
    Ok(())
}

/// `RunEvent::Exit`: stops the daily thread cleanly.
pub fn on_exit<R: Runtime>(app: &AppHandle<R>) {
    if let Some(state) = app.try_state::<BackupState>() {
        super::daily::shutdown(&state);
    }
}
