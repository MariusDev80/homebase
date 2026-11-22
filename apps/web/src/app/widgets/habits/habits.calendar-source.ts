import { Injectable, inject } from '@angular/core';
import { HABIT_REPOSITORY } from '../../data/schedule.tokens';
import { rangeLocalDates } from '../../core/calendar/calendar-range';
import type {
  CalendarEvent,
  CalendarRange,
  CalendarSource,
} from '../../core/calendar/calendar-source';
import { Today, addDays } from '../../core/time';
import { habitEvents } from './habit-calendar';

/**
 * Calendar source of the habits widget (calendar-occurrences spec 3.5): one event per checked day
 * and per planned day from today on. Reads the repository, not `HabitStore`.
 */
@Injectable({ providedIn: 'root' })
export class HabitsCalendarSource implements CalendarSource {
  private readonly repository = inject(HABIT_REPOSITORY);
  private readonly today = inject(Today);

  /** A rejection of either read rejects the source. */
  async listEvents(range: CalendarRange): Promise<readonly CalendarEvent[]> {
    const days = rangeLocalDates(range);
    const [habits, checks] = await Promise.all([
      this.repository.list(),
      // One day wider on each side: a reminder in another zone can shift a habit day (spec K5).
      this.repository.checks({ from: addDays(days.firstOn, -1), to: addDays(days.lastOn, 1) }),
    ]);
    return habitEvents(habits, checks, range, days, this.today.date());
  }
}
