import * as v from 'valibot';

/** Bounds of the settings, in minutes (spec 4.8); the longest phase is far below the Rust limit. */
export const POMODORO_BOUNDS = {
  workMinutes: { min: 1, max: 180 },
  shortBreakMinutes: { min: 1, max: 60 },
  longBreakMinutes: { min: 1, max: 60 },
  longBreakEvery: { min: 2, max: 8 },
} as const;

export type PomodoroSettingKey = keyof typeof POMODORO_BOUNDS;

const bounded = (key: PomodoroSettingKey) =>
  v.pipe(
    v.number(),
    v.integer(),
    v.minValue(POMODORO_BOUNDS[key].min),
    v.maxValue(POMODORO_BOUNDS[key].max),
  );

export const pomodoroConfigSchema = v.object({
  workMinutes: bounded('workMinutes'),
  shortBreakMinutes: bounded('shortBreakMinutes'),
  longBreakMinutes: bounded('longBreakMinutes'),
  longBreakEvery: bounded('longBreakEvery'),
});
export type PomodoroConfig = v.InferOutput<typeof pomodoroConfigSchema>;
export const POMODORO_CONFIG_VERSION = 1;
export const pomodoroDefaults = (): PomodoroConfig => ({
  workMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
});
