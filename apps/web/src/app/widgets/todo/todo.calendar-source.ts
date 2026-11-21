import { Injectable, inject, isDevMode } from '@angular/core';
import { TODO_REPOSITORY } from '../../data';
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
 * the projected occurrences of the repeating ones, expanded by the Rust engine (ADR-003 3.9).
 */
@Injectable({ providedIn: 'root' })
export class TodoCalendarSource implements CalendarSource {
  private readonly repository = inject(TODO_REPOSITORY);
  private readonly engine = inject(RECURRENCE_ENGINE);
  private readonly today = inject(Today);

  /** Called outside the aggregator with an invalid range, it rejects with a TimeError. */
  async listEvents(range: CalendarRange): Promise<readonly CalendarEvent[]> {
    const { firstOn, lastOn } = rangeLocalDates(range);
    // Two reads, not one transaction, on purpose: a todo checked in between can show twice (same id,
    // absorbed by the aggregator's id dedupe) or be missed once; the checkbox notifies
    // CalendarChanges, which reloads and catches up the race window. A rejection rejects the source.
    const [todos, repeating] = await Promise.all([
      this.repository.listDue({ fromOn: firstOn, toOn: lastOn }, DUE_LIMIT),
      this.repository.listRepeatingDueBy(lastOn, DUE_LIMIT),
    ]);
    if (isDevMode()) {
      if (todos.length === DUE_LIMIT) {
        console.warn(`Todo due dates reached the limit (${DUE_LIMIT}): ${firstOn}..${lastOn}`);
      }
      if (repeating.length === DUE_LIMIT) {
        console.warn(
          `Repeating todos reached the limit (${DUE_LIMIT}): due_on <= ${lastOn}, some projections are missing`,
        );
      }
    }
    const today = this.today.date();
    const events: CalendarEvent[] = [];
    for (const todo of todos) {
      if (todo.dueOn === null) continue;
      events.push(dueEvent(todo, today));
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
