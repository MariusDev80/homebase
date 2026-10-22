import type { TranslocoService } from '@jsverse/transloco';
import type { BackupErrorDto, ImportIssue } from './backup.types';

/** `io` codes with their own message (the other codes use the generic one). */
const SPECIFIC_IO_CODES: ReadonlySet<string> = new Set([
  'bad_extension',
  'destination_in_data_root',
  'token_mismatch',
]);

/** Common `io::ErrorKind` names sent by Rust as `code`, with a message each. */
const IO_KINDS: ReadonlySet<string> = new Set([
  'PermissionDenied',
  'NotFound',
  'AlreadyExists',
  'StorageFull',
  'ReadOnlyFilesystem',
  'QuotaExceeded',
]);

/**
 * User-facing text of a BackupError: translated by `kind` (and `problem` / `code`), never a raw
 * message from Rust or from an exception.
 */
export function backupErrorText(transloco: TranslocoService, dto: BackupErrorDto): string {
  const t = (key: string, params?: Record<string, unknown>): string =>
    transloco.translate(key, params);
  switch (dto.kind) {
    case 'invalid_archive':
      return t('backup.errors.invalid_archive', {
        problem: t(`backup.archiveProblems.${dto.problem}`),
      });
    case 'invalid_import':
      return t('backup.errors.invalid_import', {
        problem: t(`backup.importProblems.${dto.problem}`),
      });
    case 'schema_too_new':
      return t('backup.errors.schema_too_new', {
        archive: dto.archive,
        supported: dto.supported,
      });
    case 'io':
      if (SPECIFIC_IO_CODES.has(dto.code)) return t(`backup.errors.${dto.code}`);
      return IO_KINDS.has(dto.code)
        ? t(`backup.errors.ioKind.${dto.code}`)
        : t('backup.errors.io', { code: dto.code });
    case 'database':
      return t('backup.errors.database', { code: dto.code });
    default:
      return t(`backup.errors.${dto.kind}`);
  }
}

/** Text of one validation issue of an imported file. */
export function importIssueText(transloco: TranslocoService, issue: ImportIssue): string {
  const message = transloco.translate(`configTransfer.issues.${issue.code}`);
  return issue.path === ''
    ? message
    : transloco.translate('configTransfer.issueAt', { message, path: issue.path });
}
