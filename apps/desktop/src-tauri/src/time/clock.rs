use jiff::Timestamp;

/// The only source of "now" in Rust code (ADR-003).
pub trait Clock: Send + Sync {
    fn now(&self) -> Timestamp;
}

pub struct SystemClock;

impl Clock for SystemClock {
    #[allow(clippy::disallowed_methods)]
    fn now(&self) -> Timestamp {
        Timestamp::now()
    }
}

#[cfg(test)]
pub struct FixedClock {
    at: std::sync::Mutex<Timestamp>,
}

#[cfg(test)]
impl FixedClock {
    pub fn new(at: Timestamp) -> Self {
        Self {
            at: std::sync::Mutex::new(at),
        }
    }

    pub fn set(&self, at: Timestamp) {
        *self.at.lock().expect("clock lock") = at;
    }

    pub fn advance(&self, by: jiff::SignedDuration) {
        let mut guard = self.at.lock().expect("clock lock");
        *guard = guard.checked_add(by).expect("clock overflow");
    }
}

#[cfg(test)]
impl Clock for FixedClock {
    fn now(&self) -> Timestamp {
        *self.at.lock().expect("clock lock")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixed_clock_set_and_advance() {
        let c = FixedClock::new(Timestamp::UNIX_EPOCH);
        assert_eq!(c.now(), Timestamp::UNIX_EPOCH);
        c.advance(jiff::SignedDuration::from_secs(90));
        assert_eq!(c.now().as_second(), 90);
        c.set(Timestamp::UNIX_EPOCH);
        assert_eq!(c.now(), Timestamp::UNIX_EPOCH);
    }

    #[test]
    fn system_clock_is_after_2020() {
        let t = SystemClock.now();
        assert!(t.as_second() > 1_577_836_800);
    }
}
