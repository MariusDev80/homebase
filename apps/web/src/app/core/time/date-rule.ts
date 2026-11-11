import { MAX_LOCAL_DATE, type LocalDateIso } from '../../data';
import { addDays, compareLocalDates, daysBetween } from './local-date';
import { Temporal } from './temporal';
import { TimeError } from './time-error';
import { formatLocalDate, parseLocalDate } from './time-format';

// Date-only repetition subset (todo-details spec 4.3, ADR-003 D2/D3). Deliberately NOT re-exported
// by core/time/index.ts so that it stays out of the initial bundle.

export type DateRuleFreq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface DateRule {
  readonly freq: DateRuleFreq;
  /** 1..DATE_RULE_INTERVAL_MAX[freq] (ADR-003 3.5.1). */
  readonly interval: number;
  /** BYMONTHDAY=-1; MONTHLY only. */
  readonly lastDayOfMonth: boolean;
}

export const DATE_RULE_INTERVAL_MAX: Readonly<Record<DateRuleFreq, number>> = {
  DAILY: 366,
  WEEKLY: 52,
  MONTHLY: 11,
  YEARLY: 10,
};

const MAX_ITERATIONS = 1000;
const MAX_YEAR = 2199;
const MAX_MONTH = 12;
const DAYS_PER_WEEK = 7;
const RULE_PATTERN =
  /^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(?:;INTERVAL=([1-9]\d{0,2}))?(;BYMONTHDAY=-1)?$/;

function isValidRule(rule: DateRule): boolean {
  const max = DATE_RULE_INTERVAL_MAX[rule.freq] as number | undefined;
  return (
    max !== undefined &&
    Number.isInteger(rule.interval) &&
    rule.interval >= 1 &&
    rule.interval <= max &&
    (!rule.lastDayOfMonth || rule.freq === 'MONTHLY')
  );
}

/** Canonical text of the subset only (D2); null for anything else. */
export function parseDateRule(text: string): DateRule | null {
  const match = RULE_PATTERN.exec(text);
  if (match === null) return null;
  const rule: DateRule = {
    freq: match[1] as DateRuleFreq,
    interval: match[2] === undefined ? 1 : Number(match[2]),
    lastDayOfMonth: match[3] !== undefined,
  };
  // Canonical only: INTERVAL=1 is refused, and so is anything out of the per-frequency bounds.
  if (!isValidRule(rule) || formatDateRule(rule) !== text) return null;
  return rule;
}

/** Canonical text (INTERVAL omitted when 1). */
export function formatDateRule(rule: DateRule): string {
  if (!isValidRule(rule)) {
    throw new TimeError('invalid_rule', 'Rule is outside the supported subset');
  }
  return (
    `FREQ=${rule.freq}` +
    (rule.interval === 1 ? '' : `;INTERVAL=${rule.interval}`) +
    (rule.lastDayOfMonth ? ';BYMONTHDAY=-1' : '')
  );
}

/** True when `date` is the last day of its month. */
export function isLastDayOfMonth(date: LocalDateIso): boolean {
  const plain = parseLocalDate(date);
  return plain.day === plain.daysInMonth;
}

function nextByDays(anchor: LocalDateIso, step: number, after: LocalDateIso): LocalDateIso | null {
  if (compareLocalDates(after, anchor) < 0) return anchor;
  const offset = (Math.floor(daysBetween(anchor, after) / step) + 1) * step;
  // Compare the offset before addDays, which throws past MAX_LOCAL_DATE.
  if (offset > daysBetween(anchor, MAX_LOCAL_DATE)) return null;
  return addDays(anchor, offset);
}

function nextByMonths(
  anchor: Temporal.PlainDate,
  rule: DateRule,
  after: Temporal.PlainDate,
): LocalDateIso | null {
  const yearly = rule.freq === 'YEARLY';
  const ym0 = Temporal.PlainYearMonth.from({ year: anchor.year, month: anchor.month });
  const last = Temporal.PlainYearMonth.from({ year: MAX_YEAR, month: MAX_MONTH });
  let k = 0;
  if (Temporal.PlainDate.compare(after, anchor) >= 0) {
    const ymAfter = Temporal.PlainYearMonth.from({ year: after.year, month: after.month });
    const delta = ym0.until(ymAfter, { largestUnit: yearly ? 'years' : 'months' });
    k = Math.max(0, Math.floor((yearly ? delta.years : delta.months) / rule.interval));
  }
  for (let i = 0; i < MAX_ITERATIONS; i++, k++) {
    const shift = k * rule.interval;
    const ym = ym0.add(yearly ? { years: shift } : { months: shift });
    if (Temporal.PlainYearMonth.compare(ym, last) > 0) return null;
    let candidate: Temporal.PlainDate;
    if (rule.lastDayOfMonth) {
      candidate = ym.toPlainDate({ day: ym.daysInMonth });
    } else if (anchor.day <= ym.daysInMonth) {
      candidate = ym.toPlainDate({ day: anchor.day });
    } else {
      continue; // invalid day: month skipped (ADR-003 D2)
    }
    if (
      Temporal.PlainDate.compare(candidate, after) > 0 &&
      Temporal.PlainDate.compare(candidate, anchor) >= 0
    ) {
      return formatLocalDate(candidate);
    }
  }
  return null;
}

/** First occurrence of the series anchored at `anchor` strictly after `after`; null when it would
 *  be after MAX_LOCAL_DATE (never throws for that). Invalid days are skipped (ADR-003 D2).
 *  Throws TimeError on an invalid `anchor` or `after`. */
export function nextOccurrenceAfter(
  anchor: LocalDateIso,
  rule: DateRule,
  after: LocalDateIso,
): LocalDateIso | null {
  const anchorDate = parseLocalDate(anchor);
  const afterDate = parseLocalDate(after);
  if (!isValidRule(rule)) {
    throw new TimeError('invalid_rule', 'Rule is outside the supported subset');
  }
  switch (rule.freq) {
    case 'DAILY':
      return nextByDays(anchor, rule.interval, after);
    case 'WEEKLY':
      return nextByDays(anchor, rule.interval * DAYS_PER_WEEK, after);
    default:
      return nextByMonths(anchorDate, rule, afterDate);
  }
}

/** D3: nextOccurrenceAfter(dueOn, rule, max(dueOn, today)). */
export function nextRepeatDue(
  dueOn: LocalDateIso,
  rule: DateRule,
  today: LocalDateIso,
): LocalDateIso | null {
  const after = compareLocalDates(dueOn, today) >= 0 ? dueOn : today;
  return nextOccurrenceAfter(dueOn, rule, after);
}
