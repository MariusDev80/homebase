import { DataError } from './data-error';
import type { JsonObject } from './json';
import { MAX_DASHBOARD_THEME_CHARS } from './models';

/** Deepest nesting accepted (SQLite json_valid stops at 1000, serde_json at 128). */
export const MAX_DASHBOARD_THEME_DEPTH = 100;

/** Nesting depth of a serialized JSON text (`{}` = 1), brackets inside strings ignored. */
function jsonDepth(text: string): number {
  let depth = 0;
  let max = 0;
  let inString = false;
  let escaped = false;
  for (const char of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === '{' || char === '[') {
      depth += 1;
      if (depth > max) max = depth;
    } else if (char === '}' || char === ']') {
      depth -= 1;
    }
  }
  return max;
}

/**
 * Checks a dashboard theme before it is written (create, createIfNone, updateTheme): a plain
 * object whose serialization stays within MAX_DASHBOARD_THEME_CHARS code points (like SQLite's
 * length()), a safe integer version >= 1, nesting <= MAX_DASHBOARD_THEME_DEPTH. Returns the serialized object. The data layer never
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
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new DataError('invalid_input', 'Dashboard theme version must be a safe integer >= 1');
  }
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(theme);
  } catch {
    serialized = undefined;
  }
  // A toJSON returning a non-object would pass JSON.stringify but fail the CHECK (json_type).
  if (serialized === undefined || !serialized.startsWith('{')) {
    throw new DataError('invalid_input', 'Dashboard theme is not serializable');
  }
  if (jsonDepth(serialized) > MAX_DASHBOARD_THEME_DEPTH) {
    throw new DataError(
      'invalid_input',
      `Dashboard theme is nested deeper than ${MAX_DASHBOARD_THEME_DEPTH} levels`,
    );
  }
  if ([...serialized].length > MAX_DASHBOARD_THEME_CHARS) {
    throw new DataError(
      'invalid_input',
      `Dashboard theme exceeds ${MAX_DASHBOARD_THEME_CHARS} characters`,
    );
  }
  return serialized;
}
