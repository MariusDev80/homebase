import * as v from 'valibot';

/** Reminders are global data (spec M9): nothing to configure. */
export const remindersConfigSchema = v.object({});
export type RemindersConfig = v.InferOutput<typeof remindersConfigSchema>;
export const REMINDERS_CONFIG_VERSION = 1;
export const remindersDefaults = (): RemindersConfig => ({});
