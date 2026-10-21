use serde::Serialize;
use std::io;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum BackupError {
    Busy,
    RestartPending,
    NotFound,
    InvalidId,
    NoDatabase,
    TooLarge,
    DiskFull,
    InvalidArchive {
        problem: ArchiveProblem,
    },
    SchemaTooNew {
        archive: i64,
        supported: i64,
    },
    InvalidImport {
        problem: ImportProblem,
    },
    /// `io::ErrorKind` name or internal code; never a path.
    Io {
        code: String,
    },
    /// Extended SQLite code or "other".
    Database {
        code: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ArchiveProblem {
    NotZip,
    Zip64,
    TooManyEntries,
    OverlappingEntries,
    UnexpectedEntry,
    DuplicateEntry,
    EncryptedEntry,
    UnsupportedCompression,
    EntryTooLarge,
    TotalTooLarge,
    MissingManifest,
    MissingDatabase,
    InvalidManifest,
    UnsupportedFormat,
    ManifestMismatch,
    SizeMismatch,
    ChecksumMismatch,
    CorruptEntry,
    ImageTypeMismatch,
    NotSqlite,
    IntegrityFailed,
    NotHomebase,
    UnexpectedSchema,
    DirtyMigration,
    UnknownMigration,
    ForeignKeyViolation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportProblem {
    NotConfig,
    NotUtf8,
    NoDashboard,
    TooManyDashboards,
    TooManyWidgets,
    TooManySettings,
    InvalidId,
    DuplicateId,
    InvalidName,
    InvalidWidgetType,
    InvalidGrid,
    InvalidSortOrder,
    InvalidConfig,
    InvalidConfigVersion,
    InvalidSettingKey,
    SecretSetting,
    InvalidSettingValue,
    Constraint,
}

impl From<io::Error> for BackupError {
    fn from(e: io::Error) -> Self {
        if e.kind() == io::ErrorKind::StorageFull {
            BackupError::DiskFull
        } else {
            BackupError::Io {
                code: format!("{:?}", e.kind()),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_full_maps_to_disk_full() {
        let e: BackupError = io::Error::from(io::ErrorKind::StorageFull).into();
        assert_eq!(e, BackupError::DiskFull);
    }

    #[test]
    fn io_error_carries_kind_only() {
        let e: BackupError = io::Error::new(io::ErrorKind::AlreadyExists, "C:/secret/path").into();
        assert_eq!(
            e,
            BackupError::Io {
                code: "AlreadyExists".into()
            }
        );
    }

    #[test]
    fn serialization_shape() {
        let json = serde_json::to_string(&BackupError::InvalidArchive {
            problem: ArchiveProblem::NotZip,
        })
        .expect("json");
        assert_eq!(json, r#"{"kind":"invalid_archive","problem":"not_zip"}"#);
        assert_eq!(
            serde_json::to_string(&BackupError::Busy).expect("json"),
            r#"{"kind":"busy"}"#
        );
    }
}
