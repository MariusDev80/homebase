use super::{RENAME_RETRY_STEP, RENAME_RETRY_TOTAL};
use serde::Serialize;
use std::ffi::OsString;
use std::fs;
use std::io::{self, Write};
use std::path::Path;

/// Sharing violation (32), lock violation (33), access denied (5).
fn is_transient(e: &io::Error) -> bool {
    matches!(e.raw_os_error(), Some(32 | 33 | 5))
}

/// Retries every `RENAME_RETRY_STEP` for at most `RENAME_RETRY_TOTAL` on transient Windows errors.
/// Blocking: call from `spawn_blocking` when in async code.
fn with_retry<T>(mut op: impl FnMut() -> io::Result<T>) -> io::Result<T> {
    let max_retries = (RENAME_RETRY_TOTAL.as_millis() / RENAME_RETRY_STEP.as_millis()) as u32;
    let mut retries = 0;
    loop {
        match op() {
            Err(e) if is_transient(&e) && retries < max_retries => {
                retries += 1;
                std::thread::sleep(RENAME_RETRY_STEP);
            }
            other => return other,
        }
    }
}

pub fn rename_with_retry(from: &Path, to: &Path) -> io::Result<()> {
    with_retry(|| fs::rename(from, to))
}

/// File or directory; an absent path is `Ok`.
pub fn remove_with_retry(path: &Path) -> io::Result<()> {
    with_retry(|| {
        let meta = match fs::symlink_metadata(path) {
            Ok(m) => m,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(e),
        };
        let result = if meta.is_dir() {
            fs::remove_dir_all(path)
        } else {
            fs::remove_file(path)
        };
        match result {
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
            other => other,
        }
    })
}

/// `<path>.tmp`, `sync_all`, then rename over `path`. The temporary file never survives.
pub fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> io::Result<()> {
    let bytes = serde_json::to_vec_pretty(value).map_err(io::Error::other)?;
    let mut tmp_name: OsString = path
        .file_name()
        .ok_or_else(|| io::Error::from(io::ErrorKind::InvalidInput))?
        .to_owned();
    tmp_name.push(".tmp");
    let tmp = path.with_file_name(tmp_name);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let result = (|| {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        rename_with_retry(&tmp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// `ext` is lowercase; `header` holds at least the first 12 bytes of the file (spec D2).
pub fn image_signature_matches(ext: &str, header: &[u8]) -> bool {
    match ext {
        "png" => header.starts_with(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
        "jpg" | "jpeg" => header.starts_with(&[0xFF, 0xD8, 0xFF]),
        "gif" => header.starts_with(b"GIF87a") || header.starts_with(b"GIF89a"),
        "webp" => header.len() >= 12 && &header[0..4] == b"RIFF" && &header[8..12] == b"WEBP",
        "avif" => {
            header.len() >= 12
                && &header[4..8] == b"ftyp"
                && (&header[8..12] == b"avif" || &header[8..12] == b"avis")
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn signatures_valid_and_invalid_per_extension() {
        let png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0];
        assert!(image_signature_matches("png", &png));
        assert!(!image_signature_matches("png", b"\x89PNG\r\n\x1a\x0b0000"));

        assert!(image_signature_matches("jpg", &[0xFF, 0xD8, 0xFF, 0xE0]));
        assert!(image_signature_matches("jpeg", &[0xFF, 0xD8, 0xFF, 0xE0]));
        assert!(!image_signature_matches("jpg", &[0xFF, 0xD8, 0x00]));
        assert!(!image_signature_matches("jpeg", b"GIF89a"));

        assert!(image_signature_matches("gif", b"GIF87a\x01\x00"));
        assert!(image_signature_matches("gif", b"GIF89a\x01\x00"));
        assert!(!image_signature_matches("gif", b"GIF88a\x01\x00"));

        assert!(image_signature_matches("webp", b"RIFF\x00\x00\x00\x00WEBP"));
        assert!(!image_signature_matches(
            "webp",
            b"RIFF\x00\x00\x00\x00WAVE"
        ));
        assert!(!image_signature_matches("webp", b"RIFF"));

        assert!(image_signature_matches("avif", b"\x00\x00\x00\x1cftypavif"));
        assert!(image_signature_matches("avif", b"\x00\x00\x00\x1cftypavis"));
        assert!(!image_signature_matches(
            "avif",
            b"\x00\x00\x00\x1cftypheic"
        ));
        assert!(!image_signature_matches(
            "avif",
            b"\x00\x00\x00\x1cmoovavif"
        ));

        assert!(!image_signature_matches("svg", b"<svg xmlns=..."));
        assert!(!image_signature_matches("PNG", &png));
    }

    #[test]
    fn write_json_atomic_leaves_no_tmp() {
        let dir = TempDir::new().expect("tmp");
        let target = dir.path().join("sub").join("m.json");
        write_json_atomic(&target, &serde_json::json!({"a": 1})).expect("write");
        write_json_atomic(&target, &serde_json::json!({"a": 2})).expect("overwrite");
        let v: serde_json::Value =
            serde_json::from_slice(&fs::read(&target).expect("read")).expect("json");
        assert_eq!(v["a"], 2);
        let names: Vec<_> = fs::read_dir(target.parent().expect("parent"))
            .expect("dir")
            .map(|e| e.expect("entry").file_name())
            .collect();
        assert_eq!(names, vec![OsString::from("m.json")]);
    }

    #[test]
    fn remove_with_retry_handles_files_dirs_and_absent() {
        let dir = TempDir::new().expect("tmp");
        let file = dir.path().join("f");
        fs::write(&file, b"x").expect("write");
        remove_with_retry(&file).expect("file");
        assert!(!file.exists());
        let sub = dir.path().join("d");
        fs::create_dir_all(sub.join("inner")).expect("mkdir");
        fs::write(sub.join("inner").join("x"), b"x").expect("write");
        remove_with_retry(&sub).expect("dir");
        assert!(!sub.exists());
        remove_with_retry(&sub).expect("absent");
    }

    #[test]
    fn rename_with_retry_plain() {
        let dir = TempDir::new().expect("tmp");
        let a = dir.path().join("a");
        let b = dir.path().join("b");
        fs::write(&a, b"x").expect("write");
        rename_with_retry(&a, &b).expect("rename");
        assert!(b.exists() && !a.exists());
    }

    #[cfg(windows)]
    mod windows_locks {
        use super::*;
        use std::os::windows::fs::OpenOptionsExt;
        use std::time::{Duration, Instant};

        fn locked(path: &Path) -> fs::File {
            fs::OpenOptions::new()
                .read(true)
                .share_mode(0)
                .open(path)
                .expect("open without sharing")
        }

        #[test]
        fn rename_succeeds_after_lock_is_released() {
            let dir = TempDir::new().expect("tmp");
            let a = dir.path().join("a");
            let b = dir.path().join("b");
            fs::write(&a, b"x").expect("write");
            let handle = locked(&a);
            let releaser = std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(300));
                drop(handle);
            });
            rename_with_retry(&a, &b).expect("rename after release");
            releaser.join().expect("join");
            assert!(b.exists() && !a.exists());
        }

        #[test]
        fn persistent_lock_surfaces_after_two_seconds() {
            let dir = TempDir::new().expect("tmp");
            let a = dir.path().join("a");
            let b = dir.path().join("b");
            fs::write(&a, b"x").expect("write");
            let _handle = locked(&a);
            let start = Instant::now();
            let err = rename_with_retry(&a, &b).expect_err("must fail");
            assert!(start.elapsed() >= Duration::from_secs(2));
            assert!(is_transient(&err), "{err:?}");
            assert!(a.exists() && !b.exists());
        }
    }
}
