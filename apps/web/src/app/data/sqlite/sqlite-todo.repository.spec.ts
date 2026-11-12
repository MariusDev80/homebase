import { DataError } from '../data-error';
import { FixedClock, sequentialIds } from '../testing/fixed-clock';
import { createTestDatabase } from '../testing/migrations';
import { NodeSqliteExecutor } from '../testing/node-sqlite-executor';
import { SqliteDashboardRepository } from './sqlite-dashboard.repository';
import { REORDER_TODOS_SQL, SqliteTodoRepository } from './sqlite-todo.repository';
import { SqliteWidgetInstanceRepository } from './sqlite-widget-instance.repository';

const STAMP = '2026-01-01T00:00:00.000Z';
const LIST = '00000000-0000-4000-8000-0000000000aa';
const MISSING = '00000000-0000-4000-8000-0000000000ff';

async function kindOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof DataError) return e.kind;
    throw e;
  }
  return 'no error';
}

describe('V3 todos tables', () => {
  let db: NodeSqliteExecutor;
  let counter = 0;
  beforeEach(async () => {
    db = createTestDatabase();
    counter = 0;
    await db.execute(
      'INSERT INTO todo_lists (id, name, created_at, updated_at) VALUES ($1, $2, $3, $3)',
      [LIST, 'Tâches', STAMP],
    );
  });
  afterEach(() => db.close());

  const insert = (title: string, dueOn: string | null = null, completedAt: string | null = null) =>
    db.execute(
      `INSERT INTO todos (id, list_id, title, due_on, completed_at, sort_order, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 0, $6, $6)`,
      [
        `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
        LIST,
        title,
        dueOn,
        completedAt,
        STAMP,
      ],
    );

  it('accepts valid rows and NULL optional columns', async () => {
    await insert('x'.repeat(500));
    await insert('a', '2028-02-29', '2026-10-25T00:30:00.123Z');
    expect(await db.select('SELECT id FROM todos')).toHaveLength(2);
  });

  it('refuses an empty, blank or 501-character title', async () => {
    expect(await kindOf(insert(''))).toBe('constraint');
    expect(await kindOf(insert('   '))).toBe('constraint');
    expect(await kindOf(insert('x'.repeat(501)))).toBe('constraint');
  });

  it('refuses invalid due_on values', async () => {
    expect(await kindOf(insert('a', '2026-02-30'))).toBe('constraint');
    expect(await kindOf(insert('a', '2026-13-01'))).toBe('constraint');
    expect(await kindOf(insert('a', '2026-1-01'))).toBe('constraint');
    expect(await kindOf(insert('a', '2200-01-01'))).toBe('constraint');
  });

  it('refuses invalid completed_at values', async () => {
    expect(await kindOf(insert('a', null, '2026-10-25T24:00:00.000Z'))).toBe('constraint');
    expect(await kindOf(insert('a', null, '2026-02-30T00:00:00.000Z'))).toBe('constraint');
    expect(await kindOf(insert('a', null, '2026-10-20T08:15:00Z'))).toBe('constraint');
  });

  it('refuses an empty list name and an unknown list', async () => {
    expect(
      await kindOf(
        db.execute(
          'INSERT INTO todo_lists (id, name, created_at, updated_at) VALUES ($1, $2, $3, $3)',
          [MISSING, '', STAMP],
        ),
      ),
    ).toBe('constraint');
    expect(
      await kindOf(
        db.execute(
          `INSERT INTO todos (id, list_id, title, sort_order, created_at, updated_at)
           VALUES ($1, $2, 'a', 0, $3, $3)`,
          [MISSING, MISSING, STAMP],
        ),
      ),
    ).toBe('constraint');
  });
});

describe('SqliteTodoRepository', () => {
  let db: NodeSqliteExecutor;
  let clock: FixedClock;
  let repo: SqliteTodoRepository;
  let dashboards: SqliteDashboardRepository;
  let instances: SqliteWidgetInstanceRepository;
  const grid = { x: 0, y: 0, w: 4, h: 4 };

  beforeEach(() => {
    db = createTestDatabase();
    clock = new FixedClock(STAMP);
    const ids = sequentialIds();
    repo = new SqliteTodoRepository(db, clock, ids);
    dashboards = new SqliteDashboardRepository(db, clock, ids);
    instances = new SqliteWidgetInstanceRepository(db, clock, ids);
  });
  afterEach(() => db.close());

  async function instanceOf(dashboardId: string) {
    return instances.create({
      dashboardId,
      widgetType: 'todo',
      grid,
      config: { listId: null, showCompleted: true },
      configVersion: 1,
    });
  }

  async function newList() {
    const dashboard = await dashboards.create({ name: 'Home' });
    const instance = await instanceOf(dashboard.id);
    const list = await repo.createList({ widgetInstanceId: instance.id, name: 'Tâches' });
    return { dashboard, instance, list };
  }

  describe('lists', () => {
    it('creates and finds the list of an instance, null otherwise', async () => {
      const { instance, list } = await newList();
      expect(list).toMatchObject({
        widgetInstanceId: instance.id,
        name: 'Tâches',
        createdAt: STAMP,
        updatedAt: STAMP,
      });
      expect(await repo.getListForInstance(instance.id)).toEqual(list);
      expect(await repo.getListForInstance(MISSING)).toBeNull();
    });

    it('validates the name', async () => {
      expect(await kindOf(repo.createList({ name: '  ' }))).toBe('invalid_input');
      expect(await kindOf(repo.createList({ name: 'x'.repeat(81) }))).toBe('invalid_input');
      expect((await repo.createList({ name: ' ab ' })).name).toBe('ab');
    });

    it('refuses an unknown instance and a second list for the same instance', async () => {
      expect(await kindOf(repo.createList({ widgetInstanceId: 'nope', name: 'x' }))).toBe(
        'constraint',
      );
      const { instance } = await newList();
      expect(await kindOf(repo.createList({ widgetInstanceId: instance.id, name: 'y' }))).toBe(
        'conflict',
      );
    });
  });

  describe('todos', () => {
    it('appends at the end with increasing sort_order, trimming the title', async () => {
      const { list } = await newList();
      const a = await repo.create({ listId: list.id, title: '  A  ' });
      const b = await repo.create({ listId: list.id, title: 'B', dueOn: '2026-03-04' });
      expect(a).toMatchObject({
        title: 'A',
        dueOn: null,
        completedAt: null,
        sortOrder: 0,
        createdAt: STAMP,
      });
      expect(b).toMatchObject({ sortOrder: 1, dueOn: '2026-03-04' });
    });

    it('validates title and due date', async () => {
      const { list } = await newList();
      expect(await kindOf(repo.create({ listId: list.id, title: ' ' }))).toBe('invalid_input');
      expect(await kindOf(repo.create({ listId: list.id, title: 'x'.repeat(501) }))).toBe(
        'invalid_input',
      );
      expect(await kindOf(repo.create({ listId: list.id, title: 'a', dueOn: '03/04/2026' }))).toBe(
        'invalid_input',
      );
      expect(await kindOf(repo.create({ listId: list.id, title: 'a', dueOn: '2026-02-30' }))).toBe(
        'constraint',
      );
      expect(await kindOf(repo.create({ listId: MISSING, title: 'a' }))).toBe('constraint');
    });

    it('updates title and due date independently, null clears the date', async () => {
      const { list } = await newList();
      const t = await repo.create({ listId: list.id, title: 'A', dueOn: '2026-03-04' });
      clock.set('2026-02-02T00:00:00.000Z');
      const renamed = await repo.update(t.id, { title: 'B' });
      expect(renamed).toMatchObject({
        title: 'B',
        dueOn: '2026-03-04',
        updatedAt: '2026-02-02T00:00:00.000Z',
        createdAt: STAMP,
      });
      expect(await repo.update(t.id, { dueOn: '2026-05-06' })).toMatchObject({
        title: 'B',
        dueOn: '2026-05-06',
      });
      expect(await repo.update(t.id, { dueOn: null })).toMatchObject({ title: 'B', dueOn: null });
      expect(await kindOf(repo.update(t.id, { title: '' }))).toBe('invalid_input');
      expect(await kindOf(repo.update(MISSING, { title: 'x' }))).toBe('not_found');
    });

    it('setCompleted uses the clock and can be undone', async () => {
      const { list } = await newList();
      const t = await repo.create({ listId: list.id, title: 'A' });
      clock.set('2026-03-03T10:20:30.456Z');
      const done = await repo.setCompleted(t.id, true);
      expect(done.completedAt).toBe('2026-03-03T10:20:30.456Z');
      clock.set('2026-04-04T00:00:00.000Z');
      expect((await repo.setCompleted(t.id, true)).completedAt).toBe('2026-03-03T10:20:30.456Z');
      expect((await repo.setCompleted(t.id, false)).completedAt).toBeNull();
      expect(await kindOf(repo.setCompleted(MISSING, true))).toBe('not_found');
    });

    it('unchecking a completed todo moves it to the end of the active ones', async () => {
      const { list } = await newList();
      const a = await repo.create({ listId: list.id, title: 'A' });
      await repo.create({ listId: list.id, title: 'B' });
      await repo.create({ listId: list.id, title: 'C' });
      await repo.setCompleted(a.id, true);
      expect((await repo.setCompleted(a.id, false)).sortOrder).toBe(3);
      expect((await repo.listTodos(list.id)).map((t) => t.title)).toEqual(['B', 'C', 'A']);
      // Unchecking an active todo does not move it.
      const b = (await repo.listTodos(list.id))[0];
      expect((await repo.setCompleted(b.id, false)).sortOrder).toBe(b.sortOrder);
    });

    it('lists not completed by sort_order, then completed by completed_at descending', async () => {
      const { list } = await newList();
      const a = await repo.create({ listId: list.id, title: 'A' });
      const b = await repo.create({ listId: list.id, title: 'B' });
      const c = await repo.create({ listId: list.id, title: 'C' });
      const d = await repo.create({ listId: list.id, title: 'D' });
      clock.set('2026-01-02T00:00:00.000Z');
      await repo.setCompleted(a.id, true);
      clock.set('2026-01-03T00:00:00.000Z');
      await repo.setCompleted(c.id, true);
      const todos = await repo.listTodos(list.id);
      expect(todos.map((t) => t.title)).toEqual(['B', 'D', 'C', 'A']);
      expect(todos.map((t) => t.id)).toEqual([b.id, d.id, c.id, a.id]);
    });

    it('remove returns true then false', async () => {
      const { list } = await newList();
      const t = await repo.create({ listId: list.id, title: 'A' });
      expect(await repo.remove(t.id)).toBe(true);
      expect(await repo.remove(t.id)).toBe(false);
    });
  });

  describe('reorder', () => {
    it('rewrites sort_order following the given ids, only for rows that change', async () => {
      const { list } = await newList();
      const a = await repo.create({ listId: list.id, title: 'A' });
      const b = await repo.create({ listId: list.id, title: 'B' });
      const c = await repo.create({ listId: list.id, title: 'C' });
      clock.set('2026-02-02T00:00:00.000Z');
      await repo.reorder(list.id, [a.id, c.id, b.id]);
      const todos = await repo.listTodos(list.id);
      expect(todos.map((t) => t.title)).toEqual(['A', 'C', 'B']);
      const byTitle = new Map(todos.map((t) => [t.title, t]));
      expect(byTitle.get('A')?.updatedAt).toBe(STAMP);
      expect(byTitle.get('B')?.updatedAt).toBe('2026-02-02T00:00:00.000Z');
      expect(byTitle.get('C')?.updatedAt).toBe('2026-02-02T00:00:00.000Z');
    });

    it('ignores unknown ids and todos of another list', async () => {
      const { list } = await newList();
      const other = await repo.createList({ name: 'Autre' });
      const a = await repo.create({ listId: list.id, title: 'A' });
      const x = await repo.create({ listId: other.id, title: 'X' });
      await repo.reorder(list.id, [MISSING, x.id, a.id]);
      expect((await repo.listTodos(other.id))[0].sortOrder).toBe(0);
      expect((await repo.listTodos(list.id))[0].sortOrder).toBe(2);
    });

    it('validates the input before any query', async () => {
      const { list } = await newList();
      const execute = vi.spyOn(db, 'execute');
      await repo.reorder(list.id, []);
      expect(await kindOf(repo.reorder(list.id, ['a', 'a']))).toBe('invalid_input');
      const many = Array.from({ length: 1001 }, (_, i) => `id-${i}`);
      expect(await kindOf(repo.reorder(list.id, many))).toBe('invalid_input');
      expect(execute).not.toHaveBeenCalled();
      expect(REORDER_TODOS_SQL).toContain('json_each($1)');
    });
  });

  describe('clearCompleted', () => {
    it('deletes only the completed todos of the list and returns the count', async () => {
      const { list } = await newList();
      const other = await repo.createList({ name: 'Autre' });
      const a = await repo.create({ listId: list.id, title: 'A' });
      await repo.create({ listId: list.id, title: 'B' });
      const x = await repo.create({ listId: other.id, title: 'X' });
      await repo.setCompleted(a.id, true);
      await repo.setCompleted(x.id, true);
      expect(await repo.clearCompleted(list.id)).toBe(1);
      expect((await repo.listTodos(list.id)).map((t) => t.title)).toEqual(['B']);
      expect(await repo.listTodos(other.id)).toHaveLength(1);
      expect(await repo.clearCompleted(list.id)).toBe(0);
    });
  });

  describe('cascades', () => {
    it('instance deletion removes its list and todos, keeping others', async () => {
      const { dashboard, instance, list } = await newList();
      const otherInstance = await instanceOf(dashboard.id);
      const otherList = await repo.createList({ widgetInstanceId: otherInstance.id, name: 'O' });
      await repo.create({ listId: list.id, title: 'A' });
      await repo.create({ listId: otherList.id, title: 'B' });
      await instances.remove(instance.id);
      expect(await repo.getListForInstance(instance.id)).toBeNull();
      expect(await repo.listTodos(list.id)).toEqual([]);
      expect(await repo.listTodos(otherList.id)).toHaveLength(1);
    });

    it('dashboard deletion removes everything', async () => {
      const { dashboard, instance, list } = await newList();
      await repo.create({ listId: list.id, title: 'A' });
      await dashboards.remove(dashboard.id);
      expect(await repo.getListForInstance(instance.id)).toBeNull();
      expect(await db.select('SELECT id FROM todos')).toEqual([]);
      expect(await db.select('SELECT id FROM todo_lists')).toEqual([]);
    });
  });
});
