import { invoke, isTauri } from '@tauri-apps/api/core';
import { TauriTodoRepository } from './tauri-todo.repository';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }));

const LIST = {
  id: 'l1',
  widgetInstanceId: 'w1',
  name: 'Tasks',
  createdAt: '2026-11-25T10:00:00.000Z',
  updatedAt: '2026-11-25T10:00:00.000Z',
};
const TODO = {
  id: 't1',
  listId: 'l1',
  title: 'Do it',
  description: '',
  dueOn: '2026-11-26',
  rrule: null,
  important: false,
  completedAt: null,
  sortOrder: 0,
  createdAt: '2026-11-25T10:00:00.000Z',
  updatedAt: '2026-11-25T10:00:00.000Z',
};

describe('TauriTodoRepository', () => {
  let repo: TauriTodoRepository;

  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(TODO);
    vi.mocked(isTauri).mockReturnValue(true);
    repo = new TauriTodoRepository(() => 'gen-1');
  });

  it('getListForInstance maps the DTO, null when absent', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(LIST);
    await expect(repo.getListForInstance('w1')).resolves.toEqual(LIST);
    expect(invoke).toHaveBeenCalledWith('todo_list_for_widget', { widgetInstanceId: 'w1' });
    vi.mocked(invoke).mockResolvedValueOnce(null);
    await expect(repo.getListForInstance('w2')).resolves.toBeNull();
  });

  it('createList defaults id and owner', async () => {
    vi.mocked(invoke).mockResolvedValue(LIST);
    await repo.createList({ name: 'Tasks' });
    expect(invoke).toHaveBeenCalledWith('todo_list_create', {
      input: { id: 'gen-1', widgetInstanceId: null, name: 'Tasks' },
    });
    await repo.createList({ id: 'x', widgetInstanceId: 'w1', name: 'N' });
    expect(invoke).toHaveBeenLastCalledWith('todo_list_create', {
      input: { id: 'x', widgetInstanceId: 'w1', name: 'N' },
    });
  });

  it('listTodos maps the DTOs', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([TODO]);
    await expect(repo.listTodos('l1')).resolves.toEqual([TODO]);
    expect(invoke).toHaveBeenCalledWith('todo_list_items', { listId: 'l1' });
  });

  it('create defaults id and dueOn, and sends no extra field', async () => {
    await expect(repo.create({ listId: 'l1', title: 'Do it' })).resolves.toEqual(TODO);
    expect(invoke).toHaveBeenCalledWith('todo_create', {
      input: { id: 'gen-1', listId: 'l1', title: 'Do it', dueOn: null },
    });
    await repo.create({ id: 'x', listId: 'l1', title: 'a', dueOn: '2026-12-01' });
    expect(invoke).toHaveBeenLastCalledWith('todo_create', {
      input: { id: 'x', listId: 'l1', title: 'a', dueOn: '2026-12-01' },
    });
  });

  it('update sends only the defined keys', async () => {
    await repo.update('t1', { title: 'New' });
    expect(invoke).toHaveBeenLastCalledWith('todo_update', { id: 't1', changes: { title: 'New' } });
    await repo.update('t1', {});
    expect(invoke).toHaveBeenLastCalledWith('todo_update', { id: 't1', changes: {} });
    await repo.update('t1', {
      title: 'a',
      dueOn: '2026-12-01',
      description: '',
      rrule: 'FREQ=DAILY',
      important: false,
    });
    expect(invoke).toHaveBeenLastCalledWith('todo_update', {
      id: 't1',
      changes: {
        title: 'a',
        dueOn: '2026-12-01',
        description: '',
        rrule: 'FREQ=DAILY',
        important: false,
      },
    });
  });

  it('update keeps an explicit null (clear) and drops undefined', async () => {
    await repo.update('t1', { dueOn: null, rrule: null, title: undefined });
    const args = vi.mocked(invoke).mock.calls.at(-1)?.[1] as { changes: object };
    expect(args.changes).toEqual({ dueOn: null, rrule: null });
    expect(Object.keys(args.changes)).toEqual(['dueOn', 'rrule']);
  });

  it('shiftRepeatDue, setCompleted, remove, clearCompleted', async () => {
    await repo.shiftRepeatDue('t1', '2026-11-26', '2026-11-27');
    expect(invoke).toHaveBeenLastCalledWith('todo_shift_repeat_due', {
      id: 't1',
      fromDueOn: '2026-11-26',
      toDueOn: '2026-11-27',
    });
    await repo.setCompleted('t1', true);
    expect(invoke).toHaveBeenLastCalledWith('todo_set_completed', { id: 't1', completed: true });
    vi.mocked(invoke).mockResolvedValueOnce(true);
    await expect(repo.remove('t1')).resolves.toBe(true);
    expect(invoke).toHaveBeenLastCalledWith('todo_delete', { id: 't1' });
    vi.mocked(invoke).mockResolvedValueOnce(3);
    await expect(repo.clearCompleted('l1')).resolves.toBe(3);
    expect(invoke).toHaveBeenLastCalledWith('todo_clear_completed', { listId: 'l1' });
  });

  it('listDue, listOverdueBefore, listRepeatingDueBy', async () => {
    vi.mocked(invoke).mockResolvedValue([TODO]);
    await expect(repo.listDue({ fromOn: '2026-11-01', toOn: '2026-11-30' }, 50)).resolves.toEqual([
      TODO,
    ]);
    expect(invoke).toHaveBeenLastCalledWith('todo_due', {
      fromOn: '2026-11-01',
      toOn: '2026-11-30',
      limit: 50,
    });
    await repo.listOverdueBefore('2026-11-25', 10);
    expect(invoke).toHaveBeenLastCalledWith('todo_overdue', { beforeOn: '2026-11-25', limit: 10 });
    await repo.listRepeatingDueBy('2026-12-31', 20);
    expect(invoke).toHaveBeenLastCalledWith('todo_repeating_due', {
      toOn: '2026-12-31',
      limit: 20,
    });
  });

  it('reorder sends a copy of the ids', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null);
    await expect(repo.reorder('l1', ['b', 'a'])).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith('todo_reorder', { listId: 'l1', ids: ['b', 'a'] });
  });

  it('search computes the excerpt from the description', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      {
        id: 't1',
        title: 'T',
        description: 'buy  milk\nnow',
        listId: 'l1',
        widgetInstanceId: 'w1',
        completedAt: '2026-11-25T10:00:00.000Z',
      },
      {
        id: 't2',
        title: 'milk',
        description: '',
        listId: 'l1',
        widgetInstanceId: null,
        completedAt: null,
      },
    ]);
    await expect(repo.search(' milk ', 4)).resolves.toEqual([
      {
        id: 't1',
        title: 'T',
        listId: 'l1',
        widgetInstanceId: 'w1',
        completedAt: '2026-11-25T10:00:00.000Z',
        excerpt: 'buy milk now',
      },
      {
        id: 't2',
        title: 'milk',
        listId: 'l1',
        widgetInstanceId: null,
        completedAt: null,
        excerpt: '',
      },
    ]);
    expect(invoke).toHaveBeenCalledWith('todo_search', { query: ' milk ', limit: 4 });
  });

  it('maps Rust errors and rejected arguments', async () => {
    vi.mocked(invoke).mockRejectedValueOnce({ kind: 'conflict' });
    await expect(repo.shiftRepeatDue('t1', 'a', 'b')).rejects.toMatchObject({ kind: 'conflict' });
    vi.mocked(invoke).mockRejectedValueOnce('invalid args `limit` for command `todo_due`: x');
    await expect(
      repo.listDue({ fromOn: '2026-11-01', toOn: '2026-11-30' }, -1),
    ).rejects.toMatchObject({ kind: 'invalid_input' });
  });

  it('is unavailable outside Tauri, without a call', async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    await expect(repo.listTodos('l1')).rejects.toMatchObject({ kind: 'unavailable' });
    expect(invoke).not.toHaveBeenCalled();
  });
});
