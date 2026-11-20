import { Injectable, inject, isDevMode } from '@angular/core';
import { TODO_REPOSITORY } from '../../data';
import { rangeLocalDates } from '../../core/calendar/calendar-range';
import type {
  CalendarEvent,
  CalendarRange,
  CalendarSource,
} from '../../core/calendar/calendar-source';
import { Today, compareLocalDates } from '../../core/time';

const DUE_LIMIT = 1000;

/** Calendar source of the todo widget (ADR-004 3.2.3): one `all-day` event per active todo due. */
@Injectable({ providedIn: 'root' })
export class TodoCalendarSource implements CalendarSource {
  private readonly repository = inject(TODO_REPOSITORY);
  private readonly today = inject(Today);

  /** Called outside the aggregator with an invalid range, it rejects with a TimeError. */
  async listEvents(range: CalendarRange): Promise<readonly CalendarEvent[]> {
    const { firstOn, lastOn } = rangeLocalDates(range);
    const todos = await this.repository.listDue({ fromOn: firstOn, toOn: lastOn }, DUE_LIMIT);
    if (todos.length === DUE_LIMIT && isDevMode()) {
      console.warn(`Todo due dates reached the limit (${DUE_LIMIT}): ${firstOn}..${lastOn}`);
    }
    const today = this.today.date();
    const events: CalendarEvent[] = [];
    for (const todo of todos) {
      if (todo.dueOn === null) continue;
      events.push({
        id: `todo:${todo.id}:`,
        sourceType: 'todo',
        sourceId: todo.id,
        occurrenceKey: null,
        title: todo.title,
        time: { kind: 'all-day', startOn: todo.dueOn, lastOn: todo.dueOn },
        tone: compareLocalDates(todo.dueOn, today) < 0 ? 'danger' : 'neutral',
      });
    }
    return events;
  }
}
