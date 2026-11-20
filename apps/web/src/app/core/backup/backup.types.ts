/**
 * DTO of the backup commands (spec backup-restore 4.11 to 4.13). They mirror the Rust
 * `serde(rename_all = "camelCase")` structures; `backup.service.ts` validates every answer.
 */

export const BACKUP_KINDS = [
  'manual',
  'daily',
  'pre-migration',
  'pre-restore',
  'pre-import',
  'pre-delete',
] as const;
export type BackupKind = (typeof BACKUP_KINDS)[number];

export interface BackupInfo {
  readonly id: string;
  readonly kind: BackupKind;
  readonly createdAt: string;
  readonly sizeBytes: number;
  readonly includesImages: boolean | null;
  readonly schemaVersion: number | null;
  readonly appVersion: string | null;
  readonly imageCount: number | null;
  readonly damaged: boolean;
}

export interface ArchiveSummary {
  readonly kind: BackupKind;
  readonly createdAt: string;
  readonly sizeBytes: number;
  readonly includesImages: boolean;
  readonly schemaVersion: number;
  readonly appVersion: string;
  readonly imageCount: number;
  /** SHA-256 (hex) of the prepared copy; to be sent back in `restore({ kind: 'external', token })`. */
  readonly token: string;
}

export const RESTORE_OUTCOMES = ['applied', 'rolled-back', 'failed'] as const;
export type RestoreOutcome = (typeof RESTORE_OUTCOMES)[number];

export interface RestoreReport {
  readonly outcome: RestoreOutcome;
  readonly at: string;
  readonly backupCreatedAt: string | null;
  readonly backupKind: BackupKind | null;
}

export interface BackupStatus {
  readonly lastRestore: RestoreReport | null;
  readonly dbMissingAlert: boolean;
  readonly preMigrationFailed: boolean;
  readonly lastAutoError: BackupErrorDto | null;
  /** Names (never paths) of the raw safety copy folders, newest first. */
  readonly rawSafetyCopies: readonly string[];
}

export interface BackupOverview {
  readonly backups: readonly BackupInfo[];
  readonly status: BackupStatus;
  readonly supportedSchemaVersion: number;
}

export type RestoreSource =
  | { readonly kind: 'internal'; readonly id: string }
  | { readonly kind: 'external'; readonly token: string };

export const ARCHIVE_PROBLEMS = [
  'not_zip',
  'zip64',
  'too_many_entries',
  'overlapping_entries',
  'unexpected_entry',
  'duplicate_entry',
  'encrypted_entry',
  'unsupported_compression',
  'entry_too_large',
  'total_too_large',
  'missing_manifest',
  'missing_database',
  'invalid_manifest',
  'unsupported_format',
  'manifest_mismatch',
  'size_mismatch',
  'checksum_mismatch',
  'corrupt_entry',
  'image_type_mismatch',
  'not_sqlite',
  'integrity_failed',
  'not_homebase',
  'unexpected_schema',
  'dirty_migration',
  'unknown_migration',
  'foreign_key_violation',
] as const;
export type ArchiveProblem = (typeof ARCHIVE_PROBLEMS)[number];

export const IMPORT_PROBLEMS = [
  'not_config',
  'not_utf8',
  'no_dashboard',
  'too_many_dashboards',
  'too_many_widgets',
  'too_many_settings',
  'invalid_id',
  'duplicate_id',
  'invalid_name',
  'invalid_icon',
  'invalid_theme',
  'invalid_widget_type',
  'invalid_grid',
  'invalid_sort_order',
  'invalid_config',
  'invalid_config_version',
  'invalid_setting_key',
  'secret_setting',
  'invalid_setting_value',
  'constraint',
] as const;
export type ImportProblem = (typeof IMPORT_PROBLEMS)[number];

/**
 * Error payload of the Rust commands (`BackupError`, snake_case tag). `unavailable` (outside
 * Tauri) and `unknown` (any payload that is not a `BackupError`, e.g. the plain string Tauri
 * returns when the arguments of a command do not deserialize) exist on the front only.
 */
export type BackupErrorDto =
  | { readonly kind: 'busy' }
  | { readonly kind: 'restart_pending' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'last_dashboard' }
  | { readonly kind: 'invalid_id' }
  | { readonly kind: 'no_database' }
  | { readonly kind: 'too_large' }
  | { readonly kind: 'disk_full' }
  | { readonly kind: 'invalid_archive'; readonly problem: ArchiveProblem }
  | { readonly kind: 'schema_too_new'; readonly archive: number; readonly supported: number }
  | { readonly kind: 'invalid_import'; readonly problem: ImportProblem }
  | { readonly kind: 'io'; readonly code: string }
  | { readonly kind: 'database'; readonly code: string }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'unknown' };

export type BackupErrorKind = BackupErrorDto['kind'];

/** Plan sent to `config_import_apply` (spec 4.12; `deny_unknown_fields` on the Rust side). */
export interface ConfigImportPlan {
  readonly dashboards: readonly ConfigImportPlanDashboard[];
  readonly settings: readonly ConfigImportPlanSetting[];
}

export interface ConfigImportPlanDashboard {
  readonly id: string;
  readonly name: string;
  readonly sortOrder: number;
  readonly icon: string;
  /** Serialized JSON object (opaque for Rust, validated by the front). */
  readonly theme: string;
  readonly themeVersion: number;
  readonly widgets: readonly ConfigImportPlanWidget[];
}

export interface ConfigImportPlanWidget {
  readonly id: string;
  readonly widgetType: string;
  readonly grid: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** Serialized JSON object. */
  readonly config: string;
  readonly configVersion: number;
}

export interface ConfigImportPlanSetting {
  readonly key: string;
  /** Serialized JSON value. */
  readonly value: string;
}

/** Rows written by `config_import_apply`. */
export interface ImportOutcome {
  readonly dashboards: number;
  readonly widgets: number;
  readonly settings: number;
}

export interface ImportPreview {
  /** Content of the file. */
  readonly dashboards: number;
  readonly widgets: number;
  readonly settings: number;
  readonly unknownTypes: readonly string[];
  readonly futureVersions: number;
  /** The file predates themes (format 1 or 2): every dashboard gets the default theme. */
  readonly resetsThemes: boolean;
  /** The file predates dashboard icons (format 1): every dashboard gets the default icon. */
  readonly resetsIcons: boolean;
  /** Current dashboards absent from the file. */
  readonly removedDashboards: number;
  /** Current instances absent from the file (including those of removed dashboards). */
  readonly removedWidgets: number;
  /** Present on both sides with a different `widgetType` (deleted, then recreated). */
  readonly replacedWidgets: number;
}

export const IMPORT_ISSUE_CODES = [
  'too_large',
  'invalid_json',
  'unknown_field',
  'missing_field',
  'invalid_value',
  'unsupported_version',
  'no_dashboard',
  'too_many',
  'invalid_id',
  'duplicate_id',
  'invalid_name',
  'invalid_config',
  'max_instances',
  'secret_setting',
  'invalid_setting_key',
  'invalid_setting_value',
] as const;
export type ImportIssueCode = (typeof IMPORT_ISSUE_CODES)[number];

export interface ImportIssue {
  readonly code: ImportIssueCode;
  /** e.g. `dashboards[0].widgets[1].config`; empty for the file itself. */
  readonly path: string;
}
