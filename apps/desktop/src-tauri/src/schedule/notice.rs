//! Native notification texts (French, the only file that holds them: spec D9, 4.5) and the
//! grouping of one pass's notices (D6). Pure: no clock, no I/O.

use super::reminder::Outcome;
use super::session::SessionKind;
use super::{LABEL_MAX_CHARS, MAX_TOASTS_PER_TICK, TITLE_MAX_CHARS};
use jiff::civil;
use jiff::{SignedDuration, Timestamp};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Notice {
    Reminder {
        title: String,
        nominal_local: civil::DateTime,
        outcome: Outcome,
        skipped: u32,
        due_at: Timestamp,
    },
    SessionEnded {
        kind: SessionKind,
        label: String,
        planned: SignedDuration,
        late_by: Option<SignedDuration>,
        due_at: Timestamp,
    },
    Summary {
        reminders: u32,
        sessions: u32,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Toast {
    pub title: String,
    pub body: String,
    /// Windows sound name: `Reminder`, `Alarm` or `Default`. Never empty (an unnamed sound is
    /// silent).
    pub sound: &'static str,
}

fn truncate(s: &str, max_chars: usize) -> String {
    s.chars().take(max_chars).collect()
}

/// At most two units, truncated: `45 s`, `10 min`, `1 h`, `1 h 30 min`, `2 j 3 h`.
pub fn format_duration_fr(d: SignedDuration) -> String {
    const UNITS: [(&str, i64); 4] = [("j", 86_400), ("h", 3_600), ("min", 60), ("s", 1)];
    let total = d.as_secs().max(0);
    let Some(first) = UNITS.iter().position(|(_, size)| total >= *size) else {
        return "0 s".to_owned();
    };
    let (name, size) = UNITS[first];
    let mut out = format!("{} {name}", total / size);
    if let Some((next_name, next_size)) = UNITS.get(first + 1) {
        let rest = (total % size) / next_size;
        if rest > 0 {
            out.push_str(&format!(" {rest} {next_name}"));
        }
    }
    out
}

fn reminder_toast(
    title: &str,
    nominal_local: civil::DateTime,
    outcome: Outcome,
    skipped: u32,
) -> Toast {
    let title = truncate(title, TITLE_MAX_CHARS);
    let time = nominal_local.strftime("%H:%M").to_string();
    let (title, mut body) = match outcome {
        Outcome::OnTime => (title, format!("Prévu à {time}")),
        // A missed occurrence is never notified; if one reaches here, word it like a late one.
        Outcome::Late | Outcome::Missed => (
            format!("Rappel manqué : {title}"),
            format!("Prévu le {} à {time}", nominal_local.strftime("%d/%m")),
        ),
    };
    match skipped {
        0 => {}
        1 => body.push_str(" · 1 occurrence précédente manquée"),
        n => body.push_str(&format!(" · {n} occurrences précédentes manquées")),
    }
    Toast {
        title,
        body,
        sound: "Reminder",
    }
}

fn session_toast(
    kind: SessionKind,
    label: &str,
    planned: SignedDuration,
    late_by: Option<SignedDuration>,
) -> Toast {
    let label = truncate(label, LABEL_MAX_CHARS);
    let (mut title, mut body) = match kind {
        SessionKind::PomodoroWork => (
            "Pomodoro terminé".to_owned(),
            if label.is_empty() {
                "C'est l'heure de la pause.".to_owned()
            } else {
                format!("C'est l'heure de la pause. ({label})")
            },
        ),
        SessionKind::PomodoroShortBreak | SessionKind::PomodoroLongBreak => (
            "Pause terminée".to_owned(),
            "Prêt pour le prochain pomodoro ?".to_owned(),
        ),
        // A stopwatch never ends by itself; worded like a countdown if one reaches here.
        SessionKind::Countdown | SessionKind::Stopwatch => (
            "Minuteur terminé".to_owned(),
            if label.is_empty() {
                format!("Minuteur de {}", format_duration_fr(planned))
            } else {
                label
            },
        ),
    };
    if let Some(late) = late_by {
        title.push_str(" pendant l'absence");
        body.push_str(&format!(" · il y a {}", format_duration_fr(late)));
    }
    Toast {
        title,
        body,
        sound: "Alarm",
    }
}

fn count_phrase(n: u32, one: &str, many: &str) -> String {
    if n == 1 {
        format!("1 {one}")
    } else {
        format!("{n} {many}")
    }
}

fn summary_toast(reminders: u32, sessions: u32) -> Toast {
    let mut parts = Vec::new();
    if reminders > 0 {
        parts.push(count_phrase(reminders, "autre rappel", "autres rappels"));
    }
    if sessions > 0 {
        parts.push(count_phrase(
            sessions,
            "minuteur terminé",
            "minuteurs terminés",
        ));
    }
    let tail = "Ouvrez Homebase pour les voir.";
    let body = if parts.is_empty() {
        tail.to_owned()
    } else {
        format!("{}. {tail}", parts.join(" et "))
    };
    Toast {
        title: "Homebase".to_owned(),
        body,
        sound: "Default",
    }
}

pub fn render(notice: &Notice) -> Toast {
    match notice {
        Notice::Reminder {
            title,
            nominal_local,
            outcome,
            skipped,
            ..
        } => reminder_toast(title, *nominal_local, *outcome, *skipped),
        Notice::SessionEnded {
            kind,
            label,
            planned,
            late_by,
            ..
        } => session_toast(*kind, label, *planned, *late_by),
        Notice::Summary {
            reminders,
            sessions,
        } => summary_toast(*reminders, *sessions),
    }
}

/// Sort rank: on time first, then late, summaries last.
fn rank(notice: &Notice) -> u8 {
    match notice {
        Notice::Reminder { outcome, .. } if *outcome == Outcome::OnTime => 0,
        Notice::SessionEnded { late_by: None, .. } => 0,
        Notice::Reminder { .. } | Notice::SessionEnded { .. } => 1,
        Notice::Summary { .. } => 2,
    }
}

fn due_at(notice: &Notice) -> Option<Timestamp> {
    match notice {
        Notice::Reminder { due_at, .. } | Notice::SessionEnded { due_at, .. } => Some(*due_at),
        Notice::Summary { .. } => None,
    }
}

/// Orders the notices of one pass (on time first, by due time, then late) and, beyond
/// `MAX_TOASTS_PER_TICK`, keeps the first `MAX_TOASTS_PER_TICK - 1` plus one summary of the rest.
/// Never receives a `Missed` outcome.
pub fn group(mut notices: Vec<Notice>) -> Vec<Notice> {
    notices.sort_by_key(|n| (rank(n), due_at(n)));
    if notices.len() <= MAX_TOASTS_PER_TICK {
        return notices;
    }
    let rest = notices.split_off(MAX_TOASTS_PER_TICK - 1);
    let (mut reminders, mut sessions) = (0u32, 0u32);
    for notice in &rest {
        match notice {
            Notice::Reminder { .. } => reminders += 1,
            Notice::SessionEnded { .. } => sessions += 1,
            Notice::Summary { .. } => {}
        }
    }
    notices.push(Notice::Summary {
        reminders,
        sessions,
    });
    notices
}
