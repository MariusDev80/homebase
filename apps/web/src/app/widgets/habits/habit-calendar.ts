import { isDevMode } from '@angular/core';
import type { Habit, HabitCheck, InstantIso, LocalDateIso, TimeZoneId } from '../../data';
import type { CalendarEvent, CalendarRange } from '../../core/calendar/calendar-source';
import { weekdayCode } from '../../core/habits/habit-stats';
import { addDays, compareLocalDates, normalizeTimeZone, resolveLocal } from '../../core/time';

// Pure helper of the habits calendar source (calendar-occurrences spec 3.5). No date arithmetic
// here: days come from addDays, instants from resolveLocal ('compatible', ADR-003 3.3).

interface HabitTime {
  readonly time: string;
  readonly timeZone: TimeZoneId;
}

/** Time of the reminder when it is readable (an `invalid` one carries a fake 00:00), else null. */
export function habitTime(habit: Habit): HabitTime | null {
  const reminder = habit.reminder;
  if (reminder === null || reminder.status === 'invalid') return null;
  return { time: reminder.time, timeZone: reminder.timeZone };
}

/**
 * Events of the non-archived habits over the days [firstOn, lastOn] (spec O9, O10): a checked day
 * is `done` (success), a planned day from today on that is not checked is `planned` (neutral);
 * missed days stay empty and a `weekly` habit only shows its checked days. With a readable
 * reminder, the event is `timed` at the reminder time in the reminder zone, else `all-day`.
 *
 * When the reminder zone differs from the display zone, the habit day may fall one day off the
 * displayed ones: the days [firstOn - 1, lastOn + 1] are walked (the caller reads the checks over
 * that span) and only the instants inside [from, to) are kept (spec K5).
 */
export function habitEvents(
  habits: readonly Habit[],
  checks: readonly HabitCheck[],
  range: CalendarRange,
  days: { readonly firstOn: LocalDateIso; readonly lastOn: LocalDateIso },
  today: LocalDateIso,
): CalendarEvent[] {
  const checked = new Map<string, Set<LocalDateIso>>();
  for (const check of checks) {
    let set = checked.get(check.habitId);
    if (set === undefined) checked.set(check.habitId, (set = new Set<LocalDateIso>()));
    set.add(check.dayOn);
  }
  const events: CalendarEvent[] = [];
  for (const habit of habits) {
    if (habit.archivedAt !== null) continue;
    const at = habitTime(habit);
    // Zone read once per habit; null (unreadable) falls back to all-day.
    const zone = at === null ? null : normalizeTimeZone(at.timeZone);
    if (at !== null && zone === null && isDevMode()) {
      console.warn(`Habit reminder zone unreadable in the calendar: ${habit.id}`);
    }
    const timed = at !== null && zone !== null;
    const offZone = timed && zone !== normalizeTimeZone(range.timeZone);
    const lo = offZone ? addDays(days.firstOn, -1) : days.firstOn;
    const hi = offZone ? addDays(days.lastOn, 1) : days.lastOn;
    const done = checked.get(habit.id);
    const first = compareLocalDates(lo, habit.startOn) >= 0 ? lo : habit.startOn;
    for (let day = first; compareLocalDates(day, hi) <= 0; day = addDays(day, 1)) {
      const isDone = done?.has(day) ?? false;
      const planned =
        !isDone &&
        habit.schedule.kind === 'days' &&
        compareLocalDates(day, today) >= 0 &&
        habit.schedule.days.includes(weekdayCode(day));
      if (!isDone && !planned) continue;
      let time: CalendarEvent['time'] = { kind: 'all-day', startOn: day, lastOn: day };
      if (timed) {
        // Canonical UTC instants (milliseconds): string comparison is chronological.
        let start: InstantIso | null = null;
        try {
          start = resolveLocal(`${day}T${at.time}:00`, zone);
        } catch {
          // Unresolvable reminder time: the habit stays all-day (spec 3.5).
        }
        if (start !== null) {
          if (start < range.from || start >= range.to) continue;
          time = { kind: 'timed', start, end: null, timeZone: zone };
        }
      }
      events.push({
        id: `habits:${habit.id}:${day}`,
        sourceType: 'habits',
        sourceId: habit.id,
        occurrenceKey: day,
        title: habit.title,
        time,
        tone: isDone ? 'success' : 'neutral',
        status: isDone ? 'done' : 'planned',
      });
    }
  }
  return events;
}
