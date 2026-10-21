//! Archive validation, extraction and inspection of the restored database (spec 4.7).
//!
//! Checks 1 to 7 are done by `archive::open_validated`; this module adds the extraction (step 8)
//! and the inspection (step 9). Output paths are always built here, never from archive names.

use super::archive::{open_validated, Limits};
use super::create::blocking;
use super::error::{ArchiveProblem, BackupError};
use super::fsutil::{image_signature_matches, remove_with_retry, write_json_atomic};
use super::manifest::{Manifest, DB_ENTRY, IMAGES_PREFIX, MANIFEST_ENTRY};
use super::sqlite::supported_schema_version;
use sha2::{Digest, Sha256, Sha384};
use sqlx::sqlite::{SqliteConnectOptions, SqliteRow};
use sqlx::{Connection, Row, SqliteConnection};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::str::FromStr;

const COPY_BLOCK: usize = 64 * 1024;

/// Exact DDL of `_sqlx_migrations` as created by sqlx-sqlite 0.8.6 (`migrate.rs`).
pub const SQLX_MIGRATIONS_DDL: &str = "
CREATE TABLE IF NOT EXISTS _sqlx_migrations (
    version BIGINT PRIMARY KEY,
    description TEXT NOT NULL,
    installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    success BOOLEAN NOT NULL,
    checksum BLOB NOT NULL,
    execution_time BIGINT NOT NULL
);
";

/// `(name, type, notnull, pk, hidden)` of `pragma_table_xinfo('_sqlx_migrations')`, in `cid` order (V25).
pub const V25_COLUMNS: [(&str, &str, i64, i64, i64); 6] = [
    ("version", "BIGINT", 0, 1, 0),
    ("description", "TEXT", 1, 0, 0),
    ("installed_on", "TIMESTAMP", 1, 0, 0),
    ("success", "BOOLEAN", 1, 0, 0),
    ("checksum", "BLOB", 1, 0, 0),
    ("execution_time", "BIGINT", 1, 0, 0),
];

/// `(type, name, tbl_name, sql)` of one `sqlite_schema` row.
pub type SchemaRow = (String, String, String, Option<String>);

const STAT1_SQL: &str = "CREATE TABLE sqlite_stat1(tbl,idx,stat)";
const STAT4_SQL: &str = "CREATE TABLE sqlite_stat4(tbl,idx,neq,nlt,ndlt,sample)";

/// Rows tolerated in addition to `expected_schema(v)` (spec 4.7, step 9.4). `_sqlx_migrations`
/// and its autoindex are part of `expected_schema`, with the exact sqlx DDL.
fn allowed_extra_rows() -> Vec<SchemaRow> {
    let row = |n: &str, sql: &str| -> SchemaRow {
        ("table".into(), n.into(), n.into(), Some(sql.into()))
    };
    vec![
        row("sqlite_stat1", STAT1_SQL),
        row("sqlite_stat4", STAT4_SQL),
    ]
}

fn invalid(problem: ArchiveProblem) -> BackupError {
    BackupError::InvalidArchive { problem }
}

fn unexpected() -> BackupError {
    invalid(ArchiveProblem::UnexpectedSchema)
}

fn to_hex(digest: &[u8]) -> String {
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// Removes the directory on drop unless disarmed: also runs on panic or cancellation.
struct DestGuard {
    path: PathBuf,
    armed: bool,
}

impl Drop for DestGuard {
    fn drop(&mut self) {
        if self.armed {
            let _ = remove_with_retry(&self.path);
        }
    }
}

/// Validates the archive (checks 1 to 7), extracts it into `dest` (which must not exist) and
/// inspects the restored database. On any failure `dest` is removed (only if we created it).
pub async fn extract_validated(archive: &Path, dest: &Path) -> Result<Manifest, BackupError> {
    extract_validated_with(archive, dest, &Limits::default()).await
}

pub async fn extract_validated_with(
    archive: &Path,
    dest: &Path,
    limits: &Limits,
) -> Result<Manifest, BackupError> {
    // Fails with AlreadyExists when `dest` is there: nothing of ours to clean up then.
    fs::create_dir(dest)?;
    extract_and_inspect(archive.to_owned(), dest.to_owned(), *limits).await
}

async fn extract_and_inspect(
    archive: PathBuf,
    dest: PathBuf,
    limits: Limits,
) -> Result<Manifest, BackupError> {
    let mut guard = DestGuard {
        path: dest.clone(),
        armed: true,
    };
    let extracted = {
        let (archive, dest) = (archive, dest.clone());
        blocking(move || extract(&archive, &dest, &limits)).await
    };
    let result = match extracted {
        Ok(Ok(manifest)) => {
            // The inspection runs on a blocking thread with its own `block_on`: its sqlx future
            // cannot be proven `Send` by rustc ("not general enough") and must not be part of
            // the futures the Tauri commands await.
            let db = dest.join(DB_ENTRY);
            let inspected = blocking(move || {
                tauri::async_runtime::block_on(inspect_restored_database(&db, &manifest))
                    .map(|_| manifest)
            })
            .await;
            match inspected {
                Ok(result) => result,
                Err(e) => Err(e),
            }
        }
        Ok(Err(e)) => Err(e),
        Err(e) => Err(e),
    };
    if result.is_err() {
        let path = dest;
        let _ = blocking(move || remove_with_retry(&path)).await;
    }
    guard.armed = false;
    result
}

/// Steps 1 to 8: checks, then extraction into the existing, empty `dest`. Blocking.
fn extract(archive: &Path, dest: &Path, limits: &Limits) -> Result<Manifest, BackupError> {
    let (mut zip, manifest) = open_validated(archive, limits)?;
    // Maps each central-directory index to the manifest entry of the same name.
    for index in 0..zip.len() {
        let name = {
            let raw = zip
                .by_index_raw(index)
                .map_err(|_| invalid(ArchiveProblem::CorruptEntry))?;
            std::str::from_utf8(raw.name_raw())
                .map_err(|_| invalid(ArchiveProblem::UnexpectedEntry))?
                .to_owned()
        };
        if name == MANIFEST_ENTRY {
            continue;
        }
        let Some(expected) = manifest.files.iter().find(|f| f.path == name) else {
            return Err(invalid(ArchiveProblem::ManifestMismatch));
        };
        // The output path is built here from the validated name, never taken from the archive.
        let (target, image_ext) = match name.strip_prefix(IMAGES_PREFIX) {
            Some(image) => {
                let images = dest.join("images");
                fs::create_dir_all(&images)?;
                let ext = image.rsplit('.').next().unwrap_or_default().to_owned();
                (images.join(image), Some(ext))
            }
            None => (dest.join(DB_ENTRY), None),
        };
        let mut out = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)?;
        let entry = zip
            .by_index(index)
            .map_err(|_| invalid(ArchiveProblem::CorruptEntry))?;
        let mut reader = entry.take(expected.size + 1);
        let mut hasher = Sha256::new();
        let mut header: Vec<u8> = Vec::with_capacity(12);
        let mut buf = vec![0u8; COPY_BLOCK];
        let mut count: u64 = 0;
        loop {
            let n = reader
                .read(&mut buf)
                .map_err(|_| invalid(ArchiveProblem::CorruptEntry))?;
            if n == 0 {
                break;
            }
            count += n as u64;
            if count > expected.size {
                return Err(invalid(ArchiveProblem::SizeMismatch));
            }
            if header.len() < 12 {
                header.extend_from_slice(&buf[..n.min(12 - header.len())]);
            }
            hasher.update(&buf[..n]);
            out.write_all(&buf[..n])?;
        }
        if count != expected.size {
            return Err(invalid(ArchiveProblem::SizeMismatch));
        }
        if to_hex(&hasher.finalize()) != expected.sha256 {
            return Err(invalid(ArchiveProblem::ChecksumMismatch));
        }
        if let Some(ext) = image_ext {
            if !image_signature_matches(&ext, &header) {
                return Err(invalid(ArchiveProblem::ImageTypeMismatch));
            }
        }
        out.flush()?;
        out.sync_all()?;
    }
    write_json_atomic(&dest.join(MANIFEST_ENTRY), &manifest)?;
    Ok(manifest)
}

/// Typed column access: a value of another type (e.g. a BLOB in `sqlite_schema.sql`) is a
/// schema anomaly, never a panic.
fn col<'r, T>(row: &'r SqliteRow, index: usize) -> Result<T, BackupError>
where
    T: sqlx::Decode<'r, sqlx::Sqlite> + sqlx::Type<sqlx::Sqlite>,
{
    row.try_get(index).map_err(|_| unexpected())
}

async fn read_schema(conn: &mut SqliteConnection) -> Result<Vec<SchemaRow>, BackupError> {
    let rows =
        sqlx::query("SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name")
            .fetch_all(conn)
            .await?;
    rows.iter()
        .map(|r| Ok((col(r, 0)?, col(r, 1)?, col(r, 2)?, col(r, 3)?)))
        .collect()
}

/// `sqlite_schema` of a fresh in-memory database with the exact sqlx `_sqlx_migrations` DDL and
/// migrations `1..=version` of this binary (autoindexes and `sqlite_sequence` included).
pub async fn expected_schema(version: i64) -> Result<Vec<SchemaRow>, BackupError> {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")?;
    let mut conn = SqliteConnection::connect_with(&options).await?;
    let result = async {
        sqlx::raw_sql(SQLX_MIGRATIONS_DDL)
            .execute(&mut conn)
            .await?;
        for m in crate::db::migrations()
            .into_iter()
            .filter(|m| m.version <= version)
        {
            sqlx::raw_sql(m.sql).execute(&mut conn).await?;
        }
        read_schema(&mut conn).await
    }
    .await;
    let closed = conn.close().await;
    let rows = result?;
    closed?;
    Ok(rows)
}

/// Primary result code 11 (SQLITE_CORRUPT) or 26 (SQLITE_NOTADB), extended codes included,
/// while reading means a damaged file.
fn corruption(e: BackupError) -> BackupError {
    match &e {
        BackupError::Database { code }
            if code
                .parse::<i64>()
                .is_ok_and(|c| matches!(c & 0xFF, 11 | 26)) =>
        {
            invalid(ArchiveProblem::IntegrityFailed)
        }
        _ => e,
    }
}

/// Step 9 of spec 4.7, in the imposed order. Read-only, immutable, `trusted_schema=OFF`.
/// Returns the schema version of the database.
pub async fn inspect_restored_database(db: &Path, manifest: &Manifest) -> Result<i64, BackupError> {
    let options = SqliteConnectOptions::new()
        .filename(db)
        .read_only(true)
        .immutable(true)
        .pragma("trusted_schema", "OFF")
        .pragma("cell_size_check", "ON")
        .pragma("mmap_size", "0");
    let mut conn = SqliteConnection::connect_with(&options)
        .await
        .map_err(|_| invalid(ArchiveProblem::NotSqlite))?;
    let result = inspect(&mut conn, manifest).await;
    let _ = conn.close().await;
    result
}

async fn inspect(conn: &mut SqliteConnection, manifest: &Manifest) -> Result<i64, BackupError> {
    // 1. integrity
    let rows = sqlx::query("PRAGMA integrity_check")
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| {
            let e = BackupError::from(e);
            match &e {
                BackupError::Database { code }
                    if code.parse::<i64>().is_ok_and(|c| c & 0xFF == 26) =>
                {
                    invalid(ArchiveProblem::NotSqlite)
                }
                _ => corruption(e),
            }
        })?;
    let ok = rows.len() == 1 && rows[0].try_get::<String, _>(0).is_ok_and(|s| s == "ok");
    if !ok {
        return Err(invalid(ArchiveProblem::IntegrityFailed));
    }

    // 2. `_sqlx_migrations` must be a genuine table with the exact V25 columns.
    let rows = sqlx::query("SELECT type, sql FROM sqlite_schema WHERE name = '_sqlx_migrations'")
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| corruption(e.into()))?;
    if rows.is_empty() {
        return Err(invalid(ArchiveProblem::NotHomebase));
    }
    if rows.len() != 1 {
        return Err(unexpected());
    }
    let kind: String = col(&rows[0], 0)?;
    let migrations_sql: Option<String> = col(&rows[0], 1)?;
    if kind != "table" || !migrations_sql.is_some_and(|s| s.starts_with("CREATE TABLE ")) {
        return Err(unexpected());
    }
    let columns = sqlx::query(
        "SELECT name, type, \"notnull\", pk, hidden FROM pragma_table_xinfo('_sqlx_migrations') ORDER BY cid",
    )
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| corruption(e.into()))?;
    let actual = columns
        .iter()
        .map(|r| {
            Ok::<_, BackupError>((
                col::<String>(r, 0)?,
                col::<String>(r, 1)?,
                col::<i64>(r, 2)?,
                col::<i64>(r, 3)?,
                col::<i64>(r, 4)?,
            ))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let wanted: Vec<(String, String, i64, i64, i64)> = V25_COLUMNS
        .iter()
        .map(|(a, b, c, d, e)| ((*a).to_owned(), (*b).to_owned(), *c, *d, *e))
        .collect();
    if actual != wanted {
        return Err(unexpected());
    }

    // 3. history, through aggregates so that a huge table is never loaded.
    let summary = sqlx::query(
        "SELECT count(*), min(CAST(version AS INTEGER)), max(CAST(version AS INTEGER)), \
         sum(typeof(version) <> 'integer'), sum(CAST(success AS INTEGER) = 0) FROM _sqlx_migrations",
    )
    .fetch_one(&mut *conn)
    .await
    .map_err(|e| corruption(e.into()))?;
    let count: i64 = col(&summary, 0)?;
    let min: Option<i64> = col(&summary, 1)?;
    let version: i64 = col::<Option<i64>>(&summary, 2)?.unwrap_or(0);
    let non_integer: i64 = col::<Option<i64>>(&summary, 3)?.unwrap_or(0);
    let failed: i64 = col::<Option<i64>>(&summary, 4)?.unwrap_or(0);
    if failed > 0 {
        return Err(invalid(ArchiveProblem::DirtyMigration));
    }
    // `version` is unique (primary key): `count` integers from 1 to `version` is exactly 1..=v.
    if non_integer > 0 || version < 1 || min != Some(1) || count != version {
        return Err(invalid(ArchiveProblem::UnknownMigration));
    }
    let supported = supported_schema_version();
    if version > supported {
        return Err(BackupError::SchemaTooNew {
            archive: version,
            supported,
        });
    }
    let rows = sqlx::query(
        "SELECT version, CAST(checksum AS BLOB) FROM _sqlx_migrations ORDER BY version LIMIT ?1",
    )
    .bind(supported)
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| corruption(e.into()))?;
    let known = crate::db::migrations();
    for r in &rows {
        let (v, checksum): (i64, Vec<u8>) = (col(r, 0)?, col(r, 1)?);
        let Some(m) = known.iter().find(|m| m.version == v) else {
            return Err(invalid(ArchiveProblem::UnknownMigration));
        };
        if Sha384::digest(m.sql.as_bytes()).as_slice() != checksum.as_slice() {
            return Err(invalid(ArchiveProblem::UnknownMigration));
        }
    }

    // 4. complete schema, no filter on names.
    let mut actual_rows = read_schema(&mut *conn).await.map_err(corruption)?;
    for extra in allowed_extra_rows() {
        if let Some(pos) = actual_rows.iter().position(|r| *r == extra) {
            actual_rows.remove(pos);
        }
    }
    if actual_rows != expected_schema(version).await? {
        return Err(unexpected());
    }

    // 5. foreign keys
    let violations = sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| corruption(e.into()))?;
    if !violations.is_empty() {
        return Err(invalid(ArchiveProblem::ForeignKeyViolation));
    }

    // 6. manifest
    if manifest.schema_version != version {
        return Err(invalid(ArchiveProblem::ManifestMismatch));
    }
    Ok(version)
}
