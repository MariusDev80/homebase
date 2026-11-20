import type { InstantIso, LocalDateIso, LocalDateTimeIso, TimeZoneId } from '../../data';
import {
  addDays,
  classifyLocal,
  resolveLocal,
  toLocalDate,
  toLocalDateTime,
  type LocalTimeKind,
} from '../../core/time';

export interface AlarmPlan {
  /** Local start of the one-shot reminder (a time inside a gap is already moved forward). */
  readonly startLocal: LocalDateTimeIso;
  /** The instant it rings. */
  readonly at: InstantIso;
  readonly day: 'today' | 'tomorrow';
  /** `HH:MM` that will actually ring (differs from the request inside a gap). */
  readonly time: string;
  /** What the requested wall-clock time is on the chosen day: `gap` and `fold` are announced. */
  readonly kind: LocalTimeKind;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isAlarmTime(text: string): boolean {
  return TIME_PATTERN.test(text);
}

function planFor(
  date: LocalDateIso,
  time: string,
  timeZone: TimeZoneId,
  day: AlarmPlan['day'],
): AlarmPlan {
  const requested: LocalDateTimeIso = `${date}T${time}:00`;
  const kind = classifyLocal(requested, timeZone);
  const at = resolveLocal(requested, timeZone);
  // In a gap the wall-clock time does not exist: keep the local time that really rings.
  const startLocal = kind === 'gap' ? toLocalDateTime(at, timeZone) : requested;
  return { startLocal, at, day, time: startLocal.slice(11, 16), kind };
}

/**
 * Next occurrence of `HH:MM` in `timeZone`: today if it is still ahead of `now`, otherwise
 * tomorrow (ADR-003 section 3.3: a gap moves forward, a fold takes the first occurrence).
 * Returns null when `time` is not `HH:MM`.
 */
export function nextAlarm(time: string, now: InstantIso, timeZone: TimeZoneId): AlarmPlan | null {
  if (!isAlarmTime(time)) return null;
  const today = toLocalDate(now, timeZone);
  const first = planFor(today, time, timeZone, 'today');
  if (first.at > now) return first;
  return planFor(addDays(today, 1), time, timeZone, 'tomorrow');
}

/**
 * The same wall-clock time one day after `plan` (used once when the scheduler found no future
 * occurrence for the first choice). Returns null when `time` is not `HH:MM`.
 */
export function dayAfterAlarm(
  plan: AlarmPlan,
  time: string,
  timeZone: TimeZoneId,
): AlarmPlan | null {
  if (!isAlarmTime(time)) return null;
  return planFor(addDays(plan.startLocal.slice(0, 10), 1), time, timeZone, 'tomorrow');
}
