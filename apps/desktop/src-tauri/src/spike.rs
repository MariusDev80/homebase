//! Feasibility spike: scheduled native notification, autostart.
//!
//! Notification title/body are fixed here (French, hard-coded for the spike;
//! native i18n is out of scope) and never built from user input.

use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Runtime};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_notification::NotificationExt;

pub const MIN_DELAY_SECS: u32 = 1;
pub const MAX_DELAY_SECS: u32 = 3600;

const NOTIFICATION_TITLE: &str = "Homebase";
const NOTIFICATION_BODY: &str = "Notification de test planifiée par Homebase.";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SpikeError {
    /// The requested delay is outside `MIN_DELAY_SECS..=MAX_DELAY_SECS`.
    #[serde(rename_all = "camelCase")]
    DelayOutOfRange { min: u32, max: u32, got: u32 },
    /// An error reported by a plugin.
    #[serde(rename_all = "camelCase")]
    Plugin { message: String },
}

/// Pure validation of the delay bound, independent from Tauri.
pub fn validate_delay(delay_secs: u32) -> Result<Duration, SpikeError> {
    if (MIN_DELAY_SECS..=MAX_DELAY_SECS).contains(&delay_secs) {
        Ok(Duration::from_secs(u64::from(delay_secs)))
    } else {
        Err(SpikeError::DelayOutOfRange {
            min: MIN_DELAY_SECS,
            max: MAX_DELAY_SECS,
            got: delay_secs,
        })
    }
}

fn plugin_error(error: impl std::fmt::Display) -> SpikeError {
    SpikeError::Plugin {
        message: error.to_string(),
    }
}

#[tauri::command]
pub fn schedule_test_notification<R: Runtime>(
    app: AppHandle<R>,
    delay_secs: u32,
) -> Result<(), SpikeError> {
    let delay = validate_delay(delay_secs)?;
    // Spike: one sleeping thread per notification (no new dependency; tauri's
    // async runtime has no timer without enabling tokio's `time` feature).
    std::thread::spawn(move || {
        std::thread::sleep(delay);
        if let Err(error) = app
            .notification()
            .builder()
            .title(NOTIFICATION_TITLE)
            .body(NOTIFICATION_BODY)
            .show()
        {
            eprintln!("could not show scheduled notification: {error}");
        }
    });
    Ok(())
}

#[tauri::command]
pub fn get_autostart<R: Runtime>(app: AppHandle<R>) -> Result<bool, SpikeError> {
    app.autolaunch().is_enabled().map_err(plugin_error)
}

#[tauri::command]
pub fn set_autostart<R: Runtime>(app: AppHandle<R>, enabled: bool) -> Result<(), SpikeError> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable()
    } else {
        manager.disable()
    }
    .map_err(plugin_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_zero() {
        assert!(matches!(
            validate_delay(0),
            Err(SpikeError::DelayOutOfRange { got: 0, .. })
        ));
    }

    #[test]
    fn accepts_bounds() {
        assert_eq!(validate_delay(1), Ok(Duration::from_secs(1)));
        assert_eq!(validate_delay(3600), Ok(Duration::from_secs(3600)));
    }

    #[test]
    fn rejects_above_max() {
        assert!(matches!(
            validate_delay(3601),
            Err(SpikeError::DelayOutOfRange { got: 3601, .. })
        ));
    }

    #[test]
    fn error_serializes_with_kind() {
        let json = serde_json::to_string(&validate_delay(0).unwrap_err()).unwrap();
        assert_eq!(
            json,
            r#"{"kind":"delayOutOfRange","min":1,"max":3600,"got":0}"#
        );
    }
}
