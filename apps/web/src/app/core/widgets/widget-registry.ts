import { Injectable, InjectionToken, Provider, inject } from '@angular/core';
import type { JsonObject } from '../../data';
import { GRID_COLUMNS, GRID_MAX_ROWS } from './grid';
import { MAX_CONFIG_CHARS, validateSync } from './widget-config';
import {
  WIDGET_ICON_PATTERN,
  WIDGET_PERMISSION_KINDS,
  WIDGET_TYPE_ID_PATTERN,
  WidgetDefinition,
  WidgetSizeConstraints,
  WidgetTypeId,
} from './widget-definition';

/** Multi-provided token, fed by `provideWidget()`. */
export const WIDGET_DEFINITIONS = new InjectionToken<readonly WidgetDefinition[]>(
  'WIDGET_DEFINITIONS',
);

export function provideWidget<TConfig extends JsonObject>(
  definition: WidgetDefinition<TConfig>,
): Provider {
  return { provide: WIDGET_DEFINITIONS, useValue: definition, multi: true };
}

export class WidgetRegistryError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid widget definitions:\n- ${problems.join('\n- ')}`);
    this.name = 'WidgetRegistryError';
    this.problems = problems;
  }
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/** Strict structural equality between a value and its JSON round trip (plain data only). */
function isJsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  return (
    keysA.length === keysB.length &&
    keysA.every(
      (key) =>
        Object.hasOwn(b, key) &&
        isJsonEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    )
  );
}

function sizeProblems(size: WidgetSizeConstraints): string[] {
  const problems: string[] = [];
  const entries = [
    ['min', size.min],
    ['default', size.default],
    ['max', size.max],
  ] as const;
  for (const [name, value] of entries) {
    if (!isPositiveInt(value.w) || !isPositiveInt(value.h)) {
      problems.push(`size.${name} must be made of integers >= 1`);
    }
  }
  if (problems.length > 0) return problems;
  for (const axis of ['w', 'h'] as const) {
    if (!(size.min[axis] <= size.default[axis] && size.default[axis] <= size.max[axis])) {
      problems.push(`size.${axis} must satisfy min <= default <= max`);
    }
  }
  if (size.max.w > GRID_COLUMNS) problems.push(`size.max.w must be <= ${GRID_COLUMNS}`);
  if (size.max.h > GRID_MAX_ROWS) problems.push(`size.max.h must be <= ${GRID_MAX_ROWS}`);
  return problems;
}

function configProblems(config: WidgetDefinition['config']): string[] {
  const problems: string[] = [];
  if (!isPositiveInt(config.version)) {
    problems.push('config.version must be an integer >= 1');
  } else {
    const expected = Array.from({ length: config.version - 1 }, (_, i) => String(i + 1));
    const actual = Object.keys(config.migrations);
    for (const key of expected) {
      if (!actual.includes(key)) problems.push(`config.migrations is missing key ${key}`);
    }
    for (const key of actual) {
      if (!expected.includes(key)) problems.push(`config.migrations has unexpected key ${key}`);
    }
  }

  let defaults: unknown;
  try {
    defaults = config.defaults();
  } catch (error) {
    problems.push(`config.defaults() threw: ${String(error)}`);
    return problems;
  }
  const direct = validateSync(config.schema, defaults);
  if (!direct.ok) {
    problems.push(
      direct.async
        ? 'config.schema must be synchronous'
        : `config.defaults() is invalid: ${direct.issues.join('; ')}`,
    );
    return problems;
  }
  const json = JSON.stringify(defaults);
  if (json.length > MAX_CONFIG_CHARS) {
    problems.push(`config.defaults() exceeds ${MAX_CONFIG_CHARS} characters`);
  }
  const parsed: unknown = JSON.parse(json);
  const roundTrip = validateSync(config.schema, parsed);
  if (
    !roundTrip.ok ||
    JSON.stringify(roundTrip.value) !== json ||
    !isJsonEqual(direct.value, parsed)
  ) {
    problems.push('config.defaults() does not survive a JSON round trip');
  }
  return problems;
}

/** Problems of ONE definition (empty when valid). Pure. */
export function validateDefinition(definition: WidgetDefinition): readonly string[] {
  const problems: string[] = [];
  if (!WIDGET_TYPE_ID_PATTERN.test(definition.type)) {
    problems.push(`type must match ${WIDGET_TYPE_ID_PATTERN}`);
  }
  if (!WIDGET_ICON_PATTERN.test(definition.icon)) {
    problems.push(`icon must match ${WIDGET_ICON_PATTERN}`);
  }
  if (!definition.titleKey) problems.push('titleKey must not be empty');
  if (!definition.descriptionKey) problems.push('descriptionKey must not be empty');
  if (typeof definition.loadComponent !== 'function') {
    problems.push('loadComponent must be a function');
  }
  problems.push(...sizeProblems(definition.size));
  problems.push(...configProblems(definition.config));

  const seen = new Set<string>();
  for (const permission of definition.permissions) {
    if (!WIDGET_PERMISSION_KINDS.includes(permission)) {
      problems.push(`unknown permission "${permission}"`);
    } else if (seen.has(permission)) {
      problems.push(`duplicate permission "${permission}"`);
    }
    seen.add(permission);
  }
  if (definition.maxInstances !== undefined && !isPositiveInt(definition.maxInstances)) {
    problems.push('maxInstances must be an integer >= 1');
  }
  return problems;
}

@Injectable({ providedIn: 'root' })
export class WidgetRegistry {
  private readonly definitions: readonly WidgetDefinition[] =
    inject(WIDGET_DEFINITIONS, { optional: true }) ?? [];
  private readonly byType: ReadonlyMap<WidgetTypeId, WidgetDefinition>;

  constructor() {
    const problems: string[] = [];
    const map = new Map<WidgetTypeId, WidgetDefinition>();
    for (const definition of this.definitions) {
      for (const problem of validateDefinition(definition)) {
        problems.push(`${definition.type}: ${problem}`);
      }
      if (map.has(definition.type)) {
        problems.push(`${definition.type}: duplicate widget type`);
      }
      map.set(definition.type, definition);
    }
    if (problems.length > 0) throw new WidgetRegistryError(problems);
    this.byType = map;
  }

  get(type: WidgetTypeId): WidgetDefinition | undefined {
    return this.byType.get(type);
  }

  /** In registration order. */
  list(): readonly WidgetDefinition[] {
    return this.definitions;
  }
}
