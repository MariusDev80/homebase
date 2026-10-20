import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { JsonObject } from '../../data';
import type { WidgetConfigSpec } from './widget-definition';

/** Aligned with CHECK length(config) <= 65536 (ADR-002 section 6.3). */
export const MAX_CONFIG_CHARS = 65_536;

export type ConfigErrorReason =
  | 'too-large'
  | 'invalid-version'
  | 'future-version'
  | 'migration-failed'
  | 'schema-mismatch'
  | 'async-schema';

export type ResolvedConfig<TConfig extends JsonObject> =
  | { readonly status: 'ok'; readonly config: TConfig; readonly migratedFrom: number | null }
  | {
      readonly status: 'invalid';
      readonly reason: ConfigErrorReason;
      readonly issues: readonly string[];
    };

export type SerializedConfig<TConfig extends JsonObject> =
  | { readonly ok: true; readonly version: number; readonly config: TConfig }
  | {
      readonly ok: false;
      readonly reason: 'too-large' | 'schema-mismatch' | 'async-schema';
      readonly issues: readonly string[];
    };

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly async: boolean; readonly issues: readonly string[] };

function isThenable(value: unknown): boolean {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function formatIssue(issue: StandardSchemaV1.Issue): string {
  const path = (issue.path ?? [])
    .map((segment) => String(typeof segment === 'object' ? segment.key : segment))
    .join('.');
  return `${path}: ${issue.message}`;
}

/** Synchronous validation; async = true when validate returns a thenable. */
export function validateSync<T>(
  schema: StandardSchemaV1<unknown, T>,
  value: unknown,
): ValidationResult<T> {
  const result = schema['~standard'].validate(value);
  if (isThenable(result)) {
    return { ok: false, async: true, issues: ['asynchronous schema is not supported'] };
  }
  const sync = result as StandardSchemaV1.Result<T>;
  if (sync.issues) {
    return { ok: false, async: false, issues: sync.issues.map(formatIssue) };
  }
  return { ok: true, value: sync.value };
}

function isPlainObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Starting point: what data/ already parsed and checked (a JSON object). Never mutates `stored`. */
export function resolveConfig<TConfig extends JsonObject>(
  spec: WidgetConfigSpec<TConfig>,
  version: number,
  stored: JsonObject,
): ResolvedConfig<TConfig> {
  if (!Number.isInteger(version) || version < 1) {
    return { status: 'invalid', reason: 'invalid-version', issues: [`version: ${version}`] };
  }
  if (version > spec.version) {
    return {
      status: 'invalid',
      reason: 'future-version',
      issues: [`version: ${version} > ${spec.version}`],
    };
  }

  let current: unknown = stored;
  for (let from = version; from < spec.version; from++) {
    const migrate = spec.migrations[from];
    if (typeof migrate !== 'function') {
      return {
        status: 'invalid',
        reason: 'migration-failed',
        issues: [`missing migration ${from} -> ${from + 1}`],
      };
    }
    try {
      current = migrate(current);
    } catch (error) {
      return {
        status: 'invalid',
        reason: 'migration-failed',
        issues: [`migration ${from} -> ${from + 1}: ${errorMessage(error)}`],
      };
    }
  }

  const validated = validateSync(spec.schema, current);
  if (!validated.ok) {
    return {
      status: 'invalid',
      reason: validated.async ? 'async-schema' : 'schema-mismatch',
      issues: validated.issues,
    };
  }
  if (!isPlainObject(validated.value)) {
    return { status: 'invalid', reason: 'schema-mismatch', issues: [': not an object'] };
  }
  return {
    status: 'ok',
    config: validated.value,
    migratedFrom: version < spec.version ? version : null,
  };
}

/** Validates, then checks JSON.stringify(output).length <= MAX_CONFIG_CHARS. */
export function serializeConfig<TConfig extends JsonObject>(
  spec: WidgetConfigSpec<TConfig>,
  value: unknown,
): SerializedConfig<TConfig> {
  const validated = validateSync(spec.schema, value);
  if (!validated.ok) {
    return {
      ok: false,
      reason: validated.async ? 'async-schema' : 'schema-mismatch',
      issues: validated.issues,
    };
  }
  const size = JSON.stringify(validated.value).length;
  if (size > MAX_CONFIG_CHARS) {
    return { ok: false, reason: 'too-large', issues: [`: ${size} > ${MAX_CONFIG_CHARS}`] };
  }
  return { ok: true, version: spec.version, config: validated.value };
}
