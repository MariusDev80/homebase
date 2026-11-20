//! Time model (ADR-003): injectable clock, strict formats, wall-clock resolution, recurrence.

pub mod clock;
pub mod commands;
pub mod error;
pub mod formats;
pub mod recurrence;
pub mod zone;

#[cfg(test)]
mod vectors;
