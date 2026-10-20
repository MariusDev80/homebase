use tauri_build::{AppManifest, Attributes};

fn main() {
    tauri_build::try_build(
        Attributes::new().app_manifest(AppManifest::new().commands(&[
            "schedule_test_notification",
            "get_autostart",
            "set_autostart",
        ])),
    )
    .expect("failed to run tauri-build");
}
