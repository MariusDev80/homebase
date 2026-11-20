import { durationParts } from '../../core/time';
import { DataError, SCHEDULE_LIMITS, type TimeSessionKind } from '../../data';
import { commandErrorDetails } from '../../core/schedule';

export type Translate = (key: string, params?: Record<string, unknown>) => string;

export const MS_PER_MINUTE = 60_000;
export const MAX_MINUTES = Math.floor(SCHEDULE_LIMITS.durationMaxMs / MS_PER_MINUTE);
export const PRESET_MINUTES: readonly number[] = [1, 5, 10, 15, 30];

export type DurationParse =
  | { readonly kind: 'ok'; readonly ms: number }
  | { readonly kind: 'error'; readonly field: 'minutes' | 'seconds' | 'range' };

function wholeNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  return /^\d{1,5}$/.test(trimmed) ? Number(trimmed) : null;
}

/** Minutes (0..1440) and seconds (0..59) as typed; the total must fit SCHEDULE_LIMITS. */
export function parseTimerDuration(minutesText: string, secondsText: string): DurationParse {
  const minutes = wholeNumber(minutesText);
  if (minutes === null || minutes > MAX_MINUTES) return { kind: 'error', field: 'minutes' };
  const seconds = wholeNumber(secondsText);
  if (seconds === null || seconds > 59) return { kind: 'error', field: 'seconds' };
  const ms = minutes * MS_PER_MINUTE + seconds * 1000;
  if (ms < SCHEDULE_LIMITS.durationMinMs || ms > SCHEDULE_LIMITS.durationMaxMs) {
    return { kind: 'error', field: 'range' };
  }
  return { kind: 'ok', ms };
}

/** "1 h 05 min", "12 min", "34 s", "2 j 3 h" (a duration, not a date). */
export function durationLabel(ms: number, t: Translate): string {
  const { days, hours, minutes, seconds } = durationParts(ms);
  if (days > 0) return t('duration.days', { d: days, h: hours });
  if (hours > 0) return t('duration.short', { h: hours, m: String(minutes).padStart(2, '0') });
  if (minutes > 0) return t('duration.minutes', { m: minutes });
  return t('duration.seconds', { s: seconds });
}

export function sessionNameKey(kind: TimeSessionKind): string {
  switch (kind) {
    case 'stopwatch':
      return 'widgets.timers.kind.stopwatch';
    case 'countdown':
      return 'widgets.timers.kind.countdown';
    case 'pomodoro_work':
      return 'widgets.timers.kind.pomodoroWork';
    case 'pomodoro_short_break':
      return 'widgets.timers.kind.pomodoroShortBreak';
    case 'pomodoro_long_break':
      return 'widgets.timers.kind.pomodoroLongBreak';
  }
}

export function sessionIcon(kind: TimeSessionKind): string {
  switch (kind) {
    case 'stopwatch':
      return 'pi pi-stopwatch';
    case 'countdown':
      return 'pi pi-hourglass';
    default:
      return 'pi pi-clock';
  }
}

export type ErrorContext = 'session' | 'alarm';

/** i18n key of the message for a failed command (never the raw error text). */
export function commandErrorKey(error: unknown, context: ErrorContext): string {
  if (!(error instanceof DataError)) return 'widgets.timers.errors.unknown';
  switch (error.kind) {
    case 'unavailable':
      return 'common.desktopOnly';
    case 'forbidden':
      return context === 'alarm'
        ? 'widgets.timers.errors.reminderLimit'
        : 'widgets.timers.errors.sessionLimit';
    case 'busy':
      return 'widgets.timers.errors.busy';
    case 'not_found':
      return 'widgets.timers.errors.notFound';
    case 'invalid_input': {
      const { field, timeKind } = commandErrorDetails(error);
      if (field === 'label' || field === 'title') return 'widgets.timers.errors.label';
      if (field === 'durationMs') return 'widgets.timers.errors.duration';
      if (timeKind !== undefined || field === 'startLocal') {
        return 'widgets.timers.errors.alarmInvalid';
      }
      return 'widgets.timers.errors.invalid';
    }
    default:
      return 'widgets.timers.errors.unknown';
  }
}
