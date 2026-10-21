// ADR-003 section 3.1 / 8.2: stored time shapes. Pure: no Temporal, no Angular.

/** `YYYY-MM-DDTHH:MM:SS.sssZ` (24 characters, always `Z`). */
export type InstantIso = string;
/** `YYYY-MM-DD` (calendar date, no time, no zone). */
export type LocalDateIso = string;
/** `YYYY-MM-DDTHH:MM:SS` (wall-clock time, no fraction, no offset). */
export type LocalDateTimeIso = string;
/** IANA zone identifier, in the form normalised by Temporal. */
export type TimeZoneId = string;

export const INSTANT_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
export const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const LOCAL_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
/** Also requires a length of 1..64 (see `hasTimeZoneIdShape`). */
export const TIME_ZONE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/;
export const MIN_LOCAL_DATE = '1900-01-01';
export const MAX_LOCAL_DATE = '2199-12-31';

const TIME_ZONE_ID_MAX_LENGTH = 64;

/** Shape only (pattern + bounds); calendar validity lives in core/time and the SQL CHECKs. */
export function hasInstantShape(value: string): boolean {
  return INSTANT_ISO_PATTERN.test(value) && value >= MIN_LOCAL_DATE && value < '2200-01-01';
}

export function hasLocalDateShape(value: string): boolean {
  return LOCAL_DATE_PATTERN.test(value) && value >= MIN_LOCAL_DATE && value <= MAX_LOCAL_DATE;
}

export function hasLocalDateTimeShape(value: string): boolean {
  return LOCAL_DATE_TIME_PATTERN.test(value) && value >= MIN_LOCAL_DATE && value < '2200-01-01';
}

/** Pattern + length + explicit refusal of `Etc/Unknown` (case-insensitive). */
export function hasTimeZoneIdShape(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= TIME_ZONE_ID_MAX_LENGTH &&
    TIME_ZONE_ID_PATTERN.test(value) &&
    value.toLowerCase() !== 'etc/unknown'
  );
}
