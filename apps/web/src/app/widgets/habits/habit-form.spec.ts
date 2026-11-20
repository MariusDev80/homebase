import { DataError } from '../../data';
import type { Habit, HabitInput } from '../../data';
import {
  effectiveReminderDays,
  formToInput,
  formWarnings,
  habitToForm,
  newHabitForm,
  problemOf,
} from './habit-form';
import type { HabitFormState } from './habit-form';

const TODAY = '2026-11-17';
const ZONE = 'Europe/Paris';
const ALL = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

function habitOf(input: HabitInput): Habit {
  return {
    id: 'h1',
    title: input.title,
    schedule: input.schedule,
    startOn: input.startOn,
    archivedAt: null,
    reminder:
      input.reminder === null
        ? null
        : {
            ...input.reminder,
            reminderId: 'r1',
            nextFireAt: null,
            nextFireKey: null,
            status: 'scheduled',
          },
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  };
}

function valid(patch: Partial<HabitFormState> = {}): HabitFormState {
  return { ...newHabitForm(TODAY, ZONE), title: 'Read', ...patch };
}

function errorsOf(state: HabitFormState): Record<string, string> {
  const result = formToInput(state, TODAY);
  if (!('errors' in result)) throw new Error('expected refusals');
  return result.errors as Record<string, string>;
}

describe('formToInput', () => {
  it('builds a daily habit without reminder from a new form', () => {
    expect(formToInput(valid(), TODAY)).toEqual({
      input: {
        title: 'Read',
        schedule: { kind: 'days', days: [...ALL] },
        startOn: TODAY,
        reminder: null,
      },
    });
  });

  it.each<HabitInput>([
    {
      title: 'Balance',
      schedule: { kind: 'days', days: ['MO', 'WE', 'FR'] },
      startOn: '2026-11-02',
      reminder: { time: '19:00', days: ['MO'], timeZone: ZONE, enabled: true },
    },
    {
      title: 'Gym',
      schedule: { kind: 'weekly', target: 3 },
      startOn: TODAY,
      reminder: { time: '07:30', days: [...ALL], timeZone: 'America/Montreal', enabled: true },
    },
    {
      title: 'Asleep',
      schedule: { kind: 'days', days: ['SU'] },
      startOn: '2026-01-01',
      reminder: { time: '08:00', days: ['SU'], timeZone: ZONE, enabled: false },
    },
    {
      title: 'Plain',
      schedule: { kind: 'weekly', target: 7 },
      startOn: '2026-11-17',
      reminder: null,
    },
  ])('round-trips habitToForm(formToInput(x)) for %#', (input) => {
    const state = habitToForm(habitOf(input), ZONE);
    expect(formToInput(state, TODAY)).toEqual({ input });
  });

  it('trims the title and counts code points', () => {
    expect(formToInput(valid({ title: '  Run  ' }), TODAY)).toMatchObject({
      input: { title: 'Run' },
    });
    expect('input' in formToInput(valid({ title: '😀'.repeat(200) }), TODAY)).toBe(true);
    expect(errorsOf(valid({ title: '😀'.repeat(201) }))['title']).toBeDefined();
  });

  it.each(['', '   ', 'a\u0000b', 'a\u202Eb'])('refuses the title %j', (title) => {
    expect(errorsOf(valid({ title }))['title']).toBe('widgets.habits.errors.title');
  });

  it('refuses a daily habit without a day', () => {
    expect(errorsOf(valid({ days: [] }))['days']).toBe('widgets.habits.errors.days');
  });

  it.each(['0', '8', '', 'x', '1.5', '-1', '10'])('refuses the target %j', (target) => {
    expect(errorsOf(valid({ kind: 'weekly', target }))['target']).toBe(
      'widgets.habits.errors.target',
    );
  });

  it.each(['1', '7'])('accepts the target %s', (target) => {
    expect('input' in formToInput(valid({ kind: 'weekly', target }), TODAY)).toBe(true);
  });

  it('ignores the hidden field of the other frequency', () => {
    expect('input' in formToInput(valid({ kind: 'weekly', target: '2', days: [] }), TODAY)).toBe(
      true,
    );
    expect('input' in formToInput(valid({ kind: 'days', target: 'x' }), TODAY)).toBe(true);
  });

  it.each(['', '2026-13-01', '2026-11-18', 'tomorrow'])('refuses the start date %j', (startOn) => {
    expect(errorsOf(valid({ startOn }))['startOn']).toBe('widgets.habits.errors.startOn');
  });

  it('accepts a start date of today and of the past', () => {
    expect('input' in formToInput(valid({ startOn: TODAY }), TODAY)).toBe(true);
    expect('input' in formToInput(valid({ startOn: '2025-01-01' }), TODAY)).toBe(true);
  });

  it('checks the reminder only when it is on', () => {
    const bad = { reminderTime: '24:00', reminderDays: [] };
    expect('input' in formToInput(valid(bad), TODAY)).toBe(true);
    const errors = errorsOf(valid({ ...bad, reminderOn: true }));
    expect(errors['reminderTime']).toBe('widgets.habits.errors.reminderTime');
    expect(errors['reminderDays']).toBe('widgets.habits.errors.reminderDays');
  });

  it.each(['7:00', '07:00:00', '12:60', ''])('refuses the reminder time %j', (reminderTime) => {
    expect(errorsOf(valid({ reminderOn: true, reminderTime }))['reminderTime']).toBeDefined();
  });

  it('defaults the reminder days to the habit days, or every day when weekly', () => {
    const daily = valid({ days: ['MO', 'FR'], reminderOn: true });
    expect(effectiveReminderDays(daily)).toEqual(['MO', 'FR']);
    expect(formToInput(daily, TODAY)).toMatchObject({
      input: { reminder: { days: ['MO', 'FR'], timeZone: ZONE, enabled: true } },
    });
    expect(effectiveReminderDays(valid({ kind: 'weekly' }))).toHaveLength(7);
  });

  it('keeps an existing reminder disabled when switched off, and restores the stored values when the hidden ones are unreadable', () => {
    const base = habitToForm(
      habitOf({
        title: 'X',
        schedule: { kind: 'days', days: ['MO'] },
        startOn: TODAY,
        reminder: { time: '08:00', days: ['MO'], timeZone: ZONE, enabled: true },
      }),
      ZONE,
    );
    expect(formToInput({ ...base, reminderOn: false }, TODAY)).toMatchObject({
      input: { reminder: { enabled: false, time: '08:00' } },
    });
    expect(
      formToInput({ ...base, reminderOn: false, reminderTime: '', reminderDays: [] }, TODAY),
    ).toMatchObject({
      input: { reminder: { enabled: false, time: '08:00', days: ['MO'] } },
    });
  });
});

describe('formWarnings', () => {
  it('warns when the time falls in the spring gap of today', () => {
    const state = valid({ reminderOn: true, reminderTime: '02:30' });
    expect(formWarnings(state, '2027-03-28')).toEqual([
      { key: 'time.nonexistent', params: { time: '03:30' } },
    ]);
  });

  it('warns about the autumn fold and stays silent otherwise', () => {
    const state = valid({ reminderOn: true, reminderTime: '02:30' });
    expect(formWarnings(state, '2026-10-25')).toEqual([{ key: 'time.ambiguous' }]);
    expect(formWarnings(state, TODAY)).toEqual([]);
    expect(formWarnings({ ...state, reminderOn: false }, '2027-03-28')).toEqual([]);
  });
});

describe('problemOf', () => {
  const rust = (field: string) =>
    new DataError('invalid_input', 'Invalid input', { cause: { kind: 'invalid_input', field } });

  it.each([
    ['title', 'title'],
    ['schedule.days', 'days'],
    ['schedule.target', 'target'],
    ['startOn', 'startOn'],
    ['reminder.time', 'reminderTime'],
    ['reminder.days', 'reminderDays'],
  ])('puts the Rust field %s on %s', (field, expected) => {
    expect(problemOf(rust(field))).toEqual({
      field: expected,
      key: `widgets.habits.errors.${expected}`,
    });
  });

  it('routes the other refusals to the form', () => {
    expect(problemOf(rust('dayOn')).field).toBe('form');
    expect(problemOf(new DataError('forbidden', 'x'))).toEqual({
      field: 'form',
      key: 'widgets.habits.limit',
    });
    expect(problemOf(new DataError('unavailable', 'x')).key).toBe('common.desktopOnly');
    expect(problemOf(new Error('x')).key).toBe('widgets.habits.errors.unknown');
  });
});
