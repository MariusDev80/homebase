import * as v from 'valibot';
import { calendarConfigSchema, calendarDefaults, calendarMigrations } from './calendar.config';
import { calendarWidget } from './calendar.definition';

describe('calendar configuration v2 (CA-CO4-1)', () => {
  it('declares version 2 with the v1 migration', () => {
    expect(calendarWidget.config.version).toBe(2);
    expect(calendarWidget.config.migrations).toBe(calendarMigrations);
  });

  it('migrates a v1 configuration without losing anything', () => {
    const migrated = calendarMigrations[1]({ view: 'month', agendaDays: 7 });
    expect(migrated).toEqual({ view: 'month', agendaDays: 7, hiddenSources: [] });
    expect(v.safeParse(calendarConfigSchema, migrated).success).toBe(true);
  });

  it('turns a non-object into something the schema refuses', () => {
    expect(v.safeParse(calendarConfigSchema, calendarMigrations[1](null)).success).toBe(false);
    expect(v.safeParse(calendarConfigSchema, calendarMigrations[1]([1])).success).toBe(false);
  });

  it('refuses 17 entries and an invalid type id', () => {
    const base = { view: 'agenda', agendaDays: 14 };
    const types = Array.from({ length: 17 }, (_, i) => `source-${String.fromCharCode(97 + i)}`);
    expect(
      v.safeParse(calendarConfigSchema, { ...base, hiddenSources: types.slice(0, 16) }).success,
    ).toBe(true);
    expect(v.safeParse(calendarConfigSchema, { ...base, hiddenSources: types }).success).toBe(
      false,
    );
    expect(v.safeParse(calendarConfigSchema, { ...base, hiddenSources: ['Habits!'] }).success).toBe(
      false,
    );
  });

  it('has valid defaults with nothing hidden', () => {
    expect(calendarDefaults().hiddenSources).toEqual([]);
    expect(v.safeParse(calendarConfigSchema, calendarDefaults()).success).toBe(true);
  });
});
