import { DataError } from '../data-error';

function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return String(e);
}

/**
 * Maps a SQLite/plugin error to a DataError by message pattern (ADR-002 S3).
 * The raw error is kept as `cause`; parameter values are never logged.
 */
export function toDataError(e: unknown): DataError {
  if (e instanceof DataError) return e;
  const message = messageOf(e);
  const has = (s: string): boolean => message.includes(s);

  if (has('UNIQUE constraint failed') || has('PRIMARY KEY')) {
    return new DataError('conflict', 'Unique constraint violated', { cause: e });
  }
  if (
    has('FOREIGN KEY constraint failed') ||
    has('CHECK constraint failed') ||
    has('NOT NULL constraint failed') ||
    has('cannot store')
  ) {
    return new DataError('constraint', 'Constraint violated', { cause: e });
  }
  if (has('database is locked') || has('database is busy')) {
    return new DataError('busy', 'Database is busy', { cause: e });
  }
  if (has('not loaded')) {
    return new DataError('unavailable', 'Database is not loaded', { cause: e });
  }
  return new DataError('unknown', 'Unexpected database error', { cause: e });
}
