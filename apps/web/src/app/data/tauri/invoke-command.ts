import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from '../../tauri-runtime';
import { DataError, type DataErrorKind } from '../data-error';

// Rust `ScheduleError` is serialised as `{ kind, ... }` (schedule/error.rs).
const KIND_MAP: Readonly<Record<string, DataErrorKind>> = {
  invalid_input: 'invalid_input',
  time: 'invalid_input',
  not_found: 'not_found',
  conflict: 'conflict',
  already_running: 'conflict',
  limit_reached: 'forbidden',
  busy: 'busy',
};

function rustKind(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null) {
    const kind = (error as { kind?: unknown }).kind;
    if (typeof kind === 'string') return kind;
  }
  return undefined;
}

/** Translates a Rust schedule error (or anything else) into a DataError; the original is the cause. */
export function translateCommandError(error: unknown): DataError {
  if (error instanceof DataError) return error;
  const kind = rustKind(error);
  const mapped = kind === undefined ? undefined : KIND_MAP[kind];
  return new DataError(mapped ?? 'unknown', `Command failed (${kind ?? 'unexpected error'})`, {
    cause: error,
  });
}

/** Calls a Tauri command. Outside Tauri: DataError('unavailable'). */
export async function invokeCommand<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) {
    throw new DataError('unavailable', 'Homebase doit être lancé via Tauri');
  }
  try {
    return await invoke<T>(name, args);
  } catch (error) {
    throw translateCommandError(error);
  }
}

/** What the Rust error of a failed command says about the culprit (for field-level messages). */
export interface CommandErrorDetails {
  /** DTO field of an `invalid_input` error (camelCase), e.g. `title`. */
  readonly field?: string;
  /** Kind of the nested time error of a `time` error, e.g. `invalid_rule`. */
  readonly timeKind?: string;
  /** Code of the nested time error, e.g. `count_and_until`. */
  readonly code?: string;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Reads `field` (invalid_input) or the nested time error (time) out of a DataError's cause. */
export function commandErrorDetails(error: unknown): CommandErrorDetails {
  const cause = error instanceof DataError ? error.cause : undefined;
  if (typeof cause !== 'object' || cause === null) return {};
  const raw = cause as { kind?: unknown; field?: unknown; error?: unknown };
  if (raw.kind === 'invalid_input') {
    const field = text(raw.field);
    return field === undefined ? {} : { field };
  }
  if (raw.kind === 'time' && typeof raw.error === 'object' && raw.error !== null) {
    const nested = raw.error as { kind?: unknown; code?: unknown };
    const timeKind = text(nested.kind);
    const code = text(nested.code);
    return {
      ...(timeKind === undefined ? {} : { timeKind }),
      ...(code === undefined ? {} : { code }),
    };
  }
  return {};
}
