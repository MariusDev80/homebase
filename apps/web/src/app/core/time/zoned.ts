import {
  hasTimeZoneIdShape,
  type Clock,
  type InstantIso,
  type LocalDateIso,
  type LocalDateTimeIso,
  type TimeZoneId,
} from '../../data';
import { addDays } from './local-date';
import { Temporal } from './temporal';
import { TimeError } from './time-error';
import {
  formatInstant,
  formatLocalDate,
  formatLocalDateTime,
  parseInstant,
  parseLocalDate,
  parseLocalDateTime,
} from './time-format';

export type LocalTimeKind = 'unique' | 'gap' | 'fold';

/** ADR-003 section 3.2: shape, then tzdb. Returns the Temporal-normalised id, or null. */
export function normalizeTimeZone(id: string): TimeZoneId | null {
  if (!hasTimeZoneIdShape(id)) return null;
  try {
    return Temporal.ZonedDateTime.from({ year: 2026, month: 1, day: 1, timeZone: id }).timeZoneId;
  } catch {
    return null;
  }
}

export function isValidTimeZone(id: string): boolean {
  return normalizeTimeZone(id) !== null;
}

function requireTimeZone(id: string): TimeZoneId {
  const normalized = normalizeTimeZone(id);
  if (normalized === null) {
    throw new TimeError('unknown_time_zone', 'Unknown time zone', { value: id });
  }
  return normalized;
}

/** disambiguation 'compatible' (ADR-003 section 3.3): fold -> first occurrence, gap -> shifted forward. */
export function resolveLocal(local: LocalDateTimeIso, timeZone: TimeZoneId): InstantIso {
  const zone = requireTimeZone(timeZone);
  return formatInstant(
    parseLocalDateTime(local).toZonedDateTime(zone, { disambiguation: 'compatible' }).toInstant(),
  );
}

export function classifyLocal(local: LocalDateTimeIso, timeZone: TimeZoneId): LocalTimeKind {
  const zone = requireTimeZone(timeZone);
  const plain = parseLocalDateTime(local);
  const earlier = plain.toZonedDateTime(zone, { disambiguation: 'earlier' });
  const later = plain.toZonedDateTime(zone, { disambiguation: 'later' });
  if (earlier.epochNanoseconds === later.epochNanoseconds) return 'unique';
  const same = (z: Temporal.ZonedDateTime): boolean => z.toPlainDateTime().equals(plain);
  return same(earlier) && same(later) ? 'fold' : 'gap';
}

export function toLocalDateTime(instant: InstantIso, timeZone: TimeZoneId): LocalDateTimeIso {
  const zone = requireTimeZone(timeZone);
  return formatLocalDateTime(parseInstant(instant).toZonedDateTimeISO(zone).toPlainDateTime());
}

export function toLocalDate(instant: InstantIso, timeZone: TimeZoneId): LocalDateIso {
  const zone = requireTimeZone(timeZone);
  return formatLocalDate(parseInstant(instant).toZonedDateTimeISO(zone).toPlainDate());
}

/** Handles a non-existent midnight (e.g. America/Santiago). */
export function startOfDay(date: LocalDateIso, timeZone: TimeZoneId): InstantIso {
  const zone = requireTimeZone(timeZone);
  return formatInstant(parseLocalDate(date).toZonedDateTime({ timeZone: zone }).toInstant());
}

/** startOfDay(date + 1 day) - 1 s, as an RRULE `YYYYMMDDTHHMMSSZ` (ADR-003 section 3.5.3). */
export function untilEndOfLocalDay(date: LocalDateIso, timeZone: TimeZoneId): string {
  const next = parseInstant(startOfDay(addDays(date, 1), timeZone));
  const last = formatInstant(next.subtract({ seconds: 1 }));
  return `${last.slice(0, 19).replace(/[-:]/g, '')}Z`;
}

export function todayIn(clock: Clock, timeZone: TimeZoneId): LocalDateIso {
  return toLocalDate(clock.nowIso(), timeZone);
}

export function addDuration(instant: InstantIso, durationMs: number): InstantIso {
  if (!Number.isSafeInteger(durationMs)) {
    throw new TimeError('out_of_range', 'Duration must be an integer number of milliseconds', {
      value: String(durationMs),
    });
  }
  return formatInstant(parseInstant(instant).add({ milliseconds: durationMs }));
}

/** `end - start` in milliseconds (negative when `end` is earlier). */
export function durationBetween(start: InstantIso, end: InstantIso): number {
  return parseInstant(start).until(parseInstant(end), { largestUnit: 'milliseconds' }).milliseconds;
}
