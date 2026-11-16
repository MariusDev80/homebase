import type { IdGenerator } from '../clock';
import { DataError } from '../data-error';
import type { TimeSession, TimeSessionKind } from '../models';
import type { InstantIso } from '../time-formats';
import type { TimeSessionRepository } from '../repositories';
import { invokeCommand } from './invoke-command';

/** TimeSessionRepository over the `session_*` Rust commands. */
export class TauriTimeSessionRepository implements TimeSessionRepository {
  constructor(private readonly newId: IdGenerator) {}

  listRunning(): Promise<TimeSession[]> {
    return invokeCommand<TimeSession[]>('session_list_running');
  }

  history(page: {
    readonly before?: { readonly startedAt: InstantIso; readonly id: string };
    readonly limit: number;
  }): Promise<TimeSession[]> {
    const before = page.before ? { startedAt: page.before.startedAt, id: page.before.id } : null;
    return invokeCommand<TimeSession[]>('session_history', { before, limit: page.limit });
  }

  start(input: {
    readonly id?: string;
    readonly kind: TimeSessionKind;
    readonly label: string;
    readonly durationMs: number | null;
  }): Promise<TimeSession> {
    if (input.durationMs !== null && !Number.isSafeInteger(input.durationMs)) {
      // Same shape as the Rust error, so that commandErrorDetails reads it too.
      return Promise.reject(
        new DataError('invalid_input', 'durationMs must be a safe integer', {
          cause: { kind: 'invalid_input', field: 'durationMs' },
        }),
      );
    }
    return invokeCommand<TimeSession>('session_start', {
      input: {
        id: input.id ?? this.newId(),
        kind: input.kind,
        label: input.label,
        durationMs: input.durationMs,
      },
    });
  }

  stop(id: string): Promise<TimeSession> {
    return invokeCommand<TimeSession>('session_stop', { id });
  }

  rename(id: string, label: string): Promise<TimeSession> {
    return invokeCommand<TimeSession>('session_rename', { id, label });
  }

  remove(id: string): Promise<boolean> {
    return invokeCommand<boolean>('session_delete', { id });
  }
}
