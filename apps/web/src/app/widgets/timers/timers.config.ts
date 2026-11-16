import * as v from 'valibot';

/** Timers, stopwatches, alarms and history are global data (spec M9): nothing to configure. */
export const timersConfigSchema = v.object({});
export type TimersConfig = v.InferOutput<typeof timersConfigSchema>;
export const TIMERS_CONFIG_VERSION = 1;
export const timersDefaults = (): TimersConfig => ({});
