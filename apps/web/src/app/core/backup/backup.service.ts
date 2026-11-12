import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import * as v from 'valibot';
import { isTauriRuntime } from '../../tauri-runtime';
import { RAW_SAFETY_COPY_PATTERN } from './raw-safety-copy';
import {
  ARCHIVE_PROBLEMS,
  BACKUP_KINDS,
  IMPORT_PROBLEMS,
  RESTORE_OUTCOMES,
  type ArchiveSummary,
  type BackupErrorDto,
  type BackupInfo,
  type BackupOverview,
  type ConfigImportPlan,
  type ImportOutcome,
  type RestoreSource,
} from './backup.types';

const count = v.pipe(v.number(), v.integer(), v.minValue(0));

const rustErrorSchema = v.variant('kind', [
  v.object({ kind: v.literal('busy') }),
  v.object({ kind: v.literal('restart_pending') }),
  v.object({ kind: v.literal('not_found') }),
  v.object({ kind: v.literal('last_dashboard') }),
  v.object({ kind: v.literal('invalid_id') }),
  v.object({ kind: v.literal('no_database') }),
  v.object({ kind: v.literal('too_large') }),
  v.object({ kind: v.literal('disk_full') }),
  v.object({ kind: v.literal('invalid_archive'), problem: v.picklist(ARCHIVE_PROBLEMS) }),
  v.object({ kind: v.literal('schema_too_new'), archive: v.number(), supported: v.number() }),
  v.object({ kind: v.literal('invalid_import'), problem: v.picklist(IMPORT_PROBLEMS) }),
  v.object({ kind: v.literal('io'), code: v.pipe(v.string(), v.maxLength(64)) }),
  v.object({ kind: v.literal('database'), code: v.pipe(v.string(), v.maxLength(64)) }),
]);

const kindSchema = v.picklist(BACKUP_KINDS);

// Same pattern as the Rust side (`[A-Za-z0-9.+-]{1,64}`).
const appVersion = v.pipe(v.string(), v.regex(/^[A-Za-z0-9.+-]{1,64}$/));

const backupInfoSchema = v.object({
  id: v.string(),
  kind: kindSchema,
  createdAt: v.string(),
  sizeBytes: count,
  includesImages: v.nullable(v.boolean()),
  schemaVersion: v.nullable(v.number()),
  appVersion: v.nullable(appVersion),
  imageCount: v.nullable(count),
  damaged: v.boolean(),
});

const archiveSummarySchema = v.object({
  kind: kindSchema,
  createdAt: v.string(),
  sizeBytes: count,
  includesImages: v.boolean(),
  schemaVersion: v.number(),
  appVersion,
  imageCount: count,
  token: v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/)),
});

const overviewSchema = v.object({
  backups: v.array(backupInfoSchema),
  status: v.object({
    lastRestore: v.nullable(
      v.object({
        outcome: v.picklist(RESTORE_OUTCOMES),
        at: v.string(),
        backupCreatedAt: v.nullable(v.string()),
        backupKind: v.nullable(kindSchema),
      }),
    ),
    dbMissingAlert: v.boolean(),
    rawSafetyCopies: v.pipe(
      v.array(v.pipe(v.string(), v.regex(RAW_SAFETY_COPY_PATTERN))),
      v.maxLength(20),
    ),
    preMigrationFailed: v.boolean(),
    lastAutoError: v.nullable(
      v.pipe(
        rustErrorSchema,
        v.transform((dto) => (isSqliteBusy(dto) ? ({ kind: 'busy' } as const) : dto)),
      ),
    ),
  }),
  supportedSchemaVersion: v.number(),
});

// `()` is serialized as null by Tauri.
const voidSchema = v.nullish(v.null());

const outcomeSchema = v.object({ dashboards: count, widgets: count, settings: count });

/** What every method of BackupService rejects with. `dto` is safe to show: no path, no text. */
export class BackupError extends Error {
  readonly dto: BackupErrorDto;

  constructor(dto: BackupErrorDto) {
    super(`Backup operation failed (${dto.kind})`);
    this.name = 'BackupError';
    this.dto = dto;
  }

  get kind(): BackupErrorDto['kind'] {
    return this.dto.kind;
  }
}

export function isBackupError(error: unknown): error is BackupError {
  return error instanceof BackupError;
}

/** SQLITE_BUSY is primary code 5 (extended codes keep it in the low byte). */
function isSqliteBusy(dto: BackupErrorDto): boolean {
  if (dto.kind !== 'database' || !/^[0-9]{1,6}$/.test(dto.code)) return false;
  return (Number(dto.code) & 0xff) === 5;
}

/**
 * A BackupError as is; a payload with the Rust `BackupError` shape becomes one; anything else
 * (`database` with SQLITE_BUSY becomes `busy`; including the raw string Tauri returns when the arguments do not deserialize, or an answer
 * that does not have the expected shape) becomes `unknown`, without exposing any text.
 */
export function toBackupError(error: unknown): BackupError {
  if (error instanceof BackupError) return error;
  const parsed = v.safeParse(rustErrorSchema, error);
  if (!parsed.success) return new BackupError({ kind: 'unknown' });
  return new BackupError(isSqliteBusy(parsed.output) ? { kind: 'busy' } : parsed.output);
}

/**
 * The only gateway to the backup commands (spec backup-restore 4.11) and the only file of
 * `core/backup` importing `@tauri-apps/api/core`. Outside Tauri every method rejects with
 * `unavailable` without calling `invoke`.
 */
@Injectable({ providedIn: 'root' })
export class BackupService {
  /** True when the commands exist (inside the desktop shell). Calls nothing. */
  isAvailable(): boolean {
    return isTauriRuntime();
  }

  overview(): Promise<BackupOverview> {
    return this.call('backup_list', undefined, overviewSchema);
  }

  create(): Promise<BackupInfo> {
    return this.call('backup_create', undefined, backupInfoSchema);
  }

  async openFolder(): Promise<void> {
    await this.call('backup_open_folder', undefined, voidSchema);
  }

  /** `false` when the user cancels the save dialog. */
  exportArchive(id: string): Promise<boolean> {
    return this.call('backup_export', { id }, v.boolean());
  }

  /** `null` when the user cancels the open dialog. */
  pickExternal(): Promise<ArchiveSummary | null> {
    return this.call('backup_pick_external', undefined, v.nullable(archiveSummarySchema));
  }

  /** Stages the restoration; the application then restarts, so the answer may never arrive. */
  async restore(source: RestoreSource): Promise<void> {
    const payload =
      source.kind === 'internal'
        ? { kind: 'internal', id: source.id }
        : { kind: 'external', token: source.token };
    await this.call('backup_restore', { source: payload }, voidSchema);
  }

  /** Backs up (pre-delete) then deletes; refused for the last dashboard. */
  async deleteDashboard(id: string): Promise<void> {
    await this.call('dashboard_delete', { id }, voidSchema);
  }

  async acknowledge(): Promise<void> {
    await this.call('backup_acknowledge', undefined, voidSchema);
  }

  /** `false` when the user cancels the save dialog. */
  saveConfigFile(contents: string): Promise<boolean> {
    return this.call('config_export_save', { contents }, v.boolean());
  }

  /** The text of the chosen file, or `null` when the user cancels. */
  pickConfigFile(): Promise<string | null> {
    return this.call('config_import_pick', undefined, v.nullable(v.string()));
  }

  applyConfigImport(plan: ConfigImportPlan): Promise<ImportOutcome> {
    return this.call('config_import_apply', { plan }, outcomeSchema);
  }

  private async call<TSchema extends v.GenericSchema>(
    command: string,
    args: Record<string, unknown> | undefined,
    schema: TSchema,
  ): Promise<v.InferOutput<TSchema>> {
    if (!this.isAvailable()) {
      throw new BackupError({ kind: 'unavailable' });
    }
    let answer: unknown;
    try {
      answer = await invoke<unknown>(command, args);
    } catch (error) {
      throw toBackupError(error);
    }
    const parsed = v.safeParse(schema, answer);
    if (!parsed.success) {
      throw new BackupError({ kind: 'unknown' });
    }
    return parsed.output;
  }
}
