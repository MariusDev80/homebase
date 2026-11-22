import type { LocalDateIso, Todo } from '../../data';
import type { CalendarEvent } from '../../core/calendar/calendar-source';
import { compareLocalDates } from '../../core/time';
import { parseDateRule } from '../../core/time/date-rule';
import type { DateRule } from '../../core/time/date-rule';

// Pure helpers of the todo calendar source (calendar-occurrences spec 3.4). No date arithmetic
// here: the occurrences come from the recurrence engine, only comparisons are made.

/** Rule of the subset, or null (non-repeating, completed, no due date, or rule outside parseDateRule). */
export function repeatRule(todo: Todo): DateRule | null {
  if (todo.completedAt !== null || todo.dueOn === null || todo.rrule === null) return null;
  return parseDateRule(todo.rrule);
}

/** Current-due event: id todo:<id>:<dueOn> when repeatRule != null, else todo:<id>: (key null).
 *  When dueOn < today (overdue), the event is carried over to today (startOn = lastOn = today),
 *  with originalOn = dueOn, tone danger and status 'overdue'; the id is unchanged. Else neutral. */
export function dueEvent(todo: Todo, today: LocalDateIso): CalendarEvent {
  const dueOn = todo.dueOn as LocalDateIso;
  const key = repeatRule(todo) === null ? null : dueOn;
  const overdue = compareLocalDates(dueOn, today) < 0;
  return {
    id: `todo:${todo.id}:${key ?? ''}`,
    sourceType: 'todo',
    sourceId: todo.id,
    occurrenceKey: key,
    title: todo.title,
    time: overdue
      ? { kind: 'all-day', startOn: today, lastOn: today }
      : { kind: 'all-day', startOn: dueOn, lastOn: dueOn },
    ...(overdue
      ? { tone: 'danger' as const, status: 'overdue' as const, originalOn: dueOn }
      : { tone: 'neutral' as const }),
  };
}

/** max(dueOn, today): projections are strictly after it. */
export function projectionFloor(todo: Todo, today: LocalDateIso): LocalDateIso {
  const dueOn = todo.dueOn as LocalDateIso;
  return compareLocalDates(dueOn, today) >= 0 ? dueOn : today;
}

/** Events for the dates strictly after the floor: tone neutral, status 'projected', key = date. */
export function projectedEvents(
  todo: Todo,
  dates: readonly LocalDateIso[],
  today: LocalDateIso,
): CalendarEvent[] {
  if (todo.dueOn === null) return [];
  const floor = projectionFloor(todo, today);
  const events: CalendarEvent[] = [];
  const seen = new Set<string>();
  for (const date of dates) {
    if (compareLocalDates(date, floor) <= 0 || seen.has(date)) continue;
    seen.add(date);
    events.push({
      id: `todo:${todo.id}:${date}`,
      sourceType: 'todo',
      sourceId: todo.id,
      occurrenceKey: date,
      title: todo.title,
      time: { kind: 'all-day', startOn: date, lastOn: date },
      tone: 'neutral',
      status: 'projected',
    });
  }
  return events;
}
