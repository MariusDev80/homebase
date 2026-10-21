//! `manifest.json` (spec 4.2).

use super::names::BackupKind;
use serde::{Deserialize, Serialize};

pub const MANIFEST_FORMAT: &str = "homebase/backup";
pub const MANIFEST_VERSION: u32 = 1;
pub const MANIFEST_ENTRY: &str = "manifest.json";
pub const DB_ENTRY: &str = "homebase.db";
pub const IMAGES_PREFIX: &str = "images/";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub format: String,
    pub format_version: u32,
    pub created_at: String,
    pub kind: BackupKind,
    pub app_version: String,
    pub schema_version: i64,
    pub includes_images: bool,
    pub files: Vec<ManifestFile>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManifestFile {
    pub path: String,
    pub size: u64,
    /// 64 lowercase hexadecimal characters.
    pub sha256: String,
}

impl Manifest {
    /// Number of `images/` entries.
    pub fn image_count(&self) -> u32 {
        self.files
            .iter()
            .filter(|f| f.path.starts_with(IMAGES_PREFIX))
            .count() as u32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn camel_case_and_unknown_fields_rejected() {
        let json = r#"{"format":"homebase/backup","formatVersion":1,"createdAt":"2026-10-21T08:15:00.123Z","kind":"pre-import","appVersion":"0.0.0","schemaVersion":3,"includesImages":false,"files":[{"path":"homebase.db","size":1,"sha256":"00"}]}"#;
        let m: Manifest = serde_json::from_str(json).expect("parse");
        assert_eq!(m.kind, BackupKind::PreImport);
        assert_eq!(m.image_count(), 0);
        let extra = json.replace("\"files\"", "\"extra\":1,\"files\"");
        assert!(serde_json::from_str::<Manifest>(&extra).is_err());
        let file_extra = json.replace("\"size\":1", "\"size\":1,\"mode\":0");
        assert!(serde_json::from_str::<Manifest>(&file_extra).is_err());
    }
}
