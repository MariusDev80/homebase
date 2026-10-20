export type DataErrorKind =
  | 'not_found'
  | 'conflict'
  | 'constraint'
  | 'busy'
  | 'corrupt_data'
  | 'forbidden'
  | 'invalid_input'
  | 'unavailable'
  | 'unknown';

/** Normalized data-layer error. The raw SQLite message is kept in `cause` only. */
export class DataError extends Error {
  readonly kind: DataErrorKind;

  constructor(kind: DataErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DataError';
    this.kind = kind;
  }
}
