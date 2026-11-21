import { InjectionToken } from '@angular/core';

/** `true` follows the height of the cell; tests set a number (jsdom has no layout). */
export const CALENDAR_MAX_EVENTS_PER_DAY = new InjectionToken<number | true>(
  'CALENDAR_MAX_EVENTS_PER_DAY',
  { providedIn: 'root', factory: () => true },
);
