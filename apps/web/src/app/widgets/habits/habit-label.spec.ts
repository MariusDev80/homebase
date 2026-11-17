import {
  cellLabel,
  reminderLabel,
  scheduleLabel,
  streakTexts,
  weekProgressLabel,
} from './habit-label';
import type { HabitLabelFormat } from './habit-label';

const TABLE: Record<string, string> = {
  'widgets.habits.join': '{a}, {b}',
  'widgets.habits.everyDay': 'Tous les jours',
  'widgets.habits.timesPerWeek': '{count} fois par semaine',
  'widgets.habits.weekdaysAbbr.MO': 'lun',
  'widgets.habits.weekdaysAbbr.WE': 'mer',
  'widgets.habits.weekdaysAbbr.FR': 'ven',
  'widgets.habits.reminderAt': 'Rappel à {time}',
  'widgets.habits.reminderOff': 'Rappel désactivé ({time})',
  'widgets.habits.reminderZone': '{text} ({zone})',
  'widgets.habits.notExpected': 'jour non prévu',
  'widgets.habits.todayFlag': "aujourd'hui",
  'widgets.habits.beforeStart': "avant le début de l'habitude",
  'widgets.habits.streak': 'Série : {count}',
  'widgets.habits.streakDaysSr': "{count} jours prévus d'affilée",
  'widgets.habits.streakWeeksSr': "{count} semaines d'affilée",
  'widgets.habits.weekProgress': '{done}/{required} cette semaine',
};

const fmt: HabitLabelFormat = {
  t: (key, params) =>
    (TABLE[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? '')),
  formatLongDate: (date) => `long(${date})`,
};

describe('scheduleLabel', () => {
  it('names the days in week order, capitalised', () => {
    expect(scheduleLabel({ kind: 'days', days: ['FR', 'MO', 'WE'] }, fmt)).toBe('Lun, mer, ven');
  });

  it('says every day for the seven days', () => {
    const all = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
    expect(scheduleLabel({ kind: 'days', days: all }, fmt)).toBe('Tous les jours');
  });

  it('counts the times per week', () => {
    expect(scheduleLabel({ kind: 'weekly', target: 3 }, fmt)).toBe('3 fois par semaine');
  });
});

describe('reminderLabel', () => {
  it('shows the time, with the city only when the zone differs from the user', () => {
    const reminder = { time: '07:30', timeZone: 'Europe/Paris', enabled: true };
    expect(reminderLabel(reminder, 'Europe/Paris', fmt)).toBe('Rappel à 07:30');
    expect(reminderLabel(reminder, 'America/Montreal', fmt)).toBe('Rappel à 07:30 (Paris)');
    expect(
      reminderLabel({ ...reminder, timeZone: 'America/Port_of_Spain' }, 'Europe/Paris', fmt),
    ).toBe('Rappel à 07:30 (Port of Spain)');
  });

  it('says so when the reminder is disabled', () => {
    expect(
      reminderLabel(
        { time: '07:30', timeZone: 'Europe/Paris', enabled: false },
        'Europe/Paris',
        fmt,
      ),
    ).toBe('Rappel désactivé (07:30)');
  });
});

describe('cellLabel', () => {
  const plain = { expected: true, today: false, beforeStart: false };

  it('names the habit and the day', () => {
    expect(cellLabel('Read', '2026-11-17', plain, fmt)).toBe('Read, long(2026-11-17)');
  });

  it('flags today, an unplanned day and a day before the start', () => {
    expect(cellLabel('Read', '2026-11-17', { ...plain, today: true }, fmt)).toBe(
      "Read, long(2026-11-17), aujourd'hui",
    );
    expect(cellLabel('Read', '2026-11-17', { ...plain, expected: false }, fmt)).toBe(
      'Read, long(2026-11-17), jour non prévu',
    );
    expect(cellLabel('Read', '2026-11-10', { ...plain, beforeStart: true }, fmt)).toBe(
      "Read, long(2026-11-10), avant le début de l'habitude",
    );
  });
});

describe('streak and progress texts', () => {
  it('adds a plus when truncated and picks the unit', () => {
    expect(streakTexts({ count: 12, unit: 'days', truncated: false }, fmt)).toEqual({
      text: 'Série : 12',
      sr: "12 jours prévus d'affilée",
    });
    expect(streakTexts({ count: 57, unit: 'weeks', truncated: true }, fmt)).toEqual({
      text: 'Série : 57+',
      sr: "57+ semaines d'affilée",
    });
  });

  it('writes the weekly progress', () => {
    expect(weekProgressLabel({ done: 1, required: 3 }, fmt)).toBe('1/3 cette semaine');
  });
});
