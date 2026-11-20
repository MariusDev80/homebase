import { InjectionToken } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import {
  DataError,
  type InstantIso,
  type LocalDateIso,
  type LocalDateTimeIso,
  type TimeZoneId,
} from '../../data';
import { isTauriRuntime } from '../../tauri-runtime';
import { TimeError, type RuleErrorCode, type TimeErrorCode } from './time-error';

// ADR-003 sections 3.5.4 and 8.10: the single recurrence engine is the Rust one, reached through
// two pure commands. The front only encodes/decodes (recurrence.ts).

export type ScheduleAnchor =
  | {
      readonly kind: 'date-time';
      readonly startLocal: LocalDateTimeIso;
      readonly timeZone: TimeZoneId;
    }
  | { readonly kind: 'date'; readonly startOn: LocalDateIso };

export interface RecurrenceSpec {
  readonly anchor: ScheduleAnchor;
  readonly rrule: string | null;
  readonly exdates: readonly string[];
}

export type Occurrence =
  | {
      readonly kind: 'date-time';
      readonly key: LocalDateTimeIso;
      readonly start: InstantIso;
      readonly nominalLocal: LocalDateTimeIso;
      readonly timeZone: TimeZoneId;
    }
  | { readonly kind: 'date'; readonly key: LocalDateIso; readonly date: LocalDateIso };

export interface ExpandRange {
  readonly from: InstantIso;
  readonly to: InstantIso;
  readonly timeZone: TimeZoneId;
  readonly limit?: number;
}

export interface RecurrenceEngine {
  /** Rejects with TimeError (Rust error translated) or DataError('unavailable') outside Tauri. */
  validate(
    spec: RecurrenceSpec,
  ): Promise<{ readonly rrule: string | null; readonly exdates: readonly string[] }>;
  expand(
    spec: RecurrenceSpec,
    range: ExpandRange,
  ): Promise<{ readonly occurrences: readonly Occurrence[]; readonly truncated: boolean }>;
}

const TIME_ERROR_CODES: readonly string[] = [
  'invalid_instant',
  'invalid_local_date',
  'invalid_local_date_time',
  'out_of_range',
  'unknown_time_zone',
  'invalid_rule',
  'invalid_exdate',
  'invalid_range',
  'expansion_limit',
  'not_schedulable',
] satisfies TimeErrorCode[];

interface RustTimeError {
  readonly kind: string;
  readonly code?: string;
  readonly part?: string | null;
  readonly value?: string;
}

function isRustTimeError(value: unknown): value is RustTimeError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { kind?: unknown }).kind === 'string'
  );
}

/** Translates the serialized Rust `TimeError` into a `TimeError`; anything else is rethrown. */
export function translateTimeError(error: unknown): never {
  if (error instanceof TimeError || error instanceof DataError) throw error;
  if (isRustTimeError(error) && TIME_ERROR_CODES.includes(error.kind)) {
    const kind = error.kind as TimeErrorCode;
    if (kind === 'invalid_rule') {
      throw new TimeError(kind, 'Invalid recurrence rule', {
        rule: error.code as RuleErrorCode | undefined,
        ...(error.part ? { part: error.part } : {}),
      });
    }
    throw new TimeError(
      kind,
      `Time error: ${kind}`,
      error.value ? { value: error.value } : undefined,
    );
  }
  throw new DataError('unknown', 'Unexpected recurrence engine error', { cause: error });
}

export class TauriRecurrenceEngine implements RecurrenceEngine {
  async validate(
    spec: RecurrenceSpec,
  ): Promise<{ readonly rrule: string | null; readonly exdates: readonly string[] }> {
    this.requireTauri();
    try {
      return await invoke<{ rrule: string | null; exdates: string[] }>('time_validate', { spec });
    } catch (e) {
      return translateTimeError(e);
    }
  }

  async expand(
    spec: RecurrenceSpec,
    range: ExpandRange,
  ): Promise<{ readonly occurrences: readonly Occurrence[]; readonly truncated: boolean }> {
    this.requireTauri();
    const payload = {
      from: range.from,
      to: range.to,
      timeZone: range.timeZone,
      ...(range.limit === undefined ? {} : { limit: range.limit }),
    };
    try {
      return await invoke<{ occurrences: Occurrence[]; truncated: boolean }>('time_expand', {
        spec,
        range: payload,
      });
    } catch (e) {
      return translateTimeError(e);
    }
  }

  private requireTauri(): void {
    if (!isTauriRuntime()) {
      throw new DataError('unavailable', 'Homebase doit être lancé via Tauri');
    }
  }
}

export const RECURRENCE_ENGINE = new InjectionToken<RecurrenceEngine>('RECURRENCE_ENGINE', {
  providedIn: 'root',
  factory: () => new TauriRecurrenceEngine(),
});
