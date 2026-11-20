import { commandErrorDetails } from '../../core/schedule';
import {
  COUNT_MAX,
  INTERVAL_MAX,
  TimeError,
  classifyLocal,
  formatInstant,
  formatRecurrenceRule,
  isValidLocalDate,
  parseInstant,
  parseLocalDate,
  parseRecurrenceRule,
  resolveLocal,
  toLocalDate,
  toLocalDateTime,
  untilEndOfLocalDay,
} from '../../core/time';
import type { RecurrenceRule, RuleEnd, Weekday } from '../../core/time';
import { isLastDayOfMonth } from '../../core/time/date-rule';
import {
  DataError,
  SCHEDULE_LIMITS,
  type InstantIso,
  type LocalDateIso,
  type LocalDateTimeIso,
  type Reminder,
  type ReminderInput,
  type TimeZoneId,
} from '../../data';

// Pure logic of the reminder form (spec 4.8, ADR-003 3.5): form values <-> ReminderInput. RRULE
// texts are built and read with the core codec only; no date is computed by hand.

export type RepeatChoice =
  | 'none'
  | 'daily'
  | 'weekly'
  | 'monthly-day'
  | 'monthly-last'
  | 'monthly-nth'
  | 'yearly'
  | 'custom';
export type EndChoice = 'never' | 'count' | 'until';
export type FormField =
  'title' | 'date' | 'time' | 'repeat' | 'interval' | 'weekdays' | 'count' | 'until';

export interface FormState {
  readonly title: string;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  /** `HH:MM`. */
  readonly time: string;
  readonly repeat: RepeatChoice;
  /** Typed text, checked on save. */
  readonly interval: string;
  readonly weekdays: readonly Weekday[];
  readonly end: EndChoice;
  readonly count: string;
  /** Last day (included) of the series, `YYYY-MM-DD`. */
  readonly until: string;
  readonly enabled: boolean;
  /** Rule outside the choices of the form, kept as is (read only). */
  readonly customRule: string | null;
  readonly exdates: readonly LocalDateTimeIso[];
}

/** i18n key per field. */
export type FormErrors = Partial<Record<FormField, string>>;

/** What the scheduler needs: everything of a reminder except its title. */
export type Schedule = Omit<ReminderInput, 'title'>;
export type ScheduleResult = { readonly schedule: Schedule } | { readonly errors: FormErrors };
export type FormResult = { readonly input: ReminderInput } | { readonly errors: FormErrors };

export const WEEKDAYS: readonly Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
export const MAX_YEARS_AHEAD = 10;
const ERR = 'widgets.reminders.errors.';
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DIGITS = /^\d{1,4}$/;
const DAYS_PER_WEEK = 7;

export function isTime(text: string): boolean {
  return TIME_PATTERN.test(text);
}

export function weekdayOf(date: LocalDateIso): Weekday {
  return WEEKDAYS[parseLocalDate(date).dayOfWeek - 1];
}

export function dayOfMonth(date: LocalDateIso): number {
  return parseLocalDate(date).day;
}

/** "The 2nd Tuesday" of the month, or "the last" when the date is in the last 7 days. */
export function nthWeekdayOf(date: LocalDateIso): {
  readonly n: 1 | 2 | 3 | 4 | -1;
  readonly weekday: Weekday;
} {
  const plain = parseLocalDate(date);
  const weekday = WEEKDAYS[plain.dayOfWeek - 1];
  if (plain.day > plain.daysInMonth - DAYS_PER_WEEK) return { n: -1, weekday };
  return { n: Math.ceil(plain.day / DAYS_PER_WEEK) as 1 | 2 | 3 | 4, weekday };
}

/** Repetition choices offered for a date ("last day" only when the date is the last day). */
export function repeatOptions(date: string): readonly RepeatChoice[] {
  const last = isValidLocalDate(date) && isLastDayOfMonth(date);
  return [
    'none',
    'daily',
    'weekly',
    'monthly-day',
    ...(last ? (['monthly-last'] as const) : []),
    'monthly-nth',
    'yearly',
  ];
}

export function newFormState(date: LocalDateIso, time: string): FormState {
  return {
    title: '',
    date,
    time,
    repeat: 'none',
    interval: '1',
    weekdays: [weekdayOf(date)],
    end: 'never',
    count: '10',
    until: date,
    enabled: true,
    customRule: null,
    exdates: [],
  };
}

/** Exceptions of both lists, without duplicates, sorted. */
export function mergeExdates(
  a: readonly LocalDateTimeIso[],
  b: readonly LocalDateTimeIso[],
): LocalDateTimeIso[] {
  return [...new Set([...a, ...b])].sort();
}

/** True when the field is on screen for this state (an error on a hidden field goes elsewhere). */
export function fieldShown(state: FormState, field: FormField): boolean {
  const recurring = state.repeat !== 'none' && state.repeat !== 'custom';
  switch (field) {
    case 'title':
    case 'date':
    case 'time':
      return true;
    case 'repeat':
      return state.repeat !== 'custom';
    case 'interval':
      return recurring;
    case 'weekdays':
      return state.repeat === 'weekly';
    case 'count':
      return recurring && state.end === 'count';
    case 'until':
      return recurring && state.end === 'until';
  }
}

function freqOf(repeat: RepeatChoice): RecurrenceRule['freq'] {
  switch (repeat) {
    case 'daily':
      return 'DAILY';
    case 'weekly':
      return 'WEEKLY';
    case 'yearly':
      return 'YEARLY';
    default:
      return 'MONTHLY';
  }
}

/** Instant `years` after `now`, as `next_after` does in Rust (UTC calendar years). */
function horizonOf(now: InstantIso): InstantIso {
  return formatInstant(
    parseInstant(now).toZonedDateTimeISO('UTC').add({ years: MAX_YEARS_AHEAD }).toInstant(),
  );
}

function buildRule(
  state: FormState,
  timeZone: TimeZoneId,
  dateOk: boolean,
  horizon: InstantIso,
  errors: FormErrors,
): RecurrenceRule {
  const freq = freqOf(state.repeat);
  const text = state.interval.trim();
  const interval = DIGITS.test(text) ? Number(text) : 0;
  if (interval < 1 || interval > INTERVAL_MAX[freq]) errors.interval = ERR + 'interval';

  let end: RuleEnd = { kind: 'never' };
  if (state.end === 'count') {
    const countText = state.count.trim();
    const count = DIGITS.test(countText) ? Number(countText) : 0;
    if (count < 1 || count > COUNT_MAX) errors.count = ERR + 'count';
    else end = { kind: 'count', count };
  } else if (state.end === 'until') {
    if (!isValidLocalDate(state.until) || (dateOk && state.until < state.date)) {
      errors.until = ERR + 'until';
    } else if (state.until > toLocalDate(horizon, timeZone)) {
      errors.until = ERR + 'tooFar';
    } else {
      end = { kind: 'until-instant', until: untilEndOfLocalDay(state.until, timeZone) };
    }
  }

  const rule: RecurrenceRule = {
    freq,
    interval,
    byDay: [],
    byNthWeekday: null,
    byMonthDay: null,
    end,
  };
  if (state.repeat === 'weekly') {
    if (state.weekdays.length === 0) errors.weekdays = ERR + 'weekdays';
    return { ...rule, byDay: [...new Set(state.weekdays)] };
  }
  if (!dateOk) return rule;
  if (state.repeat === 'monthly-day') return { ...rule, byMonthDay: dayOfMonth(state.date) };
  if (state.repeat === 'monthly-last') return { ...rule, byMonthDay: -1 };
  if (state.repeat === 'monthly-nth') return { ...rule, byNthWeekday: nthWeekdayOf(state.date) };
  return rule;
}

/**
 * Everything but the title: anchor, rule, exceptions, activation. `baseline` is the form of the
 * reminder as opened: the "date is past" check only applies when the date, the time or the
 * repetition changed (a finished reminder can be renamed). May throw on unreadable values: callers
 * route the exception through `problemOf`.
 */
export function scheduleOf(
  state: FormState,
  timeZone: TimeZoneId,
  now: InstantIso,
  baseline: FormState | null = null,
): ScheduleResult {
  const errors: FormErrors = {};
  const dateOk = isValidLocalDate(state.date);
  const timeOk = isTime(state.time);
  if (!dateOk) errors.date = ERR + 'date';
  if (!timeOk) errors.time = ERR + 'time';
  const startLocal: LocalDateTimeIso = `${state.date}T${state.time}:00`;
  const horizon = horizonOf(now);

  let rrule: string | null = null;
  if (state.repeat === 'custom') {
    const parsed =
      state.customRule === null ? null : parseRecurrenceRule(state.customRule, 'date-time');
    if (parsed === null || !parsed.ok) errors.repeat = ERR + 'rule';
    else rrule = parsed.canonical;
  } else if (state.repeat !== 'none') {
    const rule = buildRule(state, timeZone, dateOk, horizon, errors);
    if (Object.keys(errors).length === 0) rrule = formatRecurrenceRule(rule);
  }

  if (dateOk && timeOk) {
    const start = resolveLocal(startLocal, timeZone);
    const moved =
      baseline === null ||
      baseline.date !== state.date ||
      baseline.time !== state.time ||
      baseline.repeat !== state.repeat;
    if (start > horizon) {
      errors.date = ERR + 'tooFar';
    } else if (moved && state.repeat === 'none' && start <= now) {
      if (state.date === toLocalDate(now, timeZone)) errors.time = ERR + 'past';
      else errors.date = ERR + 'past';
    }
  }
  if (Object.keys(errors).length > 0) return { errors };
  return {
    schedule: {
      startLocal,
      timeZone,
      rrule,
      exdates: rrule === null ? [] : state.exdates,
      enabled: state.enabled,
    },
  };
}

/** Form values to a command input; refusals are keyed by field. */
export function formToInput(
  state: FormState,
  timeZone: TimeZoneId,
  now: InstantIso,
  baseline: FormState | null = null,
): FormResult {
  const result = scheduleOf(state, timeZone, now, baseline);
  const errors: FormErrors = 'errors' in result ? { ...result.errors } : {};
  const title = state.title.trim();
  if (title === '' || [...title].length > SCHEDULE_LIMITS.titleMaxChars) {
    errors.title = ERR + 'title';
  }
  if ('errors' in result || errors.title !== undefined) return { errors };
  return { input: { title, ...result.schedule } };
}

/** The local day of an `UNTIL=YYYYMMDDTHHMMSSZ` that is exactly the end of that day, else null. */
function untilToDate(until: string, timeZone: TimeZoneId): LocalDateIso | null {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(until);
  if (match === null) return null;
  const instant = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.000Z`;
  try {
    parseInstant(instant);
    const date = toLocalDate(instant, timeZone);
    return untilEndOfLocalDay(date, timeZone) === until ? date : null;
  } catch {
    return null;
  }
}

/**
 * A stored reminder to form values; a rule outside the choices of the form becomes `custom`.
 * Throws when the anchor itself is unreadable (the caller falls back to an empty form).
 */
export function inputToForm(reminder: Reminder): FormState {
  const date = reminder.startLocal.slice(0, 10);
  const base: FormState = {
    ...newFormState(date, reminder.startLocal.slice(11, 16)),
    title: reminder.title,
    enabled: reminder.enabled,
    exdates: reminder.exdates,
  };
  if (reminder.rrule === null) return base;
  const custom: FormState = { ...base, repeat: 'custom', customRule: reminder.rrule };
  const parsed = parseRecurrenceRule(reminder.rrule, 'date-time');
  if (!parsed.ok) return custom;
  const { rule } = parsed;
  const withEnd = (state: FormState): FormState => {
    const interval = String(rule.interval);
    switch (rule.end.kind) {
      case 'never':
        return { ...state, interval };
      case 'count':
        return { ...state, interval, end: 'count', count: String(rule.end.count) };
      case 'until-instant': {
        const until = untilToDate(rule.end.until, reminder.timeZone);
        return until === null ? custom : { ...state, interval, end: 'until', until };
      }
      case 'until-date':
        return custom;
    }
  };
  switch (rule.freq) {
    case 'DAILY':
      return withEnd({ ...base, repeat: 'daily' });
    case 'YEARLY':
      return withEnd({ ...base, repeat: 'yearly' });
    case 'WEEKLY':
      return withEnd({
        ...base,
        repeat: 'weekly',
        weekdays: rule.byDay.length > 0 ? rule.byDay : [weekdayOf(date)],
      });
    case 'MONTHLY': {
      if (rule.byMonthDay === -1) {
        // "Last day" is only a choice when the anchor is the last day of its month.
        return isLastDayOfMonth(date) ? withEnd({ ...base, repeat: 'monthly-last' }) : custom;
      }
      if (rule.byNthWeekday === null) {
        return rule.byMonthDay === null || rule.byMonthDay === dayOfMonth(date)
          ? withEnd({ ...base, repeat: 'monthly-day' })
          : custom;
      }
      const nth = nthWeekdayOf(date);
      return rule.byNthWeekday.n === nth.n && rule.byNthWeekday.weekday === nth.weekday
        ? withEnd({ ...base, repeat: 'monthly-nth' })
        : custom;
    }
  }
}

export interface FormWarning {
  readonly key: string;
  readonly params?: Readonly<Record<string, string>>;
}

/** Non-blocking notes: gap/fold of the chosen time, monthly day above 28, yearly 29 February. */
export function formWarnings(state: FormState, timeZone: TimeZoneId): readonly FormWarning[] {
  const warnings: FormWarning[] = [];
  const dateOk = isValidLocalDate(state.date);
  if (dateOk && isTime(state.time)) {
    const local: LocalDateTimeIso = `${state.date}T${state.time}:00`;
    const kind = classifyLocal(local, timeZone);
    if (kind === 'gap') {
      const shifted = toLocalDateTime(resolveLocal(local, timeZone), timeZone).slice(11, 16);
      warnings.push({ key: 'time.nonexistent', params: { time: shifted } });
    } else if (kind === 'fold') {
      warnings.push({ key: 'time.ambiguous' });
    }
  }
  if (state.repeat === 'monthly-day' && dateOk && dayOfMonth(state.date) > 28) {
    warnings.push({ key: 'widgets.reminders.monthDaySkipped' });
  }
  if (state.repeat === 'yearly' && dateOk) {
    const plain = parseLocalDate(state.date);
    if (plain.month === 2 && plain.day === 29) {
      warnings.push({ key: 'widgets.reminders.leapDaySkipped' });
    }
  }
  return warnings;
}

export interface FieldProblem {
  /** `form` = no particular field. */
  readonly field: FormField | 'form';
  readonly key: string;
}

function ruleProblem(code: string | undefined): FieldProblem {
  if (code === 'count_and_until') return { field: 'count', key: ERR + 'count' };
  if (code !== undefined && code.startsWith('until')) return { field: 'until', key: ERR + 'until' };
  return { field: 'repeat', key: ERR + 'rule' };
}

function timeProblem(error: TimeError): FieldProblem {
  switch (error.code) {
    case 'invalid_rule':
      if (error.detail?.part === 'INTERVAL') return { field: 'interval', key: ERR + 'interval' };
      if (error.detail?.part === 'COUNT') return { field: 'count', key: ERR + 'count' };
      if (error.detail?.part === 'BYDAY') return { field: 'weekdays', key: ERR + 'weekdays' };
      return ruleProblem(error.detail?.rule);
    case 'invalid_local_date_time':
    case 'invalid_local_date':
    case 'out_of_range':
      return { field: 'date', key: ERR + 'date' };
    case 'invalid_exdate':
      return { field: 'form', key: ERR + 'exdates' };
    case 'not_schedulable':
      return { field: 'repeat', key: ERR + 'rule' };
    default:
      return { field: 'form', key: ERR + 'invalid' };
  }
}

function inputProblem(error: DataError): FieldProblem {
  const details = commandErrorDetails(error);
  if (details.timeKind === 'invalid_rule') return ruleProblem(details.code);
  switch (details.field) {
    case 'title':
      return { field: 'title', key: ERR + 'title' };
    case 'startLocal':
      return { field: 'date', key: ERR + 'date' };
    case 'rrule':
      return { field: 'repeat', key: ERR + 'rule' };
    case 'exdates':
      return { field: 'form', key: ERR + 'exdates' };
    default:
      return { field: 'form', key: ERR + 'invalid' };
  }
}

/** Where a failed validation or command must be shown (field, nested time error code). */
export function problemOf(error: unknown): FieldProblem {
  if (error instanceof TimeError) return timeProblem(error);
  if (!(error instanceof DataError)) return { field: 'form', key: ERR + 'unknown' };
  switch (error.kind) {
    case 'unavailable':
      return { field: 'form', key: 'common.desktopOnly' };
    case 'forbidden':
      return { field: 'form', key: ERR + 'limit' };
    case 'busy':
      return { field: 'form', key: ERR + 'busy' };
    case 'not_found':
      return { field: 'form', key: ERR + 'notFound' };
    case 'conflict':
      return { field: 'form', key: ERR + 'conflict' };
    case 'invalid_input':
      return inputProblem(error);
    default:
      return { field: 'form', key: ERR + 'unknown' };
  }
}
