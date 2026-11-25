import { Injectable, inject, isDevMode } from '@angular/core';
import { TODO_REPOSITORY } from '../../data/content.tokens';
import type { LocalDateIso, Todo } from '../../data';
import { MAX_CALENDAR_RANGE_DAYS, rangeLocalDates } from '../../core/calendar/calendar-range';
import { mapLimited } from '../../core/calendar/map-limited';
import type {
  CalendarEvent,
  CalendarRange,
  CalendarSource,
} from '../../core/calendar/calendar-source';
import { RECURRENCE_ENGINE, Today, compareLocalDates } from '../../core/time';
import { dueEvent, projectedEvents, projectionFloor, repeatRule } from './todo-calendar';

const DUE_LIMIT = 1000;
const EXPAND_PARALLELISM = 8;

/**
 * Calendar source of the todo widget (ADR-004 3.2.3): one `all-day` event per active todo due, plus
 * the projected occurrences of the repeating ones, expanded by the Rust engine (ADR-003 3.9). An
 * overdue todo (due before today) is carried over to today when today is in the range, and shown
 * nowhere else (amendment 2026-11-22). Beyond 1000 overdue todos the most recent ones are lost
 * (dev-only warning, like the other limits).
 */
@Injectable({ providedIn: 'root' })
export class TodoCalendarSource implements CalendarSource {
  private readonly repository = inject(TODO_REPOSITORY);
  private readonly engine = inject(RECURRENCE_ENGINE);
  private readonly today = inject(Today);

  /** Called outside the aggregator with an invalid range, it rejects with a TimeError. */
  async listEvents(range: CalendarRange): Promise<readonly CalendarEvent[]> {
    const { firstOn, lastOn } = rangeLocalDates(range);
    // Three reads, not one transaction, on purpose: a todo checked in between can show twice (same id,
    // absorbed by the aggregator's id dedupe) or be missed once; the checkbox notifies
    // CalendarChanges, which reloads and catches up the race window. A rejection rejects the source.
    const today = this.today.date();
    // Overdue todos are carried over to today: read only when today is in the range.
    const todayInRange =
      compareLocalDates(today, firstOn) >= 0 && compareLocalDates(today, lastOn) <= 0;
    // A past range (lastOn < today) shows nothing: no read. When today is in the range, the todos
    // before today come from the overdue read, so listDue starts at today.
    if (compareLocalDates(lastOn, today) < 0) return [];
    const dueFromOn = todayInRange ? today : firstOn;
    const [todos, repeating, overdue] = await Promise.all([
      this.repository.listDue({ fromOn: dueFromOn, toOn: lastOn }, DUE_LIMIT),
      this.repository.listRepeatingDueBy(lastOn, DUE_LIMIT),
      todayInRange
        ? this.repository.listOverdueBefore(today, DUE_LIMIT)
        : Promise.resolve<Todo[]>([]),
    ]);
    if (isDevMode()) {
      if (overdue.length === DUE_LIMIT) {
        console.warn(`Overdue todos reached the limit (${DUE_LIMIT}): due_on < ${today}`);
      }
      if (todos.length === DUE_LIMIT) {
        console.warn(`Todo due dates reached the limit (${DUE_LIMIT}): ${dueFromOn}..${lastOn}`);
      }
      if (repeating.length === DUE_LIMIT) {
        console.warn(
          `Repeating todos reached the limit (${DUE_LIMIT}): due_on <= ${lastOn}, some projections are missing`,
        );
      }
    }
    // Carried-over todos first (by due date, then the repository order), then today's and later.
    // Overdue todos of `todos` are skipped: they are in `overdue` when today is in the range, and
    // appear nowhere otherwise.
    const events: CalendarEvent[] = [];
    const seen = new Set<string>();
    const add = (todo: Todo): void => {
      if (todo.dueOn === null) return;
      const event = dueEvent(todo, today);
      if (seen.has(event.id)) return;
      seen.add(event.id);
      events.push(event);
    };
    overdue.forEach(add);
    for (const todo of todos) {
      if (todo.dueOn !== null && compareLocalDates(todo.dueOn, today) < 0) continue;
      add(todo);
    }
    const candidates = repeating.filter(
      (todo) =>
        repeatRule(todo) !== null && compareLocalDates(projectionFloor(todo, today), lastOn) < 0,
    );
    const settled = await mapLimited(candidates, EXPAND_PARALLELISM, (todo) =>
      this.project(todo, range, today),
    );
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        events.push(...result.value);
      } else if (isDevMode()) {
        // Identifier only, never the title.
        console.warn(`Todo projections skipped in the calendar: ${candidates[index].id}`);
      }
    });
    return events;
  }

  private async project(
    todo: Todo,
    range: CalendarRange,
    today: LocalDateIso,
  ): Promise<CalendarEvent[]> {
    const { occurrences } = await this.engine.expand(
      {
        anchor: { kind: 'date', startOn: todo.dueOn as LocalDateIso },
        rrule: todo.rrule,
        exdates: [],
      },
      {
        from: range.from,
        to: range.to,
        timeZone: range.timeZone,
        limit: MAX_CALENDAR_RANGE_DAYS,
      },
    );
    const dates: LocalDateIso[] = [];
    for (const occurrence of occurrences) {
      if (occurrence.kind === 'date') dates.push(occurrence.date);
    }
    return projectedEvents(todo, dates, today);
  }
}
