import { WEEKDAYS } from '../../core/time';
import { commandErrorDetails } from '../../core/schedule';
import {
  classifyLocal,
  compareLocalDates,
  isValidLocalDate,
  resolveLocal,
  toLocalDateTime,
} from '../../core/time';
import {
  DataError,
  HABIT_LIMITS,
  type Habit,
  type HabitInput,
  type HabitReminderInput,
  type LocalDateIso,
  type LocalDateTimeIso,
  type TimeZoneId,
  type WeekdayCode,
} from '../../data';

// Pure logic of the habit form (spec habits 4.7): form values <-> HabitInput. No date is computed
// by hand: comparisons and validity go through `core/time`.

export const DEFAULT_REMINDER_TIME = '09:00';

export type HabitKind = 'days' | 'weekly';
export type HabitField = 'title' | 'days' | 'target' | 'startOn' | 'reminderTime' | 'reminderDays';

export interface HabitFormState {
  readonly title: string;
  readonly kind: HabitKind;
  readonly days: readonly WeekdayCode[];
  /** Typed text, checked on save (1 to 7). */
  readonly target: string;
  /** `YYYY-MM-DD`. */
  readonly startOn: string;
  readonly reminderOn: boolean;
  /** The habit already has a reminder: switching it off disables it instead of deleting it. */
  readonly hadReminder: boolean;
  /** `HH:MM`. */
  readonly reminderTime: string;
  /** null = the default days (those of the habit, or every day for "N times a week"). */
  readonly reminderDays: readonly WeekdayCode[] | null;
  /** Zone of the reminder: its own when it exists, else the user's. */
  readonly timeZone: TimeZoneId;
  /** The reminder as stored (time and days), restored when the hidden values are unreadable. */
  readonly savedReminder: { readonly time: string; readonly days: readonly WeekdayCode[] } | null;
}

/** i18n key per field. */
export type HabitFormErrors = Partial<Record<HabitField, string>>;
export type HabitFormResult = { readonly input: HabitInput } | { readonly errors: HabitFormErrors };

const ERR = 'widgets.habits.errors.';
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const TARGET_PATTERN = /^\d$/;
// Control, zero-width and bidirectional-formatting characters (aligned on `schedule/text.rs`).
const FORBIDDEN_TITLE = /[\p{Cc}\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/u;

export function isTime(text: string): boolean {
  return TIME_PATTERN.test(text);
}

/** The days in week order, without duplicates. */
export function sortedDays(days: readonly WeekdayCode[]): WeekdayCode[] {
  return WEEKDAYS.filter((d) => days.includes(d));
}

export function newHabitForm(today: LocalDateIso, timeZone: TimeZoneId): HabitFormState {
  return {
    title: '',
    kind: 'days',
    days: WEEKDAYS,
    target: '3',
    startOn: today,
    reminderOn: false,
    hadReminder: false,
    reminderTime: DEFAULT_REMINDER_TIME,
    reminderDays: null,
    timeZone,
    savedReminder: null,
  };
}

/** A stored habit as form values; `timeZone` is the user's, used when the habit has no reminder. */
export function habitToForm(habit: Habit, timeZone: TimeZoneId): HabitFormState {
  const base = newHabitForm(habit.startOn, timeZone);
  const reminder = habit.reminder;
  const schedule =
    habit.schedule.kind === 'days'
      ? { kind: 'days' as const, days: sortedDays(habit.schedule.days) }
      : { kind: 'weekly' as const, target: String(habit.schedule.target) };
  return {
    ...base,
    title: habit.title,
    kind: schedule.kind,
    days: schedule.kind === 'days' ? schedule.days : base.days,
    target: schedule.kind === 'weekly' ? schedule.target : base.target,
    reminderOn: reminder?.enabled ?? false,
    hadReminder: reminder !== null,
    reminderTime: reminder?.time ?? DEFAULT_REMINDER_TIME,
    reminderDays: reminder === null ? null : sortedDays(reminder.days),
    timeZone: reminder?.timeZone ?? timeZone,
    savedReminder:
      reminder === null ? null : { time: reminder.time, days: sortedDays(reminder.days) },
  };
}

/** The days the reminder rings on: the typed ones, else the habit's (every day when weekly). */
export function effectiveReminderDays(state: HabitFormState): readonly WeekdayCode[] {
  return state.reminderDays ?? (state.kind === 'days' ? state.days : WEEKDAYS);
}

/** True when the field is on screen for this state (an error on a hidden field goes elsewhere). */
export function fieldShown(state: HabitFormState, field: HabitField): boolean {
  switch (field) {
    case 'title':
    case 'startOn':
      return true;
    case 'days':
      return state.kind === 'days';
    case 'target':
      return state.kind === 'weekly';
    case 'reminderTime':
    case 'reminderDays':
      return state.reminderOn;
  }
}

/** Form values to a command input; refusals are keyed by field. `today` is the user's date. */
export function formToInput(state: HabitFormState, today: LocalDateIso): HabitFormResult {
  const errors: Partial<Record<HabitField, string>> = {};
  const title = state.title.trim();
  if (
    title === '' ||
    [...title].length > HABIT_LIMITS.titleMaxChars ||
    FORBIDDEN_TITLE.test(title)
  ) {
    errors.title = ERR + 'title';
  }

  let schedule: HabitInput['schedule'];
  if (state.kind === 'days') {
    const days = sortedDays(state.days);
    if (days.length === 0) errors.days = ERR + 'days';
    schedule = { kind: 'days', days };
  } else {
    const text = state.target.trim();
    const target = TARGET_PATTERN.test(text) ? Number(text) : 0;
    if (target < 1 || target > 7) errors.target = ERR + 'target';
    schedule = { kind: 'weekly', target };
  }

  if (!isValidLocalDate(state.startOn) || compareLocalDates(state.startOn, today) > 0) {
    errors.startOn = ERR + 'startOn';
  }

  let reminder: HabitReminderInput | null = null;
  const reminderDays = sortedDays(effectiveReminderDays(state));
  const reminderOk = isTime(state.reminderTime) && reminderDays.length > 0;
  if (state.reminderOn) {
    if (!isTime(state.reminderTime)) errors.reminderTime = ERR + 'reminderTime';
    if (reminderDays.length === 0) errors.reminderDays = ERR + 'reminderDays';
    reminder = {
      time: state.reminderTime,
      days: reminderDays,
      timeZone: state.timeZone,
      enabled: true,
    };
  } else if (state.hadReminder) {
    // Switched off: the reminder is kept, disabled. Unreadable hidden values give way to the
    // stored ones instead of deleting the reminder.
    const kept = reminderOk
      ? { time: state.reminderTime, days: reminderDays }
      : (state.savedReminder ?? { time: DEFAULT_REMINDER_TIME, days: reminderDays });
    reminder = { ...kept, timeZone: state.timeZone, enabled: false };
  }

  if (Object.keys(errors).length > 0) return { errors };
  return { input: { title, schedule, startOn: state.startOn, reminder } };
}

export interface HabitFormWarning {
  readonly key: string;
  readonly params?: Readonly<Record<string, string>>;
}

/** Non-blocking note: the reminder time falls in a gap or a fold of the zone today. */
export function formWarnings(
  state: HabitFormState,
  today: LocalDateIso,
): readonly HabitFormWarning[] {
  if (!state.reminderOn || !isTime(state.reminderTime)) return [];
  const local: LocalDateTimeIso = `${today}T${state.reminderTime}:00`;
  const kind = classifyLocal(local, state.timeZone);
  if (kind === 'gap') {
    const shifted = toLocalDateTime(resolveLocal(local, state.timeZone), state.timeZone).slice(
      11,
      16,
    );
    return [{ key: 'time.nonexistent', params: { time: shifted } }];
  }
  return kind === 'fold' ? [{ key: 'time.ambiguous' }] : [];
}

export interface HabitProblem {
  /** `form` = no particular field. */
  readonly field: HabitField | 'form';
  readonly key: string;
}

const RUST_FIELDS: Readonly<Record<string, HabitField>> = {
  title: 'title',
  'schedule.days': 'days',
  'schedule.target': 'target',
  startOn: 'startOn',
  'reminder.time': 'reminderTime',
  'reminder.days': 'reminderDays',
};

/** Where a failed command must be shown (the Rust `field` is read by `commandErrorDetails`). */
export function problemOf(error: unknown): HabitProblem {
  if (!(error instanceof DataError)) return { field: 'form', key: ERR + 'unknown' };
  switch (error.kind) {
    case 'unavailable':
      return { field: 'form', key: 'common.desktopOnly' };
    case 'forbidden':
      return { field: 'form', key: 'widgets.habits.limit' };
    case 'busy':
      return { field: 'form', key: ERR + 'busy' };
    case 'not_found':
      return { field: 'form', key: ERR + 'notFound' };
    case 'invalid_input': {
      const field = RUST_FIELDS[commandErrorDetails(error).field ?? ''];
      return field === undefined
        ? { field: 'form', key: ERR + 'invalid' }
        : { field, key: ERR + field };
    }
    default:
      return { field: 'form', key: ERR + 'unknown' };
  }
}
