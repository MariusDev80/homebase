export type SecondsRounding = 'ceil' | 'floor';

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;

function wholeSeconds(ms: number, rounding: SecondsRounding): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  const seconds = ms / MS_PER_SECOND;
  return rounding === 'ceil' ? Math.ceil(seconds) : Math.floor(seconds);
}

/**
 * A clock reading of a duration: `0:05`, `4:32`, `1:02:03`. A negative duration reads `0:00`.
 * A countdown rounds the seconds up (`ceil`: 4 001 ms reads `0:05`), a stopwatch down (`floor`).
 */
export function formatClock(ms: number, rounding: SecondsRounding = 'floor'): string {
  const total = wholeSeconds(ms, rounding);
  const hours = Math.floor(total / SECONDS_PER_HOUR);
  const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = total % SECONDS_PER_MINUTE;
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
  return `${minutes}:${ss}`;
}

export interface DurationParts {
  readonly days: number;
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
}

/** Integer division of a duration (not of a date) into days, hours, minutes and seconds (floor). */
export function durationParts(ms: number): DurationParts {
  const total = wholeSeconds(ms, 'floor');
  return {
    days: Math.floor(total / SECONDS_PER_DAY),
    hours: Math.floor((total % SECONDS_PER_DAY) / SECONDS_PER_HOUR),
    minutes: Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE),
    seconds: total % SECONDS_PER_MINUTE,
  };
}
