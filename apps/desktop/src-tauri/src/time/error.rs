#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TimeError {
    InvalidInstant {
        value: String,
    },
    InvalidLocalDate {
        value: String,
    },
    InvalidLocalDateTime {
        value: String,
    },
    OutOfRange {
        value: String,
    },
    UnknownTimeZone {
        value: String,
    },
    InvalidRule {
        code: RuleErrorCode,
        part: Option<String>,
    },
    InvalidExdate {
        value: String,
    },
    InvalidRange,
    ExpansionLimit,
    NotSchedulable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuleErrorCode {
    TooLong,
    Syntax,
    DuplicatePart,
    UnsupportedPart,
    MissingFreq,
    InvalidValue,
    DuplicateValue,
    PartNotAllowed,
    ConflictingParts,
    CountAndUntil,
    UntilNotUtc,
    UntilKindMismatch,
    UntilBeforeStart,
}
