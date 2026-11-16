import * as v from 'valibot';
import { SCHEDULE_LIMITS } from '../../data';
import { pomodoroWidget } from './pomodoro.definition';
import { POMODORO_BOUNDS, pomodoroConfigSchema } from './pomodoro.config';

describe('pomodoroWidget', () => {
  it('declares the contract of the spec (4.8)', () => {
    expect(pomodoroWidget.type).toBe('pomodoro');
    expect(pomodoroWidget.icon).toBe('pi pi-clock');
    expect(pomodoroWidget.size).toEqual({
      min: { w: 3, h: 3 },
      default: { w: 3, h: 4 },
      max: { w: 6, h: 6 },
    });
    expect(pomodoroWidget.permissions).toEqual(['notifications']);
    expect(pomodoroWidget.maxInstances).toBe(1);
    expect(pomodoroWidget.config.version).toBe(1);
    expect(pomodoroWidget.config.migrations).toEqual({});
  });

  it('has the default config of the spec, which validates', () => {
    const defaults = pomodoroWidget.config.defaults();
    expect(defaults).toEqual({
      workMinutes: 25,
      shortBreakMinutes: 5,
      longBreakMinutes: 15,
      longBreakEvery: 4,
    });
    expect(v.safeParse(pomodoroConfigSchema, defaults).success).toBe(true);
  });

  it.each([
    ['workMinutes', 0, 181],
    ['shortBreakMinutes', 0, 61],
    ['longBreakMinutes', 0, 61],
    ['longBreakEvery', 1, 9],
  ] as const)('bounds %s', (key, below, above) => {
    const base = pomodoroWidget.config.defaults();
    const parse = (value: number) =>
      v.safeParse(pomodoroConfigSchema, { ...base, [key]: value }).success;
    expect(parse(below)).toBe(false);
    expect(parse(above)).toBe(false);
    expect(parse(POMODORO_BOUNDS[key].min)).toBe(true);
    expect(parse(POMODORO_BOUNDS[key].max)).toBe(true);
    expect(v.safeParse(pomodoroConfigSchema, { ...base, [key]: 2.5 }).success).toBe(false);
  });

  it('keeps every duration within the limits of the scheduler', () => {
    for (const key of ['workMinutes', 'shortBreakMinutes', 'longBreakMinutes'] as const) {
      expect(POMODORO_BOUNDS[key].min * 60_000).toBeGreaterThanOrEqual(
        SCHEDULE_LIMITS.durationMinMs,
      );
      expect(POMODORO_BOUNDS[key].max * 60_000).toBeLessThanOrEqual(SCHEDULE_LIMITS.durationMaxMs);
    }
  });

  it('loads its component lazily', async () => {
    const component = await pomodoroWidget.loadComponent();
    expect(component.name).toMatch(/PomodoroComponent$/);
  });
});
