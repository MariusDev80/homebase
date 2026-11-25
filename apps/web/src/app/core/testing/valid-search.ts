import { DataError } from '../../data/data-error';

const SEARCH_QUERY_MAX = 200;
const SEARCH_LIMIT_MAX = 20;

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
