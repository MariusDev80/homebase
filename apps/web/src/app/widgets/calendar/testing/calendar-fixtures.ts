import type { CalendarEvent, CalendarEventStatus, CalendarTone } from '../../../core/calendar';

// Fixtures F1 to F11 of ADR-004 section 4.1 (F12 to F17: calendar-occurrences spec 3.3) (Paris UTC+1, Santiago UTC-3 in November 2026).

export const F8_TITLE = '<img src=x onerror=alert(1)>';
export const F9_TITLE = `F9 ${'x'.repeat(196)}`;

function timed(
  key: string,
  start: string,
  timeZone: string,
  title: string,
  tone: CalendarTone = 'accent',
): CalendarEvent {
  return {
    id: `reminders:${key}:`,
    sourceType: 'reminders',
    sourceId: key,
    occurrenceKey: null,
    title,
    time: { kind: 'timed', start, end: null, timeZone },
    tone,
  };
}

function allDay(
  key: string,
  startOn: string,
  lastOn: string,
  title: string,
  tone: CalendarTone,
  status?: CalendarEventStatus,
): CalendarEvent {
  return {
    id: `todo:${key}:`,
    sourceType: 'todo',
    sourceId: key,
    occurrenceKey: null,
    title,
    time: { kind: 'all-day', startOn, lastOn },
    tone,
    ...(status === undefined ? {} : { status }),
  };
}

export const F10_COUNT = 12;

/** Within each day, in the aggregator order (all-day first, then timed by start); days are not sorted. */
export const CALENDAR_FIXTURES: readonly CalendarEvent[] = [
  allDay('F4', '2026-11-18', '2026-11-18', 'F4 Tache en retard', 'danger', 'overdue'),
  allDay('F8', '2026-11-19', '2026-11-19', F8_TITLE, 'neutral'),
  allDay('F5', '2026-11-23', '2026-11-25', 'F5 Tache sur trois jours', 'neutral'),
  timed('F6', '2026-10-25T00:30:00.000Z', 'Europe/Paris', 'F6 Pli changement heure'),
  timed('F3', '2026-11-18T01:00:00.000Z', 'Europe/Paris', 'F3 Rappel 02:00 Paris'),
  timed('F1', '2026-11-18T08:00:00.000Z', 'Europe/Paris', 'F1 Rappel 09:00 Paris'),
  timed('F2', '2026-11-18T22:30:00.000Z', 'Europe/Paris', 'F2 Rappel 23:30 Paris'),
  timed('F9', '2026-11-19T10:00:00.000Z', 'Europe/Paris', F9_TITLE),
  timed('F7', '2026-11-19T14:00:00.000Z', 'America/Montreal', 'F7 Rappel Montreal'),
  ...Array.from({ length: F10_COUNT }, (_, i) =>
    timed(
      `F10-${i + 1}`,
      `2026-11-20T${String(7 + i).padStart(2, '0')}:00:00.000Z`,
      'Europe/Paris',
      `F10 Rappel ${i + 1}`,
    ),
  ),
  timed('F11', '2026-11-22T22:30:00.000Z', 'Europe/Paris', 'F11 Dimanche 23:30'),
];

export const fixture = (key: string): CalendarEvent => {
  const found = CALENDAR_FIXTURES.find((e) => e.sourceId === key);
  if (!found) throw new Error(`Unknown fixture ${key}`);
  return found;
};

function habit(
  key: string,
  day: string,
  title: string,
  tone: CalendarTone,
  status: CalendarEventStatus,
  start?: string,
): CalendarEvent {
  return {
    id: `habits:${key}:${day}`,
    sourceType: 'habits',
    sourceId: key,
    occurrenceKey: day,
    title,
    time:
      start === undefined
        ? { kind: 'all-day', startOn: day, lastOn: day }
        : { kind: 'timed', start, end: null, timeZone: 'Europe/Paris' },
    tone,
    status,
  };
}

/**
 * Fixtures F12 to F17 (calendar-occurrences spec 3.3), kept apart from CALENDAR_FIXTURES so that
 * the counts of the other specs do not change. In the aggregator order (by day; the 20th follows K18).
 */
export const OCCURRENCE_FIXTURES: readonly CalendarEvent[] = [
  habit('F13', '2026-11-18', 'F13 Habitude faite', 'success', 'done'),
  habit('F14', '2026-11-20', 'F14 Habitude a faire', 'neutral', 'planned'),
  allDay('F16', '2026-11-20', '2026-11-20', 'A', 'neutral'),
  habit(
    'F15',
    '2026-11-20',
    'F15 Habitude 08:00',
    'neutral',
    'planned',
    '2026-11-20T07:00:00.000Z',
  ),
  timed('F17', '2026-11-20T08:00:00.000Z', 'Europe/Paris', 'F17 Rappel 09:00'),
  {
    id: 'todo:F12:2026-11-25',
    sourceType: 'todo',
    sourceId: 'F12',
    occurrenceKey: '2026-11-25',
    title: 'F12 Tache repetee prevue',
    time: { kind: 'all-day', startOn: '2026-11-25', lastOn: '2026-11-25' },
    tone: 'neutral',
    status: 'projected',
  },
];

export const occurrenceFixture = (key: string): CalendarEvent => {
  const found = OCCURRENCE_FIXTURES.find((e) => e.sourceId === key);
  if (!found) throw new Error(`Unknown fixture ${key}`);
  return found;
};
