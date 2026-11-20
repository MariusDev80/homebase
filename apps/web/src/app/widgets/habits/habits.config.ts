import * as v from 'valibot';

/** Habits are global data (spec habits H5): nothing to configure. */
export const habitsConfigSchema = v.object({});
export type HabitsConfig = v.InferOutput<typeof habitsConfigSchema>;
export const HABITS_CONFIG_VERSION = 1;
export const habitsDefaults = (): HabitsConfig => ({});
