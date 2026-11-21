import type { Injector } from '@angular/core';
import { REMINDER_REPOSITORY } from '../../data/schedule.tokens';
import { Today, UserTimeZone, addDays, startOfDay } from '../time';
import { CalendarAggregator } from './calendar-aggregator';
import type { CalendarRange } from './calendar-source';

const SEED_PREFIX = 'pv-c1-';

/**
 * Development only (installed from app.config.ts behind `ngDevMode`, absent from production
 * builds): exposes `window.__hbCalendar` to time the aggregator from the console (spec PV-C1).
 */
export function installCalendarDebug(injector: Injector): void {
  const aggregator = injector.get(CalendarAggregator);
  const reminders = injector.get(REMINDER_REPOSITORY);
  const today = injector.get(Today);
  const zone = injector.get(UserTimeZone);

  const tools = {
    listEvents: (range: CalendarRange) => aggregator.listEvents(range),
    /** Times listEvents over `days` days starting today (default 42, as the month grid). */
    measure: async (days = 42) => {
      const timeZone = zone.id();
      const firstOn = today.date();
      const range: CalendarRange = {
        from: startOfDay(firstOn, timeZone),
        to: startOfDay(addDays(firstOn, days), timeZone),
        timeZone,
      };
      const started = performance.now();
      const result = await aggregator.listEvents(range);
      const ms = Math.round(performance.now() - started);
      return {
        ms,
        events: result.events.length,
        failedSources: result.failedSources,
        truncated: result.truncated,
      };
    },
    /** Creates `count` daily reminders (titles `pv-c1-<i>`) starting today at 09:00. */
    seedReminders: async (count: number) => {
      const startLocal = `${today.date()}T09:00:00` as const;
      for (let i = 0; i < count; i++) {
        await reminders.create({
          title: `${SEED_PREFIX}${i}`,
          startLocal,
          timeZone: zone.id(),
          rrule: 'FREQ=DAILY',
          exdates: [],
          enabled: true,
        });
      }
    },
    /** Removes the reminders created by `seedReminders`. */
    clearSeeded: async () => {
      for (const reminder of await reminders.list()) {
        if (reminder.title.startsWith(SEED_PREFIX)) await reminders.remove(reminder.id);
      }
    },
  };
  Object.assign(window, { __hbCalendar: tools });
}
