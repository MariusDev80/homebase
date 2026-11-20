import { Injectable, inject, isDevMode } from '@angular/core';
import { REMINDER_REPOSITORY } from '../../data/schedule.tokens';
import type { Reminder } from '../../data';
import { mapLimited } from '../../core/calendar/map-limited';
import type {
  CalendarEvent,
  CalendarRange,
  CalendarSource,
} from '../../core/calendar/calendar-source';
import { rangeLocalDates } from '../../core/calendar/calendar-range';
import { RECURRENCE_ENGINE, addDays, compareLocalDates } from '../../core/time';

const NEAR_DAYS = 2;
const EXPAND_LIMIT = 500;
const EXPAND_PARALLELISM = 8;

/** Calendar source of the reminders widget (ADR-004 3.2.3): one `timed` event per occurrence. */
@Injectable({ providedIn: 'root' })
export class RemindersCalendarSource implements CalendarSource {
  private readonly repository = inject(REMINDER_REPOSITORY);
  private readonly engine = inject(RECURRENCE_ENGINE);

  async listEvents(range: CalendarRange): Promise<readonly CalendarEvent[]> {
    const { firstOn, lastOn } = rangeLocalDates(range);
    // A one-off reminder whose date is more than 2 days (zone offsets) away cannot fall in range.
    const earliest = addDays(firstOn, -NEAR_DAYS);
    const latest = addDays(lastOn, NEAR_DAYS);
    const reminders = (await this.repository.list()).filter((reminder) => {
      if (!reminder.enabled || reminder.status === 'invalid') return false;
      if (reminder.rrule !== null) return true;
      const day = reminder.startLocal.slice(0, 10);
      return compareLocalDates(day, earliest) >= 0 && compareLocalDates(day, latest) <= 0;
    });
    const settled = await mapLimited(reminders, EXPAND_PARALLELISM, (reminder) =>
      this.expand(reminder, range),
    );
    const events: CalendarEvent[] = [];
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        events.push(...result.value);
      } else if (isDevMode()) {
        // Identifier only, never the title.
        console.warn(`Reminder skipped in the calendar (expansion failed): ${reminders[index].id}`);
      }
    });
    return events;
  }

  private async expand(reminder: Reminder, range: CalendarRange): Promise<CalendarEvent[]> {
    const { occurrences, truncated } = await this.engine.expand(
      {
        anchor: { kind: 'date-time', startLocal: reminder.startLocal, timeZone: reminder.timeZone },
        rrule: reminder.rrule,
        exdates: reminder.exdates,
      },
      { from: range.from, to: range.to, timeZone: range.timeZone, limit: EXPAND_LIMIT },
    );
    if (truncated && isDevMode()) {
      console.warn(`Reminder occurrences truncated in the calendar: ${reminder.id}`);
    }
    const events: CalendarEvent[] = [];
    for (const occurrence of occurrences) {
      if (occurrence.kind !== 'date-time') continue;
      const occurrenceKey = reminder.rrule === null ? null : occurrence.key;
      events.push({
        id: `reminders:${reminder.id}:${occurrenceKey ?? ''}`,
        sourceType: 'reminders',
        sourceId: reminder.id,
        occurrenceKey,
        title: reminder.title,
        time: {
          kind: 'timed',
          start: occurrence.start,
          end: null,
          timeZone: reminder.timeZone,
        },
        tone: 'accent',
      });
    }
    return events;
  }
}
