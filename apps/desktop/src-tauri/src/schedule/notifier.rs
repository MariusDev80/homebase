//! Delivery of toasts (spec D9). The scheduler only knows the `Notifier` trait.

use super::notice::Toast;
use tauri::{AppHandle, Runtime};
use tauri_plugin_notification::NotificationExt;

/// Errors are logged, never propagated: a toast that cannot be shown must not stop the
/// scheduler. Implementations never log the toast text (it contains user titles).
pub trait Notifier: Send + Sync {
    fn show(&self, toast: &Toast);
}

/// Shows toasts with the Tauri notification plugin (Rust side only, no JS permission).
pub struct TauriNotifier<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> TauriNotifier<R> {
    pub fn new(app: AppHandle<R>) -> Self {
        Self { app }
    }
}

impl<R: Runtime> Notifier for TauriNotifier<R> {
    fn show(&self, toast: &Toast) {
        let result = self
            .app
            .notification()
            .builder()
            .title(&toast.title)
            .body(&toast.body)
            .sound(toast.sound)
            .show();
        if result.is_err() {
            eprintln!("schedule: showing a notification failed");
        }
    }
}

/// Test double: keeps every toast it is given.
#[cfg(test)]
#[derive(Default)]
pub struct RecordingNotifier {
    pub shown: std::sync::Mutex<Vec<Toast>>,
}

#[cfg(test)]
impl Notifier for RecordingNotifier {
    fn show(&self, toast: &Toast) {
        if let Ok(mut shown) = self.shown.lock() {
            shown.push(toast.clone());
        }
    }
}
