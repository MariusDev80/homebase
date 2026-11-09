import { DataError } from './data-error';
import type { JsonObject } from './json';
import { MAX_DASHBOARD_THEME_CHARS } from './models';

/**
 * Checks a dashboard theme before it is written (create, createIfNone, updateTheme): a plain
 * object whose serialization stays within MAX_DASHBOARD_THEME_CHARS code points (like SQLite's
 * length()), and an integer version >= 1. Returns the serialized object. The data layer never
 * interprets the content.
 */
export function validTheme(theme: JsonObject, version: number): string {
  const proto: unknown =
    typeof theme === 'object' && theme !== null ? Object.getPrototypeOf(theme) : undefined;
  if (
    typeof theme !== 'object' ||
    theme === null ||
    Array.isArray(theme) ||
    (proto !== Object.prototype && proto !== null)
  ) {
    throw new DataError('invalid_input', 'Dashboard theme must be a plain object');
  }
  if (!Number.isInteger(version) || version < 1) {
    throw new DataError('invalid_input', 'Dashboard theme version must be an integer >= 1');
  }
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(theme);
  } catch {
    serialized = undefined;
  }
  if (serialized === undefined) {
    throw new DataError('invalid_input', 'Dashboard theme is not serializable');
  }
  if ([...serialized].length > MAX_DASHBOARD_THEME_CHARS) {
    throw new DataError(
      'invalid_input',
      `Dashboard theme exceeds ${MAX_DASHBOARD_THEME_CHARS} characters`,
    );
  }
  return serialized;
}
