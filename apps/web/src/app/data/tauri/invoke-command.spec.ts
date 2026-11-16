import { invoke, isTauri } from '@tauri-apps/api/core';
import { DataError, type DataErrorKind } from '../data-error';
import { invokeCommand } from './invoke-command';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }));

describe('invokeCommand', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(isTauri).mockReset();
    vi.mocked(isTauri).mockReturnValue(true);
  });

  it('is unavailable outside Tauri and never calls invoke', async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    await expect(invokeCommand('reminder_list')).rejects.toMatchObject({
      name: 'DataError',
      kind: 'unavailable',
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('forwards the command name and arguments and returns the result', async () => {
    vi.mocked(invoke).mockResolvedValue([1]);
    await expect(invokeCommand('reminder_unseen_deliveries', { limit: 5 })).resolves.toEqual([1]);
    expect(invoke).toHaveBeenCalledWith('reminder_unseen_deliveries', { limit: 5 });
  });

  it.each<[unknown, DataErrorKind]>([
    [{ kind: 'invalid_input', field: 'title' }, 'invalid_input'],
    [{ kind: 'time', error: { kind: 'invalid_range' } }, 'invalid_input'],
    [{ kind: 'not_found' }, 'not_found'],
    [{ kind: 'conflict' }, 'conflict'],
    [{ kind: 'already_running' }, 'conflict'],
    [{ kind: 'limit_reached' }, 'forbidden'],
    [{ kind: 'busy' }, 'busy'],
    [{ kind: 'database' }, 'unknown'],
    [{ kind: 'something_else' }, 'unknown'],
    ['plain string', 'unknown'],
    [null, 'unknown'],
  ])('translates %j to %s and keeps the Rust error as cause', async (rustError, expected) => {
    vi.mocked(invoke).mockRejectedValue(rustError);
    const error = await invokeCommand('session_stop', { id: 'x' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DataError);
    expect((error as DataError).kind).toBe(expected);
    expect((error as DataError).cause).toBe(rustError);
  });
});
