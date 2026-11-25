import type { RuleErrorCode } from './time-error';
import { isValidLocalDate, isValidLocalDateTime } from './time-format';

// ADR-003 section 3.5: strict codec of the RRULE subset. Pure text handling: it computes no date
// (UNTIL validity is delegated to the time-format parsers). Mirror of Rust `parse_rule`.

export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';
export type AnchorKind = 'date-time' | 'date';
export type RuleEnd =
  | { readonly kind: 'never' }
  | { readonly kind: 'count'; readonly count: number }
  | { readonly kind: 'until-instant'; readonly until: string }
  | { readonly kind: 'until-date'; readonly until: string };
export interface RecurrenceRule {
  readonly freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  readonly interval: number;
  readonly byDay: readonly Weekday[];
  readonly byNthWeekday: { readonly n: 1 | 2 | 3 | 4 | -1; readonly weekday: Weekday } | null;
  readonly byMonthDay: number | null;
  readonly end: RuleEnd;
}
export type RuleParseResult =
  | { readonly ok: true; readonly rule: RecurrenceRule; readonly canonical: string }
  | { readonly ok: false; readonly code: RuleErrorCode; readonly part: string | null };

const MAX_RULE_LENGTH = 256;
export const COUNT_MAX = 1000;
const SYNTAX_PATTERN = /^[A-Z]+=[^;=]+(;[A-Z]+=[^;=]+)*$/;
const ALLOWED_PARTS = ['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'COUNT', 'UNTIL'];
const FREQS = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const;
/** Monday-first weekday codes (single definition, also used by habits and reminders). */
export const WEEKDAYS: readonly Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
export const INTERVAL_MAX: Readonly<Record<RecurrenceRule['freq'], number>> = {
  DAILY: 366,
  WEEKLY: 52,
  MONTHLY: 11,
  YEARLY: 10,
};
const BY_DAY_TOKEN = /^(-1|[1-4])?(MO|TU|WE|TH|FR|SA|SU)$/;
const UNSIGNED = /^[1-9]\d{0,3}$/;
const UNTIL_DATE = /^(\d{4})(\d{2})(\d{2})$/;
const UNTIL_DATE_TIME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/;

type UntilForm = 'date' | 'local' | 'utc';

function fail(code: RuleErrorCode, part: string | null = null): RuleParseResult {
  return { ok: false, code, part };
}

function parseUnsigned(text: string, max: number): number | null {
  if (!UNSIGNED.test(text)) return null;
  const value = Number(text);
  return value >= 1 && value <= max ? value : null;
}

function parseUntil(text: string): UntilForm | null {
  const date = UNTIL_DATE.exec(text);
  if (date !== null) {
    return isValidLocalDate(`${date[1]}-${date[2]}-${date[3]}`) ? 'date' : null;
  }
  const dateTime = UNTIL_DATE_TIME.exec(text);
  if (dateTime === null) return null;
  const local = `${dateTime[1]}-${dateTime[2]}-${dateTime[3]}T${dateTime[4]}:${dateTime[5]}:${dateTime[6]}`;
  if (!isValidLocalDateTime(local)) return null;
  return dateTime[7] === 'Z' ? 'utc' : 'local';
}

/** ADR-003 section 3.5.2, checks 1 to 11 (check 12 needs the anchor and lives in Rust). */
export function parseRecurrenceRule(text: string, anchor: AnchorKind): RuleParseResult {
  // 1. too_long
  if ([...text].length > MAX_RULE_LENGTH) return fail('too_long');
  // 2. syntax
  if (!SYNTAX_PATTERN.test(text)) return fail('syntax');
  const parts = text.split(';').map((piece) => {
    const at = piece.indexOf('=');
    return [piece.slice(0, at), piece.slice(at + 1)] as const;
  });
  // 3. duplicate_part
  for (let i = 0; i < parts.length; i++) {
    if (parts.slice(0, i).some(([key]) => key === parts[i][0])) {
      return fail('duplicate_part', parts[i][0]);
    }
  }
  // 4. unsupported_part
  for (const [key] of parts) {
    if (!ALLOWED_PARTS.includes(key)) return fail('unsupported_part', key);
  }
  const get = (name: string): string | undefined => parts.find(([key]) => key === name)?.[1];
  // 5. missing_freq
  const freqText = get('FREQ');
  if (freqText === undefined) return fail('missing_freq', 'FREQ');
  // 6. invalid_value, canonical order
  const freq = FREQS.find((f) => f === freqText);
  if (freq === undefined) return fail('invalid_value', 'FREQ');
  let interval = 1;
  const intervalText = get('INTERVAL');
  if (intervalText !== undefined) {
    const parsed = parseUnsigned(intervalText, INTERVAL_MAX[freq]);
    if (parsed === null) return fail('invalid_value', 'INTERVAL');
    interval = parsed;
  }
  const byDayText = get('BYDAY');
  const tokens: { n: number | null; weekday: Weekday }[] = [];
  if (byDayText !== undefined) {
    for (const token of byDayText.split(',')) {
      const match = BY_DAY_TOKEN.exec(token);
      if (match === null) return fail('invalid_value', 'BYDAY');
      tokens.push({
        n: match[1] === undefined ? null : Number(match[1]),
        weekday: match[2] as Weekday,
      });
    }
  }
  let byMonthDay: number | null = null;
  const byMonthDayText = get('BYMONTHDAY');
  if (byMonthDayText !== undefined) {
    byMonthDay = byMonthDayText === '-1' ? -1 : parseUnsigned(byMonthDayText, 31);
    if (byMonthDay === null) return fail('invalid_value', 'BYMONTHDAY');
  }
  let count: number | null = null;
  const countText = get('COUNT');
  if (countText !== undefined) {
    count = parseUnsigned(countText, COUNT_MAX);
    if (count === null) return fail('invalid_value', 'COUNT');
  }
  let untilForm: UntilForm | null = null;
  const untilText = get('UNTIL');
  if (untilText !== undefined) {
    untilForm = parseUntil(untilText);
    if (untilForm === null) return fail('invalid_value', 'UNTIL');
  }
  // 7. duplicate_value
  for (let i = 0; i < tokens.length; i++) {
    if (tokens.slice(0, i).some((t) => t.n === tokens[i].n && t.weekday === tokens[i].weekday)) {
      return fail('duplicate_value', 'BYDAY');
    }
  }
  // 8. part_not_allowed
  let byDay: Weekday[] = [];
  let byNthWeekday: RecurrenceRule['byNthWeekday'] = null;
  if (byDayText !== undefined) {
    if (freq === 'WEEKLY') {
      if (tokens.some((t) => t.n !== null)) return fail('part_not_allowed', 'BYDAY');
      byDay = tokens
        .map((t) => t.weekday)
        .sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b));
    } else if (freq === 'MONTHLY') {
      if (tokens.length !== 1 || tokens[0].n === null) return fail('part_not_allowed', 'BYDAY');
      byNthWeekday = { n: tokens[0].n as 1 | 2 | 3 | 4 | -1, weekday: tokens[0].weekday };
    } else {
      return fail('part_not_allowed', 'BYDAY');
    }
  }
  if (byMonthDay !== null && freq !== 'MONTHLY') return fail('part_not_allowed', 'BYMONTHDAY');
  // 9. conflicting_parts
  if (byDayText !== undefined && byMonthDay !== null) return fail('conflicting_parts');
  // 10. count_and_until
  if (count !== null && untilForm !== null) return fail('count_and_until');
  // 11. UNTIL kind against the anchor
  let end: RuleEnd = { kind: 'never' };
  if (count !== null) {
    end = { kind: 'count', count };
  } else if (untilForm !== null && untilText !== undefined) {
    if (anchor === 'date-time') {
      if (untilForm === 'local') return fail('until_not_utc', 'UNTIL');
      if (untilForm === 'date') return fail('until_kind_mismatch', 'UNTIL');
      end = { kind: 'until-instant', until: untilText };
    } else {
      if (untilForm !== 'date') return fail('until_kind_mismatch', 'UNTIL');
      end = { kind: 'until-date', until: untilText };
    }
  }
  const rule: RecurrenceRule = { freq, interval, byDay, byNthWeekday, byMonthDay, end };
  return { ok: true, rule, canonical: formatRecurrenceRule(rule) };
}

/** Canonical text: FREQ, INTERVAL (omitted when 1), BYDAY, BYMONTHDAY, COUNT, UNTIL. */
export function formatRecurrenceRule(rule: RecurrenceRule): string {
  let text = `FREQ=${rule.freq}`;
  if (rule.interval > 1) text += `;INTERVAL=${rule.interval}`;
  if (rule.byDay.length > 0) {
    const days = [...rule.byDay].sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b));
    text += `;BYDAY=${days.join(',')}`;
  }
  if (rule.byNthWeekday !== null) {
    text += `;BYDAY=${rule.byNthWeekday.n}${rule.byNthWeekday.weekday}`;
  }
  if (rule.byMonthDay !== null) text += `;BYMONTHDAY=${rule.byMonthDay}`;
  switch (rule.end.kind) {
    case 'count':
      text += `;COUNT=${rule.end.count}`;
      break;
    case 'until-instant':
    case 'until-date':
      text += `;UNTIL=${rule.end.until}`;
      break;
    case 'never':
      break;
  }
  return text;
}
