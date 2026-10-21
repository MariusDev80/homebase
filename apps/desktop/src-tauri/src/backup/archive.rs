//! Archive writing and manifest reading (spec 4.4 and 4.7, checks 1 to 7).

use super::error::{ArchiveProblem, BackupError};
use super::fsutil::image_signature_matches;
use super::manifest::{
    Manifest, ManifestFile, DB_ENTRY, IMAGES_PREFIX, MANIFEST_ENTRY, MANIFEST_FORMAT,
    MANIFEST_VERSION,
};
use super::names::{is_image_file_name, BackupKind};
use super::{
    MAX_ARCHIVE_BYTES, MAX_DB_BYTES, MAX_ENTRIES, MAX_IMAGE_BYTES, MAX_MANIFEST_BYTES,
    MAX_TOTAL_UNCOMPRESSED,
};
use crate::time::formats::parse_instant;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use zip::read::{ArchiveOffset, Config};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

const COPY_BLOCK: usize = 64 * 1024;
const EOCD_SIGNATURE: [u8; 4] = [0x50, 0x4B, 0x05, 0x06];
const ZIP64_LOCATOR_SIGNATURE: [u8; 4] = [0x50, 0x4B, 0x06, 0x07];
const EOCD_MIN_LEN: usize = 22;
/// Fixed EOCD record plus the longest possible comment.
const EOCD_SEARCH_LEN: u64 = 65_557;

/// Limits of spec 4.3, injectable so tests can use tiny values.
#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub max_archive_bytes: u64,
    pub max_entries: usize,
    pub max_manifest_bytes: u64,
    pub max_db_bytes: u64,
    pub max_image_bytes: u64,
    pub max_total_uncompressed: u64,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_archive_bytes: MAX_ARCHIVE_BYTES,
            max_entries: MAX_ENTRIES,
            max_manifest_bytes: MAX_MANIFEST_BYTES,
            max_db_bytes: MAX_DB_BYTES,
            max_image_bytes: MAX_IMAGE_BYTES,
            max_total_uncompressed: MAX_TOTAL_UNCOMPRESSED,
        }
    }
}

/// An image accepted for the archive: conforming name, regular file, matching signature.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ImageFile {
    pub name: String,
    pub path: PathBuf,
    pub size: u64,
}

/// First 12 bytes of the file (fewer if it is shorter), read until full or end of file.
fn read_header(file: &mut File) -> io::Result<Vec<u8>> {
    let mut header = Vec::with_capacity(12);
    file.take(12).read_to_end(&mut header)?;
    Ok(header)
}

/// Lists `images/`: regular files only (no symlink), `<uuid>.<ext>` names, matching signature.
/// Anything else is ignored and logged by name. Limits exceeded give `TooLarge`.
/// Blocking; call from `spawn_blocking`.
pub fn inventory_images(dir: &Path, limits: &Limits) -> Result<Vec<ImageFile>, BackupError> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    let mut images = Vec::new();
    let mut total: u64 = 0;
    for entry in entries {
        let entry = entry?;
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            eprintln!("backup: image ignored (name is not UTF-8)");
            continue;
        };
        let path = entry.path();
        let meta = fs::symlink_metadata(&path)?;
        if !meta.is_file() || !is_image_file_name(&name) {
            eprintln!("backup: image ignored (not a conforming regular file): {name}");
            continue;
        }
        let ext = name.rsplit('.').next().unwrap_or_default();
        if !image_signature_matches(ext, &read_header(&mut File::open(&path)?)?) {
            eprintln!("backup: image ignored (signature mismatch): {name}");
            continue;
        }
        let size = meta.len();
        total = total.saturating_add(size);
        if size > limits.max_image_bytes
            || total > limits.max_total_uncompressed
            || images.len() + 3 > limits.max_entries
        {
            return Err(BackupError::TooLarge);
        }
        images.push(ImageFile { name, path, size });
    }
    images.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(images)
}

pub struct ArchiveSpec<'a> {
    pub created_at: String,
    pub kind: BackupKind,
    pub schema_version: i64,
    pub snapshot: &'a Path,
    pub images: &'a [ImageFile],
}

fn changed_during_backup() -> BackupError {
    BackupError::Io {
        code: "changed_during_backup".into(),
    }
}

fn to_hex(digest: &[u8]) -> String {
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// Copies `source` into the current zip entry by 64 KiB blocks, hashing on the fly.
/// The size must stay equal to `expected`.
fn copy_entry<W: Write>(
    out: &mut W,
    path: String,
    source: &Path,
    expected: u64,
    image_ext: Option<&str>,
) -> Result<ManifestFile, BackupError> {
    let mut file = File::open(source)?;
    if let Some(ext) = image_ext {
        // The file may have been replaced since the inventory: check again at copy time.
        if !image_signature_matches(ext, &read_header(&mut file)?) {
            return Err(changed_during_backup());
        }
        file.seek(SeekFrom::Start(0))?;
    }
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; COPY_BLOCK];
    let mut count: u64 = 0;
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        count += n as u64;
        if count > expected {
            return Err(changed_during_backup());
        }
        hasher.update(&buf[..n]);
        out.write_all(&buf[..n])?;
    }
    if count != expected {
        return Err(changed_during_backup());
    }
    Ok(ManifestFile {
        path,
        size: count,
        sha256: to_hex(&hasher.finalize()),
    })
}

/// Writes the archive at `dest` (`create_new`): `homebase.db` (Deflated), images (Stored),
/// `manifest.json` last (Deflated); `finish`, `flush`, `sync_all`. The caller renames it.
/// Blocking; call from `spawn_blocking`.
pub fn write_archive(
    dest: &Path,
    spec: &ArchiveSpec<'_>,
    limits: &Limits,
) -> Result<Manifest, BackupError> {
    let db_size = fs::metadata(spec.snapshot)?.len();
    let images_total: u64 = spec.images.iter().map(|i| i.size).sum();
    if db_size > limits.max_db_bytes
        || db_size.saturating_add(images_total) > limits.max_total_uncompressed
        || spec.images.len() + 2 > limits.max_entries
    {
        return Err(BackupError::TooLarge);
    }
    let file = OpenOptions::new().write(true).create_new(true).open(dest)?;
    let mut zip = ZipWriter::new(file);
    let options = |method| {
        SimpleFileOptions::default()
            .compression_method(method)
            .large_file(false)
    };
    let mut files = Vec::with_capacity(spec.images.len() + 1);

    zip.start_file(DB_ENTRY, options(CompressionMethod::Deflated))?;
    files.push(copy_entry(
        &mut zip,
        DB_ENTRY.to_owned(),
        spec.snapshot,
        db_size,
        None,
    )?);

    // Inventory is sorted by name, so images stay sorted by path after `homebase.db`.
    for image in spec.images {
        let name = format!("{IMAGES_PREFIX}{}", image.name);
        zip.start_file(&name, options(CompressionMethod::Stored))?;
        let ext = image.name.rsplit('.').next().unwrap_or_default();
        files.push(copy_entry(
            &mut zip,
            name.clone(),
            &image.path,
            image.size,
            Some(ext),
        )?);
    }

    let manifest = Manifest {
        format: MANIFEST_FORMAT.to_owned(),
        format_version: MANIFEST_VERSION,
        created_at: spec.created_at.clone(),
        kind: spec.kind,
        app_version: env!("CARGO_PKG_VERSION").to_owned(),
        schema_version: spec.schema_version,
        includes_images: spec.kind.includes_images(),
        files,
    };
    let bytes = serde_json::to_vec_pretty(&manifest).map_err(io::Error::other)?;
    // manifest.json counts in the totals, consistently with the validation (step 5).
    let manifest_size = bytes.len() as u64;
    if manifest_size > limits.max_manifest_bytes
        || db_size
            .saturating_add(images_total)
            .saturating_add(manifest_size)
            > limits.max_total_uncompressed
    {
        return Err(BackupError::TooLarge);
    }
    zip.start_file(MANIFEST_ENTRY, options(CompressionMethod::Deflated))?;
    zip.write_all(&bytes)?;
    let mut file = zip.finish()?;
    file.flush()?;
    file.sync_all()?;
    if file.metadata()?.len() > limits.max_archive_bytes {
        return Err(BackupError::TooLarge);
    }
    Ok(manifest)
}
fn app_version_ok(version: &str) -> bool {
    (1..=64).contains(&version.len())
        && version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+'))
}

fn invalid(problem: ArchiveProblem) -> BackupError {
    BackupError::InvalidArchive { problem }
}

/// Pre-reads the end-of-central-directory record from the tail of the file (spec 4.7 step 2).
/// Returns the declared entry count. Also used by the validation of lot B2a.
pub fn pre_read_eocd(file: &mut File, len: u64, limits: &Limits) -> Result<usize, BackupError> {
    // 20 more bytes so that a zip64 locator right before the EOCD is still in the buffer.
    let tail_len = len.min(EOCD_SEARCH_LEN + 20);
    file.seek(SeekFrom::Start(len - tail_len))?;
    let mut tail = vec![0u8; tail_len as usize];
    file.read_exact(&mut tail)?;
    let Some(pos) = tail
        .windows(4)
        .rposition(|w| w == EOCD_SIGNATURE)
        .filter(|pos| tail.len() - pos >= EOCD_MIN_LEN)
    else {
        return Err(invalid(ArchiveProblem::NotZip));
    };
    let entries = u16::from_le_bytes([tail[pos + 10], tail[pos + 11]]);
    let has_locator = pos >= 20 && tail[pos - 20..pos - 16] == ZIP64_LOCATOR_SIGNATURE;
    if entries == 0xFFFF || has_locator {
        return Err(invalid(ArchiveProblem::Zip64));
    }
    if usize::from(entries) > limits.max_entries {
        return Err(invalid(ArchiveProblem::TooManyEntries));
    }
    Ok(usize::from(entries))
}

fn is_allowed_name(name: &str) -> bool {
    name == MANIFEST_ENTRY
        || name == DB_ENTRY
        || name
            .strip_prefix(IMAGES_PREFIX)
            .is_some_and(is_image_file_name)
}

/// Reads and checks `manifest.json` without extracting anything (spec 4.7, checks 1 to 7).
/// Blocking; call from `spawn_blocking`.
pub fn read_manifest(path: &Path) -> Result<Manifest, BackupError> {
    read_manifest_with(path, &Limits::default())
}

pub fn read_manifest_with(path: &Path, limits: &Limits) -> Result<Manifest, BackupError> {
    open_validated(path, limits).map(|(_, manifest)| manifest)
}

/// The single entry point for checks 1 to 7 of spec 4.7: the validation of lot B2a reuses it to
/// extract from the returned archive. The archive offset is fixed to 0, so no scan of the file
/// happens (a detected offset would read every `PK` signature into memory).
pub fn open_validated(
    path: &Path,
    limits: &Limits,
) -> Result<(ZipArchive<File>, Manifest), BackupError> {
    let mut file = File::open(path)?;
    let len = file.metadata()?.len();
    // 1. size
    if len > limits.max_archive_bytes {
        return Err(BackupError::TooLarge);
    }
    // 2. EOCD
    if len < EOCD_MIN_LEN as u64 {
        return Err(invalid(ArchiveProblem::NotZip));
    }
    let declared = pre_read_eocd(&mut file, len, limits)?;
    // 3. central directory
    file.seek(SeekFrom::Start(0))?;
    let config = Config {
        archive_offset: ArchiveOffset::Known(0),
    };
    let mut archive =
        ZipArchive::with_config(config, file).map_err(|_| invalid(ArchiveProblem::NotZip))?;
    if archive.len() != declared || archive.len() > limits.max_entries {
        return Err(invalid(ArchiveProblem::TooManyEntries));
    }
    // 4. overlaps
    if !matches!(archive.has_overlapping_entries(), Ok(false)) {
        return Err(invalid(ArchiveProblem::OverlappingEntries));
    }
    // 5. per-entry checks (allow-list, duplicates, kind, encryption, method, sizes)
    let mut seen = HashSet::new();
    let mut sizes: BTreeMap<String, u64> = BTreeMap::new();
    let mut manifest_index = None;
    let mut has_db = false;
    let mut total: u64 = 0;
    for index in 0..archive.len() {
        let entry = archive
            .by_index_raw(index)
            .map_err(|_| invalid(ArchiveProblem::CorruptEntry))?;
        let name = std::str::from_utf8(entry.name_raw())
            .map_err(|_| invalid(ArchiveProblem::UnexpectedEntry))?
            .to_owned();
        if !is_allowed_name(&name) {
            return Err(invalid(ArchiveProblem::UnexpectedEntry));
        }
        if !seen.insert(name.clone()) {
            return Err(invalid(ArchiveProblem::DuplicateEntry));
        }
        if !entry.is_file() {
            return Err(invalid(ArchiveProblem::UnexpectedEntry));
        }
        if entry.encrypted() {
            return Err(invalid(ArchiveProblem::EncryptedEntry));
        }
        if !matches!(
            entry.compression(),
            CompressionMethod::Stored | CompressionMethod::Deflated
        ) {
            return Err(invalid(ArchiveProblem::UnsupportedCompression));
        }
        let size = entry.size();
        let max = if name == MANIFEST_ENTRY {
            limits.max_manifest_bytes
        } else if name == DB_ENTRY {
            limits.max_db_bytes
        } else {
            limits.max_image_bytes
        };
        if size > max {
            return Err(invalid(ArchiveProblem::EntryTooLarge));
        }
        total = total.saturating_add(size);
        if total > limits.max_total_uncompressed {
            return Err(invalid(ArchiveProblem::TotalTooLarge));
        }
        if name == MANIFEST_ENTRY {
            manifest_index = Some(index);
        } else {
            has_db |= name == DB_ENTRY;
            sizes.insert(name, size);
        }
    }
    // 6. required entries
    let Some(manifest_index) = manifest_index else {
        return Err(invalid(ArchiveProblem::MissingManifest));
    };
    if !has_db {
        return Err(invalid(ArchiveProblem::MissingDatabase));
    }
    // 7. manifest
    let mut bytes = Vec::new();
    archive
        .by_index(manifest_index)
        .map_err(|_| invalid(ArchiveProblem::InvalidManifest))?
        .take(limits.max_manifest_bytes)
        .read_to_end(&mut bytes)
        .map_err(|_| invalid(ArchiveProblem::InvalidManifest))?;
    let manifest: Manifest =
        serde_json::from_slice(&bytes).map_err(|_| invalid(ArchiveProblem::InvalidManifest))?;
    if parse_instant(&manifest.created_at).is_err() {
        return Err(invalid(ArchiveProblem::InvalidManifest));
    }
    if manifest.format != MANIFEST_FORMAT || manifest.format_version != MANIFEST_VERSION {
        return Err(invalid(ArchiveProblem::UnsupportedFormat));
    }
    let mut listed: BTreeMap<&str, u64> = BTreeMap::new();
    for f in &manifest.files {
        if listed.insert(f.path.as_str(), f.size).is_some() {
            return Err(invalid(ArchiveProblem::ManifestMismatch));
        }
    }
    let actual: BTreeMap<&str, u64> = sizes.iter().map(|(k, v)| (k.as_str(), *v)).collect();
    let has_images = sizes.keys().any(|k| k.starts_with(IMAGES_PREFIX));
    if listed != actual || (has_images && !manifest.includes_images) {
        return Err(invalid(ArchiveProblem::ManifestMismatch));
    }
    if !app_version_ok(&manifest.app_version) {
        return Err(invalid(ArchiveProblem::InvalidManifest));
    }
    Ok((archive, manifest))
}
