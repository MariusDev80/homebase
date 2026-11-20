import {
  cellLabel,
  reminderLabel,
  scheduleLabel,
  historyStreakText,
  rateText,
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
  'widgets.habits.streakDaysSr_one': "{count} jour prévu d'affilée",
  'widgets.habits.streakDaysSr_other': "{count} jours prévus d'affilée",
  'widgets.habits.streakWeeksSr_one': "{count} semaine d'affilée",
  'widgets.habits.streakWeeksSr_other': "{count} semaines d'affilée",
  'widgets.habits.historyStreakNone': 'Série actuelle : aucune',
  'widgets.habits.historyStreakDays_one': "Série actuelle : {count} jour prévu d'affilée",
  'widgets.habits.historyStreakDays_other': "Série actuelle : {count} jours prévus d'affilée",
  'widgets.habits.historyStreakWeeks_one': "Série actuelle : {count} semaine d'affilée",
  'widgets.habits.historyStreakWeeks_other': "Série actuelle : {count} semaines d'affilée",
  'widgets.habits.rate30': 'Réussite sur 30 jours : {rate} % ({done}/{expected})',
  'widgets.habits.rate4w': 'Sur 4 semaines : {done}/{expected}',
  'widgets.habits.noRate': 'Réussite : pas encore de données',
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

  it('uses the singular for 0 and 1 in the screen-reader text', () => {
    expect(streakTexts({ count: 1, unit: 'days', truncated: false }, fmt).sr).toBe(
      "1 jour prévu d'affilée",
    );
    expect(streakTexts({ count: 0, unit: 'weeks', truncated: false }, fmt).sr).toBe(
      "0 semaine d'affilée",
    );
    expect(streakTexts({ count: 2, unit: 'weeks', truncated: false }, fmt).sr).toBe(
      "2 semaines d'affilée",
    );
  });

  it('writes the weekly progress', () => {
    expect(weekProgressLabel({ done: 1, required: 3 }, fmt)).toBe('1/3 cette semaine');
  });
});

describe('historyStreakText', () => {
  const days = (count: number, truncated = false) =>
    historyStreakText({ count, unit: 'days', truncated }, fmt);
  const weeks = (count: number, truncated = false) =>
    historyStreakText({ count, unit: 'weeks', truncated }, fmt);

  it('says none for zero, whatever the unit', () => {
    expect(days(0)).toBe('Série actuelle : aucune');
    expect(weeks(0)).toBe('Série actuelle : aucune');
  });

  it('uses the singular for 1 and the plural from 2', () => {
    expect(days(1)).toBe("Série actuelle : 1 jour prévu d'affilée");
    expect(days(2)).toBe("Série actuelle : 2 jours prévus d'affilée");
    expect(weeks(1)).toBe("Série actuelle : 1 semaine d'affilée");
    expect(weeks(2)).toBe("Série actuelle : 2 semaines d'affilée");
  });

  it('adds a plus when truncated', () => {
    expect(days(57, true)).toBe("Série actuelle : 57+ jours prévus d'affilée");
    expect(weeks(0, true)).toBe("Série actuelle : 0+ semaine d'affilée");
  });
});

describe('rateText', () => {
  it('writes the 30-day rate of a days habit', () => {
    expect(rateText('days', { done: 6, expected: 7 }, 86, fmt)).toBe(
      'Réussite sur 30 jours : 86 % (6/7)',
    );
  });

  it('writes the 4-week rate of a weekly habit', () => {
    expect(rateText('weeks', { done: 2, expected: 2 }, 100, fmt)).toBe('Sur 4 semaines : 2/2');
  });

  it('says there is no data when the percentage is null', () => {
    expect(rateText('days', { done: 0, expected: 0 }, null, fmt)).toBe(
      'Réussite : pas encore de données',
    );
    expect(rateText('weeks', { done: 0, expected: 0 }, null, fmt)).toBe(
      'Réussite : pas encore de données',
    );
  });
});
