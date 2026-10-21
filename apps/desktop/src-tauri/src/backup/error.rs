use serde::Serialize;
use std::io;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum BackupError {
    Busy,
    RestartPending,
    #[allow(dead_code)] // used from lot B3
    NotFound,
    #[allow(dead_code)] // used from lot B3
    InvalidId,
    NoDatabase,
    TooLarge,
    DiskFull,
    InvalidArchive {
        problem: ArchiveProblem,
    },
    #[allow(dead_code)] // used from lot B2a
    SchemaTooNew {
        archive: i64,
        supported: i64,
    },
    #[allow(dead_code)] // used from lot B4a
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
#[allow(dead_code)] // used from lot B2a
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
#[allow(dead_code)] // used from lot B4a
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

/// SQLITE_FULL (13) maps to `DiskFull`; other database errors keep their SQLite code only.
impl From<sqlx::Error> for BackupError {
    fn from(e: sqlx::Error) -> Self {
        if let sqlx::Error::Io(io_error) = e {
            return io_error.into();
        }
        let code = e
            .as_database_error()
            .and_then(|d| d.code())
            .map(|c| c.into_owned())
            .unwrap_or_else(|| "other".to_owned());
        // Raw messages stay on stderr; only the code reaches the front.
        if code == "13" {
            eprintln!("backup: sqlite disk full");
            return BackupError::DiskFull;
        }
        eprintln!("backup: database error: {e}");
        BackupError::Database { code }
    }
}

impl From<zip::result::ZipError> for BackupError {
    fn from(e: zip::result::ZipError) -> Self {
        match e {
            zip::result::ZipError::Io(io_error) => io_error.into(),
            other => {
                eprintln!("backup: zip error: {other}");
                BackupError::Io { code: "zip".into() }
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
