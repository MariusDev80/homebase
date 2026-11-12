//! Guard tests on `capabilities/default.json`: any change to the permissions of the main
//! window must be deliberate and updates this file in the same commit.

use serde_json::Value;
use std::{fs, path::Path};

fn default_capability() -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities/default.json");
    serde_json::from_str(&fs::read_to_string(path).expect("read default.json")).expect("valid json")
}

fn permissions() -> Vec<Value> {
    default_capability()["permissions"]
        .as_array()
        .expect("permissions array")
        .clone()
}

fn urls(entry: &Value, key: &str) -> Vec<String> {
    entry[key]
        .as_array()
        .unwrap_or_else(|| panic!("opener scope has no {key}"))
        .iter()
        .map(|e| {
            let object = e.as_object().expect("scope entry is an object");
            assert_eq!(
                object.keys().collect::<Vec<_>>(),
                ["url"],
                "scope entries must only have a `url` key (no `app`, no `path`)"
            );
            object["url"].as_str().expect("url string").to_owned()
        })
        .collect()
}

#[test]
fn main_window_permissions_are_exactly_the_expected_ones() {
    let identifiers: Vec<String> = permissions()
        .iter()
        .map(|p| match p {
            Value::String(s) => s.clone(),
            other => other["identifier"].as_str().expect("identifier").to_owned(),
        })
        .collect();
    assert_eq!(
        identifiers,
        [
            "allow-get-autostart",
            "allow-set-autostart",
            "allow-weather-forecast",
            "allow-weather-geocode",
            "allow-backup-list",
            "allow-backup-create",
            "allow-backup-open-folder",
            "allow-backup-restore",
            "allow-backup-export",
            "allow-backup-pick-external",
            "allow-backup-acknowledge",
            "allow-config-export-save",
            "allow-config-import-pick",
            "allow-config-import-apply",
            "sql:allow-execute",
            "sql:allow-select",
            "opener:allow-open-url",
        ]
    );
}

#[test]
fn opener_is_limited_to_http_and_https_open_url() {
    let serialized = serde_json::to_string(&permissions()).expect("serialize");
    for forbidden in [
        "opener:default",
        "open-path",
        "reveal",
        "mailto",
        "tel:",
        "file:",
    ] {
        assert!(
            !serialized.contains(forbidden),
            "permissions must not mention {forbidden}"
        );
    }

    let permissions = permissions();
    let opener = permissions
        .iter()
        .find(|p| p["identifier"] == "opener:allow-open-url")
        .expect("scoped opener permission");
    assert_eq!(urls(opener, "allow"), ["https://*", "http://*"]);
    assert_eq!(urls(opener, "deny"), ["*\"*", "* *"]);
}

/// True if `text` contains `"http:` followed by something other than `/` (a permission
/// identifier such as `"http:default"`), as opposed to an `"http://*"` URL pattern.
fn mentions_http_permission(text: &str) -> bool {
    text.match_indices("\"http:")
        .any(|(index, found)| !text[index + found.len()..].starts_with('/'))
}

fn read_capability(name: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("capabilities")
        .join(name);
    fs::read_to_string(path).expect("read capability")
}

#[test]
fn no_http_plugin_permission() {
    for name in ["default.json", "debug.json"] {
        assert!(!mentions_http_permission(&read_capability(name)), "{name}");
    }
    assert!(mentions_http_permission(r#"["http:default"]"#));
    assert!(!mentions_http_permission(r#"[{"url":"http://*"}]"#));
}

#[test]
fn capability_files_are_exactly_default_and_debug() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities");
    let mut names: Vec<String> = fs::read_dir(dir)
        .expect("read capabilities dir")
        .map(|entry| {
            entry
                .expect("entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    names.sort();
    assert_eq!(names, ["debug.json", "default.json"]);
}

#[test]
fn cargo_toml_has_no_http_plugin() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml");
    let manifest = fs::read_to_string(path).expect("read Cargo.toml");
    assert!(!manifest.contains("tauri-plugin-http"));
}

#[test]
fn csp_keeps_network_local() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
    let config: Value =
        serde_json::from_str(&fs::read_to_string(path).expect("read tauri.conf.json"))
            .expect("valid json");
    let csp = config["app"]["security"]["csp"]
        .as_str()
        .expect("csp string");
    assert!(csp.contains("connect-src 'self' ipc: http://ipc.localhost;"));
    assert!(!csp.contains("open-meteo"));
}

#[test]
fn no_other_window_or_remote_access() {
    let capability = default_capability();
    assert_eq!(capability["windows"], serde_json::json!(["main"]));
    assert!(capability.get("remote").is_none());
    assert!(capability.get("webviews").is_none());
}

#[test]
fn no_dialog_fs_process_or_shell_permission() {
    for name in ["default.json", "debug.json"] {
        let capability: Value = serde_json::from_str(&read_capability(name)).expect("valid json");
        for permission in capability["permissions"].as_array().expect("permissions") {
            let identifier = match permission {
                Value::String(s) => s.as_str(),
                other => other["identifier"].as_str().expect("identifier"),
            };
            for prefix in ["dialog:", "fs:", "process:", "shell:"] {
                assert!(
                    !identifier.starts_with(prefix),
                    "{name}: forbidden permission {identifier}"
                );
            }
            assert!(
                !identifier.starts_with("opener:") || identifier == "opener:allow-open-url",
                "{name}: unexpected opener permission {identifier}"
            );
        }
    }
}

/// The dialog plugin is registered (Rust side) but exposes nothing to the JS: no `dialog:*`
/// identifier anywhere in a capability file, and no npm package for it.
#[test]
fn dialog_plugin_exposes_nothing_to_the_front() {
    for name in ["default.json", "debug.json"] {
        let capability: Value = serde_json::from_str(&read_capability(name)).expect("valid json");
        let mut text = serde_json::to_string(&capability["permissions"]).expect("serialize");
        text.make_ascii_lowercase();
        assert!(!text.contains("dialog"), "{name}");
        assert!(
            !text.contains("plugin-fs") && !text.contains("fs:"),
            "{name}"
        );
    }
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    for package in ["package.json", "apps/web/package.json"] {
        let text = fs::read_to_string(root.join(package)).expect("package.json");
        assert!(!text.contains("plugin-dialog") && !text.contains("plugin-fs"));
    }
}
