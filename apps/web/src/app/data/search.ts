import { DataError } from './data-error';

export const SEARCH_QUERY_MAX = 200;
export const SEARCH_LIMIT_MAX = 20;
const EXCERPT_BEFORE = 30;
const EXCERPT_LENGTH = 100;

/**
 * Validates search arguments: query trimmed to 1..200 characters, limit an integer in 1..20
 * (invalid_input otherwise). Returns the trimmed query.
 */
export function validSearch(query: string, limit: number): string {
  const trimmed = query.trim();
  if (trimmed.length < 1 || trimmed.length > SEARCH_QUERY_MAX) {
    throw new DataError('invalid_input', 'Search query must be 1 to 200 characters');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > SEARCH_LIMIT_MAX) {
    throw new DataError('invalid_input', 'Search limit must be an integer from 1 to 20');
  }
  return trimmed;
}

/**
 * `%term%` LIKE pattern with `\`, `%` and `_` escaped (use with `ESCAPE '\'`).
 * SQLite's LIKE is case-insensitive for ASCII only: accented or non-Latin letters match
 * case-sensitively, and "e" does not match "é" (documented limit, no extension loaded).
 */
export function likeContains(term: string): string {
  return `%${term.replace(/[\\%_]/g, '\\$&')}%`;
}

/** Short single-line excerpt of `body` around the first occurrence of `term` (ASCII-insensitive). */
export function excerptAround(body: string, term: string): string {
  const lowerBody = body.toLowerCase();
  const index = lowerBody.length === body.length ? lowerBody.indexOf(term.toLowerCase()) : -1;
  const start = index > EXCERPT_BEFORE ? index - EXCERPT_BEFORE : 0;
  const slice = body
    .slice(start, start + EXCERPT_LENGTH)
    .replace(/\s+/g, ' ')
    .trim();
  const prefix = start > 0 ? '…' : '';
  const suffix = start + EXCERPT_LENGTH < body.length ? '…' : '';
  return slice === '' ? '' : `${prefix}${slice}${suffix}`;
}
