use crate::time::formats::{format_instant, parse_instant};
use jiff::Timestamp;
use serde::{Deserialize, Serialize};

pub const IMAGE_EXTENSIONS: [&str; 6] = ["png", "jpg", "jpeg", "webp", "gif", "avif"];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BackupKind {
    Manual,
    Daily,
    PreMigration,
    PreRestore,
    PreImport,
}

/// Retention reserve (spec D3).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Pool {
    Manual,
    Daily,
    Safety,
    Migration,
}

impl BackupKind {
    pub const ALL: [BackupKind; 5] = [
        BackupKind::Manual,
        BackupKind::Daily,
        BackupKind::PreMigration,
        BackupKind::PreRestore,
        BackupKind::PreImport,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            BackupKind::Manual => "manual",
            BackupKind::Daily => "daily",
            BackupKind::PreMigration => "pre-migration",
            BackupKind::PreRestore => "pre-restore",
            BackupKind::PreImport => "pre-import",
        }
    }

    fn from_name(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|k| k.as_str() == s)
    }

    pub fn pool(self) -> Pool {
        match self {
            BackupKind::Manual => Pool::Manual,
            BackupKind::Daily => Pool::Daily,
            BackupKind::PreRestore | BackupKind::PreImport => Pool::Safety,
            BackupKind::PreMigration => Pool::Migration,
        }
    }

    /// `pre-migration` and `pre-import` contain the database only.
    pub fn includes_images(self) -> bool {
        !matches!(self, BackupKind::PreMigration | BackupKind::PreImport)
    }
}

const PREFIX: &str = "homebase-";
const SUFFIX: &str = ".zip";
const STAMP_LEN: usize = 20;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BackupName {
    pub created_at: Timestamp,
    pub kind: BackupKind,
}

impl BackupName {
    pub fn new(created_at: Timestamp, kind: BackupKind) -> Self {
        Self { created_at, kind }
    }

    /// Fixed-width UTC instant without `-` or `:` (`20261021T081500.123Z`).
    pub fn stamp(&self) -> String {
        format_instant(self.created_at)
            .chars()
            .filter(|c| *c != '-' && *c != ':')
            .collect()
    }

    pub fn file_name(&self) -> String {
        format!("{PREFIX}{}-{}{SUFFIX}", self.stamp(), self.kind.as_str())
    }

    /// Strict inverse of `file_name`; anything else yields `None`.
    pub fn parse(file_name: &str) -> Option<Self> {
        let inner = file_name.strip_prefix(PREFIX)?.strip_suffix(SUFFIX)?;
        let stamp = inner.get(..STAMP_LEN)?;
        let kind = BackupKind::from_name(inner.get(STAMP_LEN..)?.strip_prefix('-')?)?;
        if !stamp.is_ascii() {
            return None;
        }
        let b = stamp.as_bytes();
        if b[8] != b'T' || b[15] != b'.' || b[19] != b'Z' {
            return None;
        }
        let iso = format!(
            "{}-{}-{}T{}:{}:{}{}",
            &stamp[0..4],
            &stamp[4..6],
            &stamp[6..8],
            &stamp[9..11],
            &stamp[11..13],
            &stamp[13..15],
            &stamp[15..]
        );
        let created_at = parse_instant(&iso).ok()?;
        let name = Self { created_at, kind };
        (name.file_name() == file_name).then_some(name)
    }
}

/// Lowercase `8-4-4-4-12` hexadecimal shape.
pub fn is_uuid_shape(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 36
        && b.iter().enumerate().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => *c == b'-',
            _ => c.is_ascii_digit() || (b'a'..=b'f').contains(c),
        })
}

/// `<uuid>.<ext>` with a lowercase extension among `IMAGE_EXTENSIONS`.
pub fn is_image_file_name(s: &str) -> bool {
    match s.split_once('.') {
        Some((stem, ext)) => is_uuid_shape(stem) && IMAGE_EXTENSIONS.contains(&ext),
        None => false,
    }
}

/// Union of JS `trim()` and Rust `str::trim()` whitespace (spec 4.3).
#[allow(dead_code)] // used from lot B4a
fn is_hb_trim(c: char) -> bool {
    matches!(c,
        '\u{0009}'..='\u{000D}'
        | '\u{0020}'
        | '\u{0085}'
        | '\u{00A0}'
        | '\u{1680}'
        | '\u{2000}'..='\u{200A}'
        | '\u{2028}'
        | '\u{2029}'
        | '\u{202F}'
        | '\u{205F}'
        | '\u{3000}'
        | '\u{FEFF}')
}

#[allow(dead_code)] // used from lot B4a
pub fn hb_trim(s: &str) -> &str {
    s.trim_matches(is_hb_trim)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ts(s: &str) -> Timestamp {
        parse_instant(s).expect("instant")
    }

    #[test]
    fn round_trip_all_kinds() {
        let t = ts("2026-10-21T08:15:00.123Z");
        for kind in BackupKind::ALL {
            let n = BackupName::new(t, kind);
            let file = n.file_name();
            assert_eq!(
                file,
                format!("homebase-20261021T081500.123Z-{}.zip", kind.as_str())
            );
            assert_eq!(BackupName::parse(&file), Some(n));
        }
        assert_eq!(
            BackupName::new(t, BackupKind::Manual).stamp(),
            "20261021T081500.123Z"
        );
    }

    #[test]
    fn rejected_names() {
        for s in [
            "",
            "homebase-20261021T081500.123Z-manual.ZIP",
            "homebase-20261021T081500.123Z-manual.zip.bak",
            "Homebase-20261021T081500.123Z-manual.zip",
            "homebase-20261021T081500.123Z-unknown.zip",
            "homebase-20261021T081500.123Z-Manual.zip",
            "homebase-20261021T081500.123Z-.zip",
            "homebase-20261021T081500.123Z.zip",
            "homebase-20261021T081500.123Z-manual-extra.zip",
            "homebase-20261021T081500123Z-manual.zip",
            "homebase-20261021T0815.123Z-manual.zip",
            "homebase-20261321T081500.123Z-manual.zip",
            "homebase-20260230T081500.123Z-manual.zip",
            "homebase-18991231T235959.999Z-manual.zip",
            "homebase-22000101T000000.000Z-manual.zip",
            "homebase-2026-10-21T08:15:00.123Z-manual.zip",
            "homebase-20261021T081500.123Z-manual.zip ",
            " homebase-20261021T081500.123Z-manual.zip",
            "..\\homebase-20261021T081500.123Z-manual.zip",
            "../homebase-20261021T081500.123Z-manual.zip",
            "sub/homebase-20261021T081500.123Z-manual.zip",
            "homebase-20261021T081500.123Z-manual.zip\\..",
            "homebase-\u{e9}0261021T081500.123Z-manual.zip",
            "homebase-20261021T081500.12\u{e9}Z-manual.zip",
        ] {
            assert_eq!(BackupName::parse(s), None, "{s:?}");
        }
    }

    #[test]
    fn kind_properties() {
        assert!(BackupKind::Manual.includes_images());
        assert!(BackupKind::Daily.includes_images());
        assert!(BackupKind::PreRestore.includes_images());
        assert!(!BackupKind::PreMigration.includes_images());
        assert!(!BackupKind::PreImport.includes_images());
        assert_eq!(BackupKind::PreRestore.pool(), Pool::Safety);
        assert_eq!(BackupKind::PreImport.pool(), Pool::Safety);
        assert_eq!(BackupKind::PreMigration.pool(), Pool::Migration);
        assert_eq!(BackupKind::Manual.pool(), Pool::Manual);
        assert_eq!(BackupKind::Daily.pool(), Pool::Daily);
    }

    #[test]
    fn kind_serde_is_kebab_case() {
        assert_eq!(
            serde_json::to_string(&BackupKind::PreMigration).expect("json"),
            "\"pre-migration\""
        );
    }

    const UUID: &str = "3f0c2a5e-8f0b-4c55-9a43-0d2a1d6c9b11";

    #[test]
    fn image_names() {
        for ext in IMAGE_EXTENSIONS {
            assert!(is_image_file_name(&format!("{UUID}.{ext}")), "{ext}");
        }
        for bad in [
            format!("{UUID}.svg"),
            format!("{UUID}.html"),
            format!("{UUID}.exe"),
            format!("{UUID}.lnk"),
            format!("{UUID}.PNG"),
            format!("{}.png", UUID.to_uppercase()),
            format!("{UUID}.png.exe"),
            format!("{UUID}."),
            UUID.to_owned(),
            "..".to_owned(),
            "../x.png".to_owned(),
            format!("..{UUID}.png"),
            format!("{UUID}..png"),
            format!("{UUID}/x.png"),
            ".png".to_owned(),
            String::new(),
        ] {
            assert!(!is_image_file_name(&bad), "{bad:?}");
        }
    }

    #[test]
    fn uuid_shape() {
        assert!(is_uuid_shape(UUID));
        assert!(!is_uuid_shape(&UUID.to_uppercase()));
        assert!(!is_uuid_shape("3f0c2a5e8f0b4c559a430d2a1d6c9b11"));
        assert!(!is_uuid_shape("3f0c2a5e-8f0b-4c55-9a43-0d2a1d6c9b1g"));
        assert!(!is_uuid_shape(""));
    }

    #[test]
    fn hb_trim_vectors() {
        let cases: [(&str, &str); 14] = [
            ("  a  ", "a"),
            ("\u{00A0}a\u{00A0}", "a"),
            ("\u{FEFF}a\u{FEFF}", "a"),
            ("\u{0085}a\u{0085}", "a"),
            ("\u{3000}a\u{3000}", "a"),
            ("\t\n\u{000B}\u{000C}\ra\r\u{000C}\u{000B}\n\t", "a"),
            (
                "\u{1680}\u{2000}\u{200A}a\u{2028}\u{2029}\u{202F}\u{205F}",
                "a",
            ),
            ("a b", "a b"),
            ("a\u{00A0}b", "a\u{00A0}b"),
            ("a\u{FEFF}b", "a\u{FEFF}b"),
            (" \u{FEFF} a \u{3000}", "a"),
            ("   ", ""),
            ("", ""),
            ("\u{200B}a", "\u{200B}a"),
        ];
        for (input, expected) in cases {
            assert_eq!(hb_trim(input), expected, "{input:?}");
        }
    }
}
