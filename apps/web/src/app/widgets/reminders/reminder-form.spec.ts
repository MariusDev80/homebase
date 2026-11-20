import { TimeError } from '../../core/time';
import { DataError } from '../../data';
import type { Reminder } from '../../data';
import {
  fieldShown,
  formToInput,
  formWarnings,
  inputToForm,
  mergeExdates,
  newFormState,
  nthWeekdayOf,
  problemOf,
  repeatOptions,
  scheduleOf,
} from './reminder-form';
import type { FormState } from './reminder-form';

const ZONE = 'Europe/Paris';
// 2026-11-16 11:00 in Paris (CET).
const NOW = '2026-11-16T10:00:00.000Z';

function state(change: Partial<FormState> = {}): FormState {
  return { ...newFormState('2026-11-18', '09:00'), title: 'Pay rent', ...change };
}

function rruleOf(change: Partial<FormState>): string | null {
  const result = formToInput(state(change), ZONE, NOW);
  if (!('input' in result)) throw new Error(JSON.stringify(result.errors));
  return result.input.rrule;
}

function reminder(rrule: string | null, startLocal = '2026-11-18T09:00:00'): Reminder {
  return {
    id: 'r1',
    title: 'T',
    startLocal,
    timeZone: ZONE,
    rrule,
    exdates: [],
    enabled: true,
    nextFireAt: null,
    nextFireKey: null,
    status: 'scheduled',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe('formToInput', () => {
  it('builds a one-shot reminder with the zone and a trimmed title', () => {
    const result = formToInput(state({ title: '  Pay rent  ' }), ZONE, NOW);
    expect(result).toEqual({
      input: {
        title: 'Pay rent',
        startLocal: '2026-11-18T09:00:00',
        timeZone: ZONE,
        rrule: null,
        exdates: [],
        enabled: true,
      },
    });
  });

  it.each([
    [{ repeat: 'daily' }, 'FREQ=DAILY'],
    [{ repeat: 'daily', interval: '3' }, 'FREQ=DAILY;INTERVAL=3'],
    [{ repeat: 'weekly', weekdays: ['WE', 'MO'] }, 'FREQ=WEEKLY;BYDAY=MO,WE'],
    [{ repeat: 'monthly-day', date: '2026-11-18' }, 'FREQ=MONTHLY;BYMONTHDAY=18'],
    [{ repeat: 'monthly-last', date: '2026-11-30' }, 'FREQ=MONTHLY;BYMONTHDAY=-1'],
    [{ repeat: 'monthly-nth', date: '2026-12-08' }, 'FREQ=MONTHLY;BYDAY=2TU'],
    [{ repeat: 'monthly-nth', date: '2026-12-29' }, 'FREQ=MONTHLY;BYDAY=-1TU'],
    [{ repeat: 'yearly', interval: '2' }, 'FREQ=YEARLY;INTERVAL=2'],
    [{ repeat: 'daily', end: 'count', count: '5' }, 'FREQ=DAILY;COUNT=5'],
  ] satisfies [Partial<FormState>, string][])('%j gives %s', (change, expected) => {
    expect(rruleOf(change)).toBe(expected);
  });

  it('ends a series on the last second of the chosen local day (31/12/2026, Paris)', () => {
    const rule = rruleOf({ repeat: 'daily', end: 'until', until: '2026-12-31', time: '23:30' });
    expect(rule).toBe('FREQ=DAILY;UNTIL=20261231T225959Z');
  });

  it('keeps a custom rule in canonical form', () => {
    const rule = rruleOf({ repeat: 'custom', customRule: 'FREQ=DAILY;INTERVAL=1;COUNT=3' });
    expect(rule).toBe('FREQ=DAILY;COUNT=3');
  });

  it('drops the exceptions of a one-shot reminder', () => {
    const result = formToInput(state({ exdates: ['2026-11-19T09:00:00'] }), ZONE, NOW);
    expect('input' in result && result.input.exdates).toEqual([]);
  });

  it('keeps the exceptions of a series', () => {
    const result = formToInput(
      state({ repeat: 'daily', exdates: ['2026-11-19T09:00:00'] }),
      ZONE,
      NOW,
    );
    expect('input' in result && result.input.exdates).toEqual(['2026-11-19T09:00:00']);
  });

  it('refuses each invalid field on that field', () => {
    const result = formToInput(
      state({
        title: ' ',
        date: '2026-02-30',
        time: '25:00',
        repeat: 'weekly',
        weekdays: [],
        interval: '53',
      }),
      ZONE,
      NOW,
    );
    expect('errors' in result && Object.keys(result.errors).sort()).toEqual([
      'date',
      'interval',
      'time',
      'title',
      'weekdays',
    ]);
  });

  it('refuses a count and an until date out of bounds', () => {
    const count = formToInput(state({ repeat: 'daily', end: 'count', count: '1001' }), ZONE, NOW);
    expect('errors' in count && count.errors.count).toBeDefined();
    const until = formToInput(
      state({ repeat: 'daily', end: 'until', until: '2026-11-01' }),
      ZONE,
      NOW,
    );
    expect('errors' in until && until.errors.until).toBeDefined();
  });

  it('refuses a one-shot reminder in the past (time today, date before)', () => {
    const today = formToInput(state({ date: '2026-11-16', time: '10:00' }), ZONE, NOW);
    expect('errors' in today && today.errors.time).toBe('widgets.reminders.errors.past');
    const before = formToInput(state({ date: '2026-11-10' }), ZONE, NOW);
    expect('errors' in before && before.errors.date).toBe('widgets.reminders.errors.past');
  });

  it('accepts a series that started in the past', () => {
    expect(rruleOf({ repeat: 'daily', date: '2026-01-01' })).toBe('FREQ=DAILY');
  });

  it('refuses a date more than 10 years ahead', () => {
    const far = formToInput(state({ date: '2036-11-17' }), ZONE, NOW);
    expect('errors' in far && far.errors.date).toBe('widgets.reminders.errors.tooFar');
    expect('input' in formToInput(state({ date: '2036-11-16' }), ZONE, NOW)).toBe(true);
  });
});

describe('inputToForm', () => {
  it.each([
    ['FREQ=DAILY', { repeat: 'daily' }],
    ['FREQ=DAILY;INTERVAL=3;COUNT=5', { repeat: 'daily', interval: '3', end: 'count', count: '5' }],
    ['FREQ=WEEKLY;BYDAY=MO,WE', { repeat: 'weekly', weekdays: ['MO', 'WE'] }],
    ['FREQ=MONTHLY;BYMONTHDAY=18', { repeat: 'monthly-day' }],
    ['FREQ=MONTHLY;BYDAY=3WE', { repeat: 'monthly-nth' }],
    ['FREQ=YEARLY', { repeat: 'yearly' }],
    ['FREQ=DAILY;UNTIL=20261231T225959Z', { repeat: 'daily', end: 'until', until: '2026-12-31' }],
  ] satisfies [string, Partial<FormState>][])('reads %s', (rrule, expected) => {
    expect(inputToForm(reminder(rrule))).toMatchObject(expected);
  });

  it('reads a last-day rule', () => {
    expect(inputToForm(reminder('FREQ=MONTHLY;BYMONTHDAY=-1', '2026-11-30T09:00:00')).repeat).toBe(
      'monthly-last',
    );
  });

  it('keeps a rule outside the choices as a custom rule', () => {
    for (const rrule of [
      'FREQ=MONTHLY;BYMONTHDAY=5', // not the day of the date
      'FREQ=MONTHLY;BYDAY=1MO', // not the weekday of the date
      'FREQ=DAILY;UNTIL=20261231T100000Z', // not the end of a local day
      'FREQ=NOPE',
    ]) {
      const form = inputToForm(reminder(rrule));
      expect(form.repeat).toBe('custom');
      expect(form.customRule).toBe(rrule);
    }
  });

  it('round-trips through formToInput', () => {
    for (const rrule of [
      null,
      'FREQ=DAILY',
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR',
      'FREQ=MONTHLY;BYMONTHDAY=18;COUNT=12',
      'FREQ=MONTHLY;BYDAY=3WE',
      'FREQ=YEARLY;UNTIL=20301231T225959Z',
      'FREQ=MONTHLY;BYMONTHDAY=5',
    ]) {
      const source = reminder(rrule);
      const result = formToInput(inputToForm(source), ZONE, NOW);
      expect('input' in result && result.input.rrule).toBe(rrule);
      expect('input' in result && result.input.startLocal).toBe(source.startLocal);
    }
  });
});

describe('nthWeekdayOf and repeatOptions', () => {
  it('numbers the weekday, or says last in the last 7 days', () => {
    expect(nthWeekdayOf('2026-12-01')).toEqual({ n: 1, weekday: 'TU' });
    expect(nthWeekdayOf('2026-12-08')).toEqual({ n: 2, weekday: 'TU' });
    expect(nthWeekdayOf('2026-12-24')).toEqual({ n: 4, weekday: 'TH' });
    expect(nthWeekdayOf('2026-12-25')).toEqual({ n: -1, weekday: 'FR' });
    expect(nthWeekdayOf('2027-02-22')).toEqual({ n: -1, weekday: 'MO' });
  });

  it('offers "last day" only on the last day of the month', () => {
    expect(repeatOptions('2026-11-29')).not.toContain('monthly-last');
    expect(repeatOptions('2026-11-30')).toContain('monthly-last');
    expect(repeatOptions('nope')).not.toContain('monthly-last');
  });
});

describe('formWarnings', () => {
  it('flags a time inside a gap with the time that will ring', () => {
    expect(formWarnings(state({ date: '2027-03-28', time: '02:30' }), ZONE)).toEqual([
      { key: 'time.nonexistent', params: { time: '03:30' } },
    ]);
  });

  it('flags a time that exists twice', () => {
    expect(formWarnings(state({ date: '2026-10-25', time: '02:30' }), ZONE)).toEqual([
      { key: 'time.ambiguous' },
    ]);
  });

  it('flags a monthly day above 28', () => {
    const warnings = formWarnings(state({ date: '2026-12-30', repeat: 'monthly-day' }), ZONE);
    expect(warnings).toEqual([{ key: 'widgets.reminders.monthDaySkipped' }]);
    expect(formWarnings(state({ date: '2026-12-28', repeat: 'monthly-day' }), ZONE)).toEqual([]);
  });
});

describe('problemOf', () => {
  it('places a refused field of a command', () => {
    const error = new DataError('invalid_input', 'x', {
      cause: { kind: 'invalid_input', field: 'title' },
    });
    expect(problemOf(error)).toEqual({ field: 'title', key: 'widgets.reminders.errors.title' });
  });

  it('places a nested rule error on the count or the end date', () => {
    const nested = (code: string) =>
      new DataError('invalid_input', 'x', {
        cause: { kind: 'time', error: { kind: 'invalid_rule', code } },
      });
    expect(problemOf(nested('count_and_until')).field).toBe('count');
    expect(problemOf(nested('until_not_utc')).field).toBe('until');
    expect(problemOf(nested('syntax')).field).toBe('repeat');
  });

  it('places a rule error of the engine by its part', () => {
    const rule = (part: string) =>
      new TimeError('invalid_rule', 'x', { rule: 'invalid_value', part });
    expect(problemOf(rule('INTERVAL')).field).toBe('interval');
    expect(problemOf(rule('BYDAY')).field).toBe('weekdays');
    expect(problemOf(rule('COUNT')).field).toBe('count');
  });

  it('keeps other failures on the form', () => {
    expect(problemOf(new DataError('unavailable', 'x'))).toEqual({
      field: 'form',
      key: 'common.desktopOnly',
    });
    expect(problemOf(new DataError('forbidden', 'x')).key).toBe('widgets.reminders.errors.limit');
    expect(problemOf(new Error('x')).field).toBe('form');
  });
});

describe('horizon of 10 years', () => {
  // Limit: 2036-11-16T10:00:00Z (11:00 in Paris), as next_after does in Rust.
  it('refuses the same day with a later time and accepts an earlier one', () => {
    const late = formToInput(state({ date: '2036-11-16', time: '12:00' }), ZONE, NOW);
    expect('errors' in late && late.errors.date).toBe('widgets.reminders.errors.tooFar');
    expect('input' in formToInput(state({ date: '2036-11-16', time: '10:00' }), ZONE, NOW)).toBe(
      true,
    );
  });

  it('bounds the end date of a series to the horizon, without throwing at 2199-12-31', () => {
    const far = formToInput(
      state({ repeat: 'daily', end: 'until', until: '2199-12-31' }),
      ZONE,
      NOW,
    );
    expect('errors' in far && far.errors.until).toBe('widgets.reminders.errors.tooFar');
    const ok = formToInput(
      state({ repeat: 'daily', end: 'until', until: '2036-11-16' }),
      ZONE,
      NOW,
    );
    expect('input' in ok).toBe(true);
  });
});

describe('scheduleOf', () => {
  it('ignores the title', () => {
    const result = scheduleOf(state({ title: '' }), ZONE, NOW);
    expect('schedule' in result && result.schedule.startLocal).toBe('2026-11-18T09:00:00');
  });

  it('skips the past check when the date, time and repetition did not change', () => {
    const past = state({ date: '2026-11-10' });
    expect('errors' in scheduleOf(past, ZONE, NOW, null)).toBe(true);
    expect('schedule' in scheduleOf(past, ZONE, NOW, past)).toBe(true);
    expect('errors' in scheduleOf(past, ZONE, NOW, { ...past, time: '08:00' })).toBe(true);
  });
});

describe('helpers', () => {
  it('merges exceptions without duplicates, sorted', () => {
    expect(
      mergeExdates(['2026-11-20T09:00:00', '2026-11-18T09:00:00'], ['2026-11-18T09:00:00']),
    ).toEqual(['2026-11-18T09:00:00', '2026-11-20T09:00:00']);
  });

  it('knows which fields are on screen', () => {
    expect(fieldShown(state(), 'interval')).toBe(false);
    expect(fieldShown(state({ repeat: 'daily' }), 'interval')).toBe(true);
    expect(fieldShown(state({ repeat: 'daily' }), 'count')).toBe(false);
    expect(fieldShown(state({ repeat: 'daily', end: 'count' }), 'count')).toBe(true);
    expect(fieldShown(state({ repeat: 'daily' }), 'weekdays')).toBe(false);
    expect(fieldShown(state({ repeat: 'custom' }), 'repeat')).toBe(false);
    expect(fieldShown(state({ repeat: 'custom', end: 'until' }), 'until')).toBe(false);
  });

  it('reads a last-day rule as custom unless the anchor is the last day', () => {
    expect(inputToForm(reminder('FREQ=MONTHLY;BYMONTHDAY=-1')).repeat).toBe('custom');
  });

  it('warns about a yearly 29 February', () => {
    expect(formWarnings(state({ date: '2028-02-29', repeat: 'yearly' }), ZONE)).toEqual([
      { key: 'widgets.reminders.leapDaySkipped' },
    ]);
  });
});
