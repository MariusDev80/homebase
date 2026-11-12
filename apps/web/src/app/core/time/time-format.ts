import {
  INSTANT_ISO_PATTERN,
  LOCAL_DATE_PATTERN,
  LOCAL_DATE_TIME_PATTERN,
  MAX_LOCAL_DATE,
  MIN_LOCAL_DATE,
  type InstantIso,
  type LocalDateIso,
  type LocalDateTimeIso,
} from '../../data';
import { Temporal } from './temporal';
import { TimeError } from './time-error';

// ADR-003 section 3.1.1: a value is valid when it matches the strict pattern AND the round trip
// format(parse(x)) === x holds (Temporal would silently normalise 24:00, :60 or 02-30).

const RFC3339_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const INSTANT_UPPER_BOUND = '2200-01-01';
const DATE_TIME_PREFIX_LENGTH = 19;

function inInstantRange(stored: string): boolean {
  return stored >= MIN_LOCAL_DATE && stored < INSTANT_UPPER_BOUND;
}

export function formatInstant(instant: Temporal.Instant): InstantIso {
  return instant.toString({ fractionalSecondDigits: 3 });
}

export function formatLocalDate(date: Temporal.PlainDate): LocalDateIso {
  return date.toString();
}

export function formatLocalDateTime(dt: Temporal.PlainDateTime): LocalDateTimeIso {
  return dt.toString({ smallestUnit: 'second' });
}

/** Strict RFC 3339 input, normalised to the stored form (ms, `Z`, truncation). */
export function normalizeInstant(text: string): InstantIso {
  if (!RFC3339_INSTANT_PATTERN.test(text)) {
    throw new TimeError('invalid_instant', 'Instant is not strict RFC 3339', { value: text });
  }
  const dateTime = text.slice(0, DATE_TIME_PREFIX_LENGTH);
  let stored: InstantIso;
  try {
    const plain = Temporal.PlainDateTime.from(dateTime);
    if (formatLocalDateTime(plain) !== dateTime) {
      throw new RangeError('not a round trip');
    }
    stored = formatInstant(Temporal.Instant.from(text));
  } catch {
    throw new TimeError('invalid_instant', 'Invalid instant', { value: text });
  }
  if (!inInstantRange(stored)) {
    throw new TimeError('out_of_range', 'Instant out of range', { value: text });
  }
  return stored;
}

/** Stored form only (`YYYY-MM-DDTHH:MM:SS.sssZ`). */
export function parseInstant(text: string): Temporal.Instant {
  if (!INSTANT_ISO_PATTERN.test(text)) {
    throw new TimeError('invalid_instant', 'Invalid instant', { value: text });
  }
  let instant: Temporal.Instant;
  try {
    instant = Temporal.Instant.from(text);
    if (formatInstant(instant) !== text) {
      throw new RangeError('not a round trip');
    }
  } catch {
    throw new TimeError('invalid_instant', 'Invalid instant', { value: text });
  }
  if (!inInstantRange(text)) {
    throw new TimeError('out_of_range', 'Instant out of range', { value: text });
  }
  return instant;
}

export function parseLocalDate(text: string): Temporal.PlainDate {
  if (!LOCAL_DATE_PATTERN.test(text)) {
    throw new TimeError('invalid_local_date', 'Invalid local date', { value: text });
  }
  let date: Temporal.PlainDate;
  try {
    date = Temporal.PlainDate.from(text);
    if (formatLocalDate(date) !== text) {
      throw new RangeError('not a round trip');
    }
  } catch {
    throw new TimeError('invalid_local_date', 'Invalid local date', { value: text });
  }
  if (text < MIN_LOCAL_DATE || text > MAX_LOCAL_DATE) {
    throw new TimeError('out_of_range', 'Local date out of range', { value: text });
  }
  return date;
}

export function parseLocalDateTime(text: string): Temporal.PlainDateTime {
  if (!LOCAL_DATE_TIME_PATTERN.test(text)) {
    throw new TimeError('invalid_local_date_time', 'Invalid local date-time', { value: text });
  }
  let dt: Temporal.PlainDateTime;
  try {
    dt = Temporal.PlainDateTime.from(text);
    if (formatLocalDateTime(dt) !== text) {
      throw new RangeError('not a round trip');
    }
  } catch {
    throw new TimeError('invalid_local_date_time', 'Invalid local date-time', { value: text });
  }
  if (!inInstantRange(text)) {
    throw new TimeError('out_of_range', 'Local date-time out of range', { value: text });
  }
  return dt;
}

function accepts(parse: (text: string) => unknown, text: string): boolean {
  try {
    parse(text);
    return true;
  } catch (e) {
    if (e instanceof TimeError) return false;
    throw e;
  }
}

export function isValidLocalDate(text: string): boolean {
  return accepts(parseLocalDate, text);
}

export function isValidLocalDateTime(text: string): boolean {
  return accepts(parseLocalDateTime, text);
}

export function isValidInstant(text: string): boolean {
  return accepts(parseInstant, text);
}
