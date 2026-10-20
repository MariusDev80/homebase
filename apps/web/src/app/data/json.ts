import { DataError } from './data-error';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}

/** JSON.parse that maps syntax errors to DataError('corrupt_data'). */
export function parseJsonValue(text: string): JsonValue {
  try {
    return JSON.parse(text) as JsonValue;
  } catch (cause) {
    throw new DataError('corrupt_data', 'Stored value is not valid JSON', { cause });
  }
}

/** JSON.parse + check; throws DataError('corrupt_data') if the result is not a plain object. */
export function parseJsonObject(text: string): JsonObject {
  const value = parseJsonValue(text);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DataError('corrupt_data', 'Stored value is not a JSON object');
  }
  return value;
}
