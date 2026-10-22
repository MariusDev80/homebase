import * as v from 'valibot';
import type { JsonObject, JsonValue } from '../../data';
import { isValidInstant } from '../time';
import { MAX_CONFIG_CHARS, resolveConfig, serializeConfig } from '../widgets';
import type { WidgetDefinition } from '../widgets';
import type {
  ConfigImportPlan,
  ConfigImportPlanDashboard,
  ConfigImportPlanSetting,
  ConfigImportPlanWidget,
  ImportIssue,
  ImportIssueCode,
  ImportPreview,
} from './backup.types';
import { codePointLength, hbTrim } from './hb-trim';

/**
 * Pure part of the configuration export / import (spec backup-restore 4.12). No Angular, no I/O.
 * The file is untrusted data: no object spread-merge, no deep merge, no `obj[untrustedKey] = ...`
 * anywhere here; keys go through arrays of pairs and `Map`s.
 */

export const CONFIG_FORMAT = 'homebase/dashboard-config';
export const CONFIG_FORMAT_VERSION = 1;

/** Same pattern as `SqliteSettingsRepository` (data/ is not touched, so it is repeated here). */
export const SECRET_KEY_PATTERN = /(secret|token|passw(or)?d|api[-_.]?key|credential)/i;
export const SETTING_KEY_PATTERN = /^[a-z][a-z0-9._-]{0,127}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Limits of spec 4.3, identical in Rust (`config_transfer.rs`). Lengths are in code points. */
export const CONFIG_LIMITS = {
  maxFileBytes: 1_048_576,
  minDashboards: 1,
  maxDashboards: 100,
  maxWidgetsPerDashboard: 200,
  maxWidgets: 1_000,
  maxSettings: 200,
  maxGrid: 10_000,
  maxSortOrder: 1_000_000,
  maxConfigVersion: 10_000,
  maxNameChars: 100,
  maxWidgetTypeChars: 64,
  maxJsonChars: 65_536,
} as const;

/** Problems reported at most (one is enough to refuse the file). */
export const MAX_REPORTED_ISSUES = 20;

// ---------------------------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------------------------

interface GridShape {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface ConfigExportWidget {
  readonly id: string;
  readonly widgetType: string;
  readonly grid: GridShape;
  readonly config: { readonly version: number; readonly data: JsonObject };
}

export interface ConfigExportDashboard {
  readonly id: string;
  readonly name: string;
  readonly sortOrder: number;
  readonly widgets: readonly ConfigExportWidget[];
}

export interface ConfigExportDocument {
  readonly format: typeof CONFIG_FORMAT;
  readonly formatVersion: typeof CONFIG_FORMAT_VERSION;
  readonly exportedAt: string;
  readonly dashboards: readonly ConfigExportDashboard[];
  readonly settings: Readonly<Record<string, JsonValue>>;
}

export interface ConfigExportInput {
  readonly exportedAt: string;
  /** In display order; each with its instances in display order. */
  readonly dashboards: readonly {
    readonly id: string;
    readonly name: string;
    readonly sortOrder: number;
    readonly widgets: readonly {
      readonly id: string;
      readonly widgetType: string;
      readonly grid: GridShape;
      readonly config: JsonObject;
      readonly configVersion: number;
    }[];
  }[];
  readonly settings: ReadonlyMap<string, JsonValue>;
}

/**
 * Builds the export document. Notes, tasks and shortcuts are not part of it; settings whose key
 * looks secret are dropped; the others are sorted by key.
 */
export function buildConfigExport(input: ConfigExportInput): ConfigExportDocument {
  const pairs = [...input.settings.entries()]
    .filter(([key]) => !SECRET_KEY_PATTERN.test(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    format: CONFIG_FORMAT,
    formatVersion: CONFIG_FORMAT_VERSION,
    exportedAt: input.exportedAt,
    dashboards: input.dashboards.map((dashboard) => ({
      id: dashboard.id,
      name: dashboard.name,
      sortOrder: dashboard.sortOrder,
      widgets: dashboard.widgets.map((widget) => ({
        id: widget.id,
        widgetType: widget.widgetType,
        grid: { x: widget.grid.x, y: widget.grid.y, w: widget.grid.w, h: widget.grid.h },
        config: { version: widget.configVersion, data: widget.config },
      })),
    })),
    settings: Object.fromEntries(pairs),
  };
}

export function serializeConfigExport(document: ConfigExportDocument): string {
  return JSON.stringify(document, null, 2);
}

export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

// ---------------------------------------------------------------------------------------------
// Import: analysis
// ---------------------------------------------------------------------------------------------

export type WidgetLookup = (widgetType: string) => WidgetDefinition | undefined;

export interface ParsedConfigImport {
  readonly plan: ConfigImportPlan;
  /** Distinct widget types of the file that this build does not know (kept as is). */
  readonly unknownTypes: readonly string[];
  /** Instances whose config version is newer than this build (kept as is). */
  readonly futureVersions: number;
}

export type ParseConfigImportResult =
  | { readonly ok: true; readonly value: ParsedConfigImport }
  | {
      readonly ok: false;
      readonly issues: readonly ImportIssue[];
      /** More problems exist than the ones listed. */
      readonly truncated: boolean;
    };

const envelopeSchema = v.strictObject({
  format: v.literal(CONFIG_FORMAT),
  formatVersion: v.number(),
  exportedAt: v.string(),
  dashboards: v.array(
    v.strictObject({
      id: v.string(),
      name: v.string(),
      sortOrder: v.number(),
      widgets: v.array(
        v.strictObject({
          id: v.string(),
          widgetType: v.string(),
          grid: v.strictObject({ x: v.number(), y: v.number(), w: v.number(), h: v.number() }),
          config: v.strictObject({ version: v.number(), data: v.unknown() }),
        }),
      ),
    }),
  ),
  settings: v.unknown(),
});

class IssueCollector {
  private readonly found: ImportIssue[] = [];
  private overflow = false;

  add(code: ImportIssueCode, path: string): void {
    if (this.found.length >= MAX_REPORTED_ISSUES) {
      this.overflow = true;
      return;
    }
    this.found.push({ code, path });
  }

  get any(): boolean {
    return this.found.length > 0;
  }

  get full(): boolean {
    return this.overflow;
  }

  failure(): ParseConfigImportResult {
    return { ok: false, issues: this.found, truncated: this.overflow };
  }
}

/**
 * A key that comes from the file is only shown when it is plain (ASCII word, 40 characters at
 * most): a long or bidirectional-control key would otherwise reach the screen as is.
 */
const DISPLAYABLE_KEY = /^[A-Za-z0-9_]{1,40}$/;

function valibotPath(issue: v.BaseIssue<unknown>): string {
  let path = '';
  for (const item of issue.path ?? []) {
    if (typeof item.key === 'number') {
      path += `[${item.key}]`;
    } else {
      const key = String(item.key);
      // Not displayable: the report stops at the parent path.
      if (!DISPLAYABLE_KEY.test(key)) break;
      path += path ? `.${key}` : key;
    }
  }
  return path;
}

function valibotCode(issue: v.BaseIssue<unknown>): ImportIssueCode {
  const last = issue.path?.at(-1);
  if (issue.type === 'strict_object' && last?.origin === 'key') {
    return issue.expected === 'never' ? 'unknown_field' : 'missing_field';
  }
  return 'invalid_value';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * Deepest nesting of arrays/objects accepted: serde_json refuses a document whose depth reaches
 * 128, so 127 nested containers is the last one that Rust still reads.
 */
export const MAX_JSON_DEPTH = 127;

/**
 * True when the parsed document holds something Rust (serde_json) would refuse or silently
 * change: a lone surrogate (string or key), a non-finite number (`1e400`), or nesting deeper
 * than `MAX_JSON_DEPTH`. Iterative, so deep input cannot overflow the stack.
 */
function isUnrepresentable(root: unknown): boolean {
  const stack: [unknown, number][] = [[root, 0]];
  while (stack.length > 0) {
    const [value, depth] = stack.pop() as [unknown, number];
    if (typeof value === 'string') {
      if (LONE_SURROGATE.test(value)) return true;
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) return true;
    } else if (Array.isArray(value)) {
      if (depth + 1 > MAX_JSON_DEPTH) return true;
      for (const child of value as unknown[]) stack.push([child, depth + 1]);
    } else if (isPlainObject(value)) {
      if (depth + 1 > MAX_JSON_DEPTH) return true;
      for (const [key, child] of Object.entries(value)) {
        if (LONE_SURROGATE.test(key)) return true;
        stack.push([child, depth + 1]);
      }
    }
  }
  return false;
}

function isIntegerIn(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

interface WidgetOutcome {
  readonly config: string;
  readonly configVersion: number;
  readonly unknownType: boolean;
  readonly future: boolean;
}

/** Resolves one widget config against the registry; `null` when it is invalid. */
function resolveWidget(
  definition: WidgetDefinition | undefined,
  version: number,
  data: unknown,
): WidgetOutcome | null {
  if (!isPlainObject(data)) return null;
  const stored = data as JsonObject;
  if (definition === undefined) {
    const raw = JSON.stringify(stored);
    if (raw.length > MAX_CONFIG_CHARS) return null;
    return { config: raw, configVersion: version, unknownType: true, future: false };
  }
  const resolved = resolveConfig(definition.config, version, stored);
  if (resolved.status === 'ok') {
    const serialized = serializeConfig(definition.config, resolved.config);
    if (!serialized.ok) return null;
    return {
      config: JSON.stringify(serialized.config),
      configVersion: serialized.version,
      unknownType: false,
      future: false,
    };
  }
  if (resolved.reason === 'future-version') {
    const raw = JSON.stringify(stored);
    if (raw.length > MAX_CONFIG_CHARS) return null;
    return { config: raw, configVersion: version, unknownType: false, future: true };
  }
  return null;
}

/**
 * Parses and validates an exported file (untrusted). Returns the plan for `config_import_apply`
 * or the list of problems (at most `MAX_REPORTED_ISSUES`).
 */
export function parseConfigImport(text: string, lookup: WidgetLookup): ParseConfigImportResult {
  const issues = new IssueCollector();
  // UTF-16 units never outnumber UTF-8 bytes: the cheap test first, the exact one only if needed.
  if (
    text.length > CONFIG_LIMITS.maxFileBytes ||
    utf8ByteLength(text) > CONFIG_LIMITS.maxFileBytes
  ) {
    issues.add('too_large', '');
    return issues.failure();
  }
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    issues.add('invalid_json', '');
    return issues.failure();
  }
  try {
    return analyse(root, lookup, issues);
  } catch (error) {
    if (error instanceof RangeError) {
      // Pathologically deep nesting (stack overflow while serializing).
      const deep = new IssueCollector();
      deep.add('invalid_value', '');
      return deep.failure();
    }
    throw error;
  }
}

function analyse(
  root: unknown,
  lookup: WidgetLookup,
  issues: IssueCollector,
): ParseConfigImportResult {
  if (isUnrepresentable(root)) {
    issues.add('invalid_value', '');
    return issues.failure();
  }
  const parsed = v.safeParse(envelopeSchema, root, { abortEarly: false });
  if (!parsed.success) {
    for (const issue of parsed.issues) {
      issues.add(valibotCode(issue), valibotPath(issue));
    }
    return issues.failure();
  }
  const doc = parsed.output;

  if (doc.formatVersion > CONFIG_FORMAT_VERSION) {
    issues.add('unsupported_version', 'formatVersion');
    return issues.failure();
  }
  if (doc.formatVersion !== CONFIG_FORMAT_VERSION) issues.add('invalid_value', 'formatVersion');
  if (!isValidInstant(doc.exportedAt)) issues.add('invalid_value', 'exportedAt');

  if (doc.dashboards.length < CONFIG_LIMITS.minDashboards) issues.add('no_dashboard', 'dashboards');
  if (doc.dashboards.length > CONFIG_LIMITS.maxDashboards) issues.add('too_many', 'dashboards');
  const totalWidgets = doc.dashboards.reduce((sum, d) => sum + d.widgets.length, 0);
  if (totalWidgets > CONFIG_LIMITS.maxWidgets) issues.add('too_many', 'dashboards');

  const dashboardIds = new Set<string>();
  const widgetIds = new Set<string>();
  const unknownTypes = new Set<string>();
  let futureVersions = 0;
  const dashboards: ConfigImportPlanDashboard[] = [];

  doc.dashboards.forEach((dashboard, di) => {
    if (issues.full) return;
    const dPath = `dashboards[${di}]`;
    if (!UUID_PATTERN.test(dashboard.id)) issues.add('invalid_id', `${dPath}.id`);
    else if (dashboardIds.has(dashboard.id)) issues.add('duplicate_id', `${dPath}.id`);
    dashboardIds.add(dashboard.id);

    const name = hbTrim(dashboard.name);
    const nameLength = codePointLength(name);
    if (
      nameLength < 1 ||
      nameLength > CONFIG_LIMITS.maxNameChars ||
      name.includes(String.fromCharCode(0))
    ) {
      issues.add('invalid_name', `${dPath}.name`);
    }
    if (!isIntegerIn(dashboard.sortOrder, 0, CONFIG_LIMITS.maxSortOrder)) {
      issues.add('invalid_value', `${dPath}.sortOrder`);
    }
    if (dashboard.widgets.length > CONFIG_LIMITS.maxWidgetsPerDashboard) {
      issues.add('too_many', `${dPath}.widgets`);
    }

    const perType = new Map<string, number>();
    const widgets: ConfigImportPlanWidget[] = [];
    dashboard.widgets.forEach((widget, wi) => {
      const wPath = `${dPath}.widgets[${wi}]`;
      if (!UUID_PATTERN.test(widget.id)) issues.add('invalid_id', `${wPath}.id`);
      else if (widgetIds.has(widget.id)) issues.add('duplicate_id', `${wPath}.id`);
      widgetIds.add(widget.id);

      const typeLength = codePointLength(widget.widgetType);
      if (
        typeLength < 1 ||
        typeLength > CONFIG_LIMITS.maxWidgetTypeChars ||
        widget.widgetType.includes(String.fromCharCode(0))
      ) {
        issues.add('invalid_value', `${wPath}.widgetType`);
      }
      const { x, y, w, h } = widget.grid;
      for (const [axis, value, min] of [
        ['x', x, 0],
        ['y', y, 0],
        ['w', w, 1],
        ['h', h, 1],
      ] as const) {
        if (!isIntegerIn(value, min, CONFIG_LIMITS.maxGrid)) {
          issues.add('invalid_value', `${wPath}.grid.${axis}`);
        }
      }
      const version = widget.config.version;
      if (!isIntegerIn(version, 1, CONFIG_LIMITS.maxConfigVersion)) {
        issues.add('invalid_value', `${wPath}.config.version`);
        return;
      }
      const definition = lookup(widget.widgetType);
      const outcome = resolveWidget(definition, version, widget.config.data);
      if (outcome === null) {
        issues.add('invalid_config', `${wPath}.config`);
        return;
      }
      if (outcome.unknownType) {
        unknownTypes.add(widget.widgetType);
      } else {
        const count = (perType.get(widget.widgetType) ?? 0) + 1;
        perType.set(widget.widgetType, count);
        if (definition?.maxInstances !== undefined && count > definition.maxInstances) {
          issues.add('max_instances', wPath);
        }
      }
      if (outcome.future) futureVersions++;
      widgets.push({
        id: widget.id,
        widgetType: widget.widgetType,
        grid: { x, y, w, h },
        config: outcome.config,
        configVersion: outcome.configVersion,
      });
    });
    dashboards.push({ id: dashboard.id, name, sortOrder: dashboard.sortOrder, widgets });
  });

  const settings: ConfigImportPlanSetting[] = [];
  if (!isPlainObject(doc.settings)) {
    issues.add('invalid_value', 'settings');
  } else {
    const entries = Object.entries(doc.settings);
    if (entries.length > CONFIG_LIMITS.maxSettings) issues.add('too_many', 'settings');
    for (const [key, value] of entries) {
      const sPath = DISPLAYABLE_KEY.test(key) ? `settings.${key}` : 'settings';
      if (SECRET_KEY_PATTERN.test(key)) {
        issues.add('secret_setting', sPath);
        continue;
      }
      if (!SETTING_KEY_PATTERN.test(key)) {
        issues.add('invalid_setting_key', sPath);
        continue;
      }
      const serialized = JSON.stringify(value);
      if (serialized === undefined || codePointLength(serialized) > CONFIG_LIMITS.maxJsonChars) {
        issues.add('invalid_setting_value', sPath);
        continue;
      }
      settings.push({ key, value: serialized });
    }
  }

  if (issues.any) return issues.failure();
  return {
    ok: true,
    value: {
      plan: { dashboards, settings },
      unknownTypes: [...unknownTypes].sort(),
      futureVersions,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Import: preview
// ---------------------------------------------------------------------------------------------

export interface CurrentConfigState {
  readonly dashboards: readonly { readonly id: string }[];
  readonly widgets: readonly { readonly id: string; readonly widgetType: string }[];
}

/**
 * What the replacement would do, by id: instances present on both sides are kept (even when they
 * move to another dashboard), unless their type differs (deleted, then recreated).
 */
export function buildImportPreview(
  parsed: ParsedConfigImport,
  current: CurrentConfigState,
): ImportPreview {
  const fileDashboards = new Set<string>();
  const fileWidgetTypes = new Map<string, string>();
  for (const dashboard of parsed.plan.dashboards) {
    fileDashboards.add(dashboard.id);
    for (const widget of dashboard.widgets) fileWidgetTypes.set(widget.id, widget.widgetType);
  }
  let removedWidgets = 0;
  let replacedWidgets = 0;
  for (const widget of current.widgets) {
    const fileType = fileWidgetTypes.get(widget.id);
    if (fileType === undefined) removedWidgets++;
    else if (fileType !== widget.widgetType) replacedWidgets++;
  }
  return {
    dashboards: parsed.plan.dashboards.length,
    widgets: fileWidgetTypes.size,
    settings: parsed.plan.settings.length,
    unknownTypes: parsed.unknownTypes,
    futureVersions: parsed.futureVersions,
    removedDashboards: current.dashboards.filter((d) => !fileDashboards.has(d.id)).length,
    removedWidgets,
    replacedWidgets,
  };
}
