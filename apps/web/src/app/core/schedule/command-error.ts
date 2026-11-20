import { DataError } from '../../data';

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
