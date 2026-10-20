use tauri_plugin_sql::{Migration, MigrationKind};

/// Must be identical to plugins.sql.preload (tauri.conf.json) and to DB_URL (front).
pub const DB_URL: &str = "sqlite:homebase.db";

/// One entry per V<n>__<name>.sql file, in order, no gap. Never modify an existing entry.
pub fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "init",
        sql: include_str!("../migrations/V1__init.sql"),
        kind: MigrationKind::Up,
    }]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::BTreeMap, fs, path::Path};

    fn files() -> BTreeMap<i64, (String, String)> {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("migrations");
        let mut out = BTreeMap::new();
        for entry in fs::read_dir(&dir).expect("migrations dir") {
            let name = entry
                .expect("entry")
                .file_name()
                .into_string()
                .expect("utf-8 name");
            let Some(stem) = name.strip_suffix(".sql") else {
                continue;
            };
            let (v, desc) = stem
                .strip_prefix('V')
                .and_then(|s| s.split_once("__"))
                .unwrap_or_else(|| panic!("bad migration file name: {name}"));
            let version: i64 = v
                .parse()
                .unwrap_or_else(|_| panic!("bad version in {name}"));
            let sql = fs::read_to_string(dir.join(&name)).expect("read sql");
            assert!(
                out.insert(version, (desc.to_owned(), sql)).is_none(),
                "duplicate version {version}"
            );
        }
        out
    }

    #[test]
    fn registered_migrations_match_files_exactly() {
        let files = files();
        let registered = migrations();
        assert_eq!(
            files.len(),
            registered.len(),
            "every V*.sql must be registered in db.rs and vice versa"
        );
        for (i, m) in registered.iter().enumerate() {
            assert_eq!(
                m.version,
                i as i64 + 1,
                "versions must be contiguous from 1"
            );
            let (desc, sql) = files.get(&m.version).expect("file for registered version");
            assert_eq!(m.description, desc);
            assert_eq!(m.sql, sql);
            assert!(matches!(m.kind, MigrationKind::Up));
        }
    }

    #[test]
    fn preload_contains_db_url() {
        let conf =
            fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json"))
                .expect("conf");
        let json: serde_json::Value = serde_json::from_str(&conf).expect("valid json");
        let preload = json["plugins"]["sql"]["preload"]
            .as_array()
            .expect("plugins.sql.preload");
        assert_eq!(preload.len(), 1);
        assert_eq!(preload[0].as_str(), Some(DB_URL));
    }
}
