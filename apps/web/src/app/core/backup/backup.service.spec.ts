import { TestBed } from '@angular/core/testing';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { BackupError, BackupService, isBackupError, toBackupError } from './backup.service';
import type { BackupErrorDto, ConfigImportPlan } from './backup.types';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));

const info = {
  id: 'homebase-20261022T080000.000Z-manual.zip',
  kind: 'manual',
  createdAt: '2026-10-22T08:00:00.000Z',
  sizeBytes: 1234,
  includesImages: true,
  schemaVersion: 25,
  appVersion: '0.1.0',
  imageCount: 2,
  damaged: false,
};
const damaged = {
  ...info,
  includesImages: null,
  schemaVersion: null,
  appVersion: null,
  imageCount: null,
  damaged: true,
};
const overview = {
  backups: [info, damaged],
  status: {
    lastRestore: {
      outcome: 'rolled-back',
      at: '2026-10-22T08:00:00.000Z',
      backupCreatedAt: null,
      backupKind: 'pre-restore',
    },
    dbMissingAlert: false,
    preMigrationFailed: true,
    lastAutoError: { kind: 'disk_full' },
    rawSafetyCopies: ['homebase-20261021T081500.123Z-pre-restore-raw'],
  },
  supportedSchemaVersion: 25,
};
const summary = {
  kind: 'daily',
  createdAt: '2026-10-22T08:00:00.000Z',
  sizeBytes: 99,
  includesImages: false,
  schemaVersion: 25,
  appVersion: '0.1.0',
  imageCount: 0,
  token: 'ab'.repeat(32),
};
const plan: ConfigImportPlan = {
  dashboards: [
    {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Accueil',
      sortOrder: 0,
      widgets: [
        {
          id: '00000000-0000-4000-8000-000000000002',
          widgetType: 'hello',
          grid: { x: 0, y: 0, w: 3, h: 2 },
          config: '{"name":"monde"}',
          configVersion: 1,
        },
      ],
    },
  ],
  settings: [{ key: 'theme', value: '"dark"' }],
};

describe('BackupService', () => {
  const invokeMock = vi.mocked(invoke);
  const isTauriMock = vi.mocked(isTauri);
  let service: BackupService;

  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
    service = TestBed.inject(BackupService);
  });

  async function rejection(promise: Promise<unknown>): Promise<BackupError> {
    try {
      await promise;
    } catch (error) {
      if (isBackupError(error)) return error;
      throw error;
    }
    throw new Error('expected a rejection');
  }

  /** The 10 methods that call a command, with the command, arguments and a valid answer. */
  const calls: readonly {
    name: string;
    run: (s: BackupService) => Promise<unknown>;
    command: string;
    args: Record<string, unknown> | undefined;
    answer: unknown;
    result: unknown;
  }[] = [
    {
      name: 'overview',
      run: (s) => s.overview(),
      command: 'backup_list',
      args: undefined,
      answer: overview,
      result: overview,
    },
    {
      name: 'create',
      run: (s) => s.create(),
      command: 'backup_create',
      args: undefined,
      answer: info,
      result: info,
    },
    {
      name: 'openFolder',
      run: (s) => s.openFolder(),
      command: 'backup_open_folder',
      args: undefined,
      answer: null,
      result: undefined,
    },
    {
      name: 'exportArchive',
      run: (s) => s.exportArchive(info.id),
      command: 'backup_export',
      args: { id: info.id },
      answer: true,
      result: true,
    },
    {
      name: 'pickExternal',
      run: (s) => s.pickExternal(),
      command: 'backup_pick_external',
      args: undefined,
      answer: summary,
      result: summary,
    },
    {
      name: 'restore internal',
      run: (s) => s.restore({ kind: 'internal', id: info.id }),
      command: 'backup_restore',
      args: { source: { kind: 'internal', id: info.id } },
      answer: null,
      result: undefined,
    },
    {
      name: 'restore external',
      run: (s) => s.restore({ kind: 'external', token: summary.token }),
      command: 'backup_restore',
      args: { source: { kind: 'external', token: summary.token } },
      answer: null,
      result: undefined,
    },
    {
      name: 'acknowledge',
      run: (s) => s.acknowledge(),
      command: 'backup_acknowledge',
      args: undefined,
      answer: null,
      result: undefined,
    },
    {
      name: 'saveConfigFile',
      run: (s) => s.saveConfigFile('{"a":1}'),
      command: 'config_export_save',
      args: { contents: '{"a":1}' },
      answer: true,
      result: true,
    },
    {
      name: 'pickConfigFile',
      run: (s) => s.pickConfigFile(),
      command: 'config_import_pick',
      args: undefined,
      answer: '{"x":1}',
      result: '{"x":1}',
    },
    {
      name: 'applyConfigImport',
      run: (s) => s.applyConfigImport(plan),
      command: 'config_import_apply',
      args: { plan },
      answer: { dashboards: 1, widgets: 1, settings: 1 },
      result: { dashboards: 1, widgets: 1, settings: 1 },
    },
  ];

  describe('outside Tauri', () => {
    beforeEach(() => isTauriMock.mockReturnValue(false));

    it('reports unavailable and calls nothing', () => {
      expect(service.isAvailable()).toBe(false);
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it.each(calls)('$name rejects with unavailable without invoking', async ({ run }) => {
      const error = await rejection(run(service));
      expect(error.dto).toEqual({ kind: 'unavailable' });
      expect(error.kind).toBe('unavailable');
      expect(invokeMock).not.toHaveBeenCalled();
    });
  });

  describe('inside Tauri', () => {
    beforeEach(() => isTauriMock.mockReturnValue(true));

    it('reports available', () => {
      expect(service.isAvailable()).toBe(true);
    });

    it.each(calls)('$name invokes the exact command and arguments', async (c) => {
      invokeMock.mockResolvedValue(c.answer);
      await expect(c.run(service)).resolves.toEqual(c.result);
      expect(invokeMock).toHaveBeenCalledTimes(1);
      expect(invokeMock).toHaveBeenCalledWith(c.command, c.args);
    });

    it('returns the cancellation values of the dialogs', async () => {
      invokeMock.mockResolvedValueOnce(false);
      await expect(service.exportArchive('x')).resolves.toBe(false);
      invokeMock.mockResolvedValueOnce(null);
      await expect(service.pickExternal()).resolves.toBeNull();
      invokeMock.mockResolvedValueOnce(false);
      await expect(service.saveConfigFile('{}')).resolves.toBe(false);
      invokeMock.mockResolvedValueOnce(null);
      await expect(service.pickConfigFile()).resolves.toBeNull();
    });

    it('does not forward anything but the documented arguments for an external restore', async () => {
      invokeMock.mockResolvedValue(null);
      await service.restore({ kind: 'external', token: 'abc', id: 'ignored' } as never);
      expect(invokeMock).toHaveBeenCalledWith('backup_restore', {
        source: { kind: 'external', token: 'abc' },
      });
    });

    const rustErrors: readonly BackupErrorDto[] = [
      { kind: 'busy' },
      { kind: 'restart_pending' },
      { kind: 'not_found' },
      { kind: 'invalid_id' },
      { kind: 'no_database' },
      { kind: 'too_large' },
      { kind: 'disk_full' },
      { kind: 'invalid_archive', problem: 'checksum_mismatch' },
      { kind: 'schema_too_new', archive: 26, supported: 25 },
      { kind: 'invalid_import', problem: 'secret_setting' },
      { kind: 'invalid_import', problem: 'not_utf8' },
      { kind: 'invalid_import', problem: 'constraint' },
      { kind: 'io', code: 'token_mismatch' },
      { kind: 'io', code: 'destination_in_data_root' },
      { kind: 'database', code: '1555' },
    ];

    it.each(rustErrors)('propagates the Rust error %j', async (dto) => {
      invokeMock.mockRejectedValue(dto);
      const error = await rejection(service.create());
      expect(error.dto).toEqual(dto);
      expect(error.kind).toBe(dto.kind);
      expect(error).toBeInstanceOf(Error);
    });

    it('maps every kind of the import commands', async () => {
      invokeMock.mockRejectedValue({ kind: 'busy' });
      expect((await rejection(service.applyConfigImport(plan))).kind).toBe('busy');
      invokeMock.mockRejectedValue({ kind: 'restart_pending' });
      expect((await rejection(service.applyConfigImport(plan))).kind).toBe('restart_pending');
      invokeMock.mockRejectedValue({ kind: 'invalid_import', problem: 'constraint' });
      expect((await rejection(service.applyConfigImport(plan))).dto).toEqual({
        kind: 'invalid_import',
        problem: 'constraint',
      });
      invokeMock.mockRejectedValue({ kind: 'no_database' });
      expect((await rejection(service.applyConfigImport(plan))).kind).toBe('no_database');
      invokeMock.mockRejectedValue({ kind: 'database', code: '5' });
      expect((await rejection(service.applyConfigImport(plan))).dto).toEqual({ kind: 'busy' });
      invokeMock.mockRejectedValue({ kind: 'database', code: '261' });
      expect((await rejection(service.applyConfigImport(plan))).dto).toEqual({ kind: 'busy' });
    });

    it('maps the raw serde string to a generic error without exposing its text', async () => {
      const raw =
        'invalid args `plan` for command `config_import_apply`: unknown field `x` at C:\\secret\\path';
      invokeMock.mockRejectedValue(raw);
      const error = await rejection(service.applyConfigImport(plan));
      expect(error.dto).toEqual({ kind: 'unknown' });
      expect(error.message).not.toContain('secret');
      expect(error.message).not.toContain('plan');
      expect(JSON.stringify(error.dto)).not.toContain('C:');
    });

    it('maps any other failure to unknown', async () => {
      for (const failure of [new Error('boom'), 42, null, undefined, {}, { kind: 'nope' }]) {
        invokeMock.mockRejectedValue(failure);
        expect((await rejection(service.acknowledge())).dto).toEqual({ kind: 'unknown' });
      }
      // Right tag, wrong payload.
      invokeMock.mockRejectedValue({ kind: 'invalid_archive', problem: 'not_a_problem' });
      expect((await rejection(service.pickExternal())).dto).toEqual({ kind: 'unknown' });
      invokeMock.mockRejectedValue({ kind: 'io' });
      expect((await rejection(service.pickExternal())).dto).toEqual({ kind: 'unknown' });
    });

    it('turns a SQLite busy automatic-backup error into busy', async () => {
      const status = { ...overview.status, lastAutoError: { kind: 'database', code: '5' } };
      invokeMock.mockResolvedValue({ ...overview, status });
      expect((await service.overview()).status.lastAutoError).toEqual({ kind: 'busy' });
    });

    it('refuses a raw safety copy name that is not a strict folder name', async () => {
      for (const bad of ['C:\\backups\\homebase-20261021T081500.123Z-pre-restore-raw', '..', 'x']) {
        const status = { ...overview.status, rawSafetyCopies: [bad] };
        invokeMock.mockResolvedValue({ ...overview, status });
        expect((await rejection(service.overview())).dto).toEqual({ kind: 'unknown' });
      }
      invokeMock.mockResolvedValue(overview);
      expect((await service.overview()).status.rawSafetyCopies).toEqual([
        'homebase-20261021T081500.123Z-pre-restore-raw',
      ]);
    });

    it('refuses a malformed token or application version', async () => {
      const external = {
        kind: 'daily',
        createdAt: '2026-10-21T10:00:00.000Z',
        sizeBytes: 1,
        includesImages: false,
        schemaVersion: 4,
        appVersion: '0.1.0',
        imageCount: 0,
        token: 'ab'.repeat(32),
      };
      for (const bad of [{ token: 'ABC' }, { token: 'ab'.repeat(33) }, { appVersion: '<b>' }]) {
        invokeMock.mockResolvedValue({ ...external, ...bad });
        expect((await rejection(service.pickExternal())).dto).toEqual({ kind: 'unknown' });
      }
      invokeMock.mockResolvedValue({ ...external, appVersion: '1.2.3-beta+4' });
      await expect(service.pickExternal()).resolves.toMatchObject({ appVersion: '1.2.3-beta+4' });
    });

    it('rejects with unknown when the answer does not have the expected shape', async () => {
      invokeMock.mockResolvedValue({ backups: 'nope' });
      expect((await rejection(service.overview())).dto).toEqual({ kind: 'unknown' });
      invokeMock.mockResolvedValue('yes');
      expect((await rejection(service.exportArchive('x'))).dto).toEqual({ kind: 'unknown' });
      invokeMock.mockResolvedValue({ dashboards: 1 });
      expect((await rejection(service.applyConfigImport(plan))).dto).toEqual({ kind: 'unknown' });
    });
  });
});

describe('toBackupError / isBackupError', () => {
  it('keeps a BackupError as is and recognises it', () => {
    const error = new BackupError({ kind: 'busy' });
    expect(toBackupError(error)).toBe(error);
    expect(isBackupError(error)).toBe(true);
    expect(isBackupError({ kind: 'busy' })).toBe(false);
    expect(isBackupError(new Error('x'))).toBe(false);
  });

  it('converts a Rust payload', () => {
    expect(toBackupError({ kind: 'database', code: '1555' }).dto).toEqual({
      kind: 'database',
      code: '1555',
    });
    expect(toBackupError({ kind: 'database', code: '5' }).dto).toEqual({ kind: 'busy' });
    expect(toBackupError({ kind: 'database', code: '517' }).dto).toEqual({ kind: 'busy' });
    expect(toBackupError({ kind: 'database', code: 'other' }).dto).toEqual({
      kind: 'database',
      code: 'other',
    });
    expect(toBackupError('plain string').dto).toEqual({ kind: 'unknown' });
  });
});
