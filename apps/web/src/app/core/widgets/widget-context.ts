import { InjectionToken, Signal, inject, signal } from '@angular/core';
import { DataError } from '../../data';
import type { JsonObject, WidgetInstanceRecord } from '../../data';
import { serializeConfig } from './widget-config';
import type { ConfigErrorReason } from './widget-config';
import type {
  GridSize,
  WidgetDefinition,
  WidgetPermissionKind,
  WidgetTypeId,
} from './widget-definition';

export interface WidgetContext<TConfig extends JsonObject = JsonObject> {
  /** = WidgetInstanceRecord.id */
  readonly instanceId: string;
  /** = WidgetInstanceRecord.widgetType */
  readonly type: WidgetTypeId;
  readonly config: Signal<TConfig>;
  /** = clampGrid(record.grid) -> { w, h } */
  readonly size: Signal<GridSize>;
  readonly permissions: ReadonlySet<WidgetPermissionKind>;
  updateConfig(next: TConfig): Promise<void>;
}

export class WidgetConfigError extends Error {
  readonly reason: ConfigErrorReason;
  readonly issues: readonly string[];

  constructor(reason: ConfigErrorReason, issues: readonly string[]) {
    super(`Invalid widget configuration (${reason}): ${issues.join('; ')}`);
    this.name = 'WidgetConfigError';
    this.reason = reason;
    this.issues = issues;
  }
}

export class WidgetInstanceNotFoundError extends Error {
  readonly instanceId: string;

  constructor(instanceId: string, options?: { cause?: unknown }) {
    super(`Widget instance "${instanceId}" no longer exists`, options);
    this.name = 'WidgetInstanceNotFoundError';
    this.instanceId = instanceId;
  }
}

export const WIDGET_CONTEXT = new InjectionToken<WidgetContext>('WIDGET_CONTEXT');

/**
 * The only cast of the contract: the token is untyped on TConfig (a token cannot be generic),
 * and the host guarantees that the context was built from the widget's own definition.
 */
export function injectWidgetContext<TConfig extends JsonObject>(): WidgetContext<TConfig> {
  return inject(WIDGET_CONTEXT) as unknown as WidgetContext<TConfig>;
}

/** Write port, implemented by DashboardStore; replaceable in tests. */
export interface WidgetConfigWriter {
  /** Delegates to WidgetInstanceRepository.updateConfig; propagates DataError (incl. 'not_found'). */
  saveConfig(id: string, config: JsonObject, configVersion: number): Promise<WidgetInstanceRecord>;
}

interface Waiter {
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

interface WriteJob<TConfig extends JsonObject> {
  readonly config: TConfig;
  readonly version: number;
  readonly waiters: Waiter[];
}

export function createWidgetContext<TConfig extends JsonObject>(params: {
  readonly record: WidgetInstanceRecord;
  readonly definition: WidgetDefinition<TConfig>;
  readonly initialConfig: TConfig;
  readonly size: Signal<GridSize>;
  readonly writer: WidgetConfigWriter;
}): WidgetContext<TConfig> {
  const { record, definition, writer } = params;
  const config = signal<TConfig>(params.initialConfig);
  let persisted: TConfig = params.initialConfig;
  let writing = false;
  let pending: WriteJob<TConfig> | null = null;

  const fail = (error: unknown): unknown =>
    error instanceof DataError && error.kind === 'not_found'
      ? new WidgetInstanceNotFoundError(record.id, { cause: error })
      : error;

  async function drain(first: WriteJob<TConfig>): Promise<void> {
    writing = true;
    let job: WriteJob<TConfig> | null = first;
    while (job) {
      const current: WriteJob<TConfig> = job;
      try {
        await writer.saveConfig(record.id, current.config, current.version);
        persisted = current.config;
        current.waiters.forEach((w) => w.resolve());
      } catch (error) {
        const reason = fail(error);
        current.waiters.forEach((w) => w.reject(reason));
        if (!pending) config.set(persisted);
      }
      job = pending;
      pending = null;
    }
    writing = false;
  }

  return {
    instanceId: record.id,
    type: definition.type,
    config: config.asReadonly(),
    size: params.size,
    permissions: new Set(definition.permissions),
    updateConfig(next: TConfig): Promise<void> {
      const serialized = serializeConfig(definition.config, next);
      if (!serialized.ok) {
        return Promise.reject(new WidgetConfigError(serialized.reason, serialized.issues));
      }
      config.set(serialized.config);
      return new Promise<void>((resolve, reject) => {
        const waiter: Waiter = { resolve, reject };
        if (writing) {
          pending = {
            config: serialized.config,
            version: serialized.version,
            waiters: [...(pending?.waiters ?? []), waiter],
          };
        } else {
          void drain({
            config: serialized.config,
            version: serialized.version,
            waiters: [waiter],
          });
        }
      });
    },
  };
}
