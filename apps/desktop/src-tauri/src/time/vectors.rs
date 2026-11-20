//! Shared test vectors (ADR-003 section 8.6), read from the same file as the TypeScript tests.

use serde_json::Value;
use std::sync::LazyLock;

const RAW: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../web/src/app/core/time/testing/time-vectors.json"
));

pub static VECTORS: LazyLock<Value> =
    LazyLock::new(|| serde_json::from_str(RAW).expect("time-vectors.json is valid JSON"));
