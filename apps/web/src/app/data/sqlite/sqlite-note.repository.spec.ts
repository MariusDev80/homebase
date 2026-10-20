import { DataError } from '../data-error';
import { FixedClock, sequentialIds } from '../testing/fixed-clock';
import { createTestDatabase } from '../testing/migrations';
import { NodeSqliteExecutor } from '../testing/node-sqlite-executor';
import { SqliteDashboardRepository } from './sqlite-dashboard.repository';
import { SqliteNoteRepository } from './sqlite-note.repository';
import { SqliteWidgetInstanceRepository } from './sqlite-widget-instance.repository';

const STAMP = '2026-01-01T00:00:00.000Z';
const ID = '00000000-0000-4000-8000-0000000000aa';

describe('V2 notes table', () => {
  let db: NodeSqliteExecutor;
  beforeEach(() => {
    db = createTestDatabase();
  });
  afterEach(() => db.close());

  const insert = (id: string, title: string, body: string) =>
    db.execute(
      'INSERT INTO notes (id, title, body, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)',
      [id, title, body, STAMP],
    );

  async function kindOf(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
    } catch (e) {
      if (e instanceof DataError) return e.kind;
      throw e;
    }
    return 'no error';
  }

  it('accepts an empty title, a 200-character title and a 100000-character body', async () => {
    await insert(ID, '', '');
    await insert(ID.replace('aa', 'bb'), 'x'.repeat(200), 'y'.repeat(100_000));
    expect(await db.select('SELECT id FROM notes')).toHaveLength(2);
  });

  it('refuses a title of 201 characters', async () => {
    expect(await kindOf(insert(ID, 'x'.repeat(201), ''))).toBe('constraint');
  });

  it('refuses a body of 100001 characters', async () => {
    expect(await kindOf(insert(ID, '', 'y'.repeat(100_001)))).toBe('constraint');
  });

  it('refuses a malformed id', async () => {
    expect(await kindOf(insert('not-a-uuid', '', ''))).toBe('constraint');
  });
});

describe('SqliteNoteRepository', () => {
  let db: NodeSqliteExecutor;
  let clock: FixedClock;
  let repo: SqliteNoteRepository;

  beforeEach(() => {
    db = createTestDatabase();
    clock = new FixedClock(STAMP);
    repo = new SqliteNoteRepository(db, clock, sequentialIds());
  });
  afterEach(() => db.close());

  async function kindOf(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
    } catch (e) {
      if (e instanceof DataError) return e.kind;
      throw e;
    }
    return 'no error';
  }

  it('creates an empty note by default', async () => {
    expect(await repo.create()).toEqual({
      id: '00000000-0000-4000-8000-000000000001',
      widgetInstanceId: null,
      title: '',
      body: '',
      createdAt: STAMP,
      updatedAt: STAMP,
    });
  });

  it('gets a note, null when absent', async () => {
    const created = await repo.create({ title: 'T', body: 'B' });
    expect(await repo.get(created.id)).toEqual(created);
    expect(await repo.get('00000000-0000-4000-8000-0000000000ff')).toBeNull();
  });

  it('updates title, body and updated_at, keeping created_at', async () => {
    const created = await repo.create();
    clock.set('2026-02-02T00:00:00.000Z');
    const updated = await repo.update(created.id, 'Titre', 'Corps\nligne 2');
    expect(updated).toEqual({
      ...created,
      title: 'Titre',
      body: 'Corps\nligne 2',
      updatedAt: '2026-02-02T00:00:00.000Z',
    });
  });

  it('stores markup as plain text', async () => {
    const created = await repo.create();
    const body = '<img src=x onerror=alert(1)> # titre **gras**';
    expect((await repo.update(created.id, '', body)).body).toBe(body);
  });

  it('update throws not_found when absent', async () => {
    expect(await kindOf(repo.update('00000000-0000-4000-8000-0000000000ff', 'a', 'b'))).toBe(
      'not_found',
    );
  });

  it('refuses oversized fields with invalid_input', async () => {
    const created = await repo.create();
    expect(await kindOf(repo.update(created.id, 'x'.repeat(201), ''))).toBe('invalid_input');
    expect(await kindOf(repo.update(created.id, '', 'y'.repeat(100_001)))).toBe('invalid_input');
    expect(await kindOf(repo.create({ title: 'x'.repeat(201) }))).toBe('invalid_input');
  });

  it('accepts the maximum sizes', async () => {
    const created = await repo.create();
    const updated = await repo.update(created.id, 'x'.repeat(200), 'y'.repeat(100_000));
    expect(updated.body).toHaveLength(100_000);
  });

  it('remove returns true then false', async () => {
    const created = await repo.create();
    expect(await repo.remove(created.id)).toBe(true);
    expect(await repo.remove(created.id)).toBe(false);
    expect(await repo.get(created.id)).toBeNull();
  });

  describe('owning widget instance', () => {
    let dashboards: SqliteDashboardRepository;
    let instances: SqliteWidgetInstanceRepository;
    const grid = { x: 0, y: 0, w: 4, h: 3 };

    beforeEach(() => {
      const ids = sequentialIds();
      dashboards = new SqliteDashboardRepository(db, clock, ids);
      instances = new SqliteWidgetInstanceRepository(db, clock, ids);
    });

    async function noteOfNewInstance(dashboardId: string) {
      const instance = await instances.create({
        dashboardId,
        widgetType: 'notes',
        grid,
        config: { noteId: null },
        configVersion: 1,
      });
      const note = await repo.create({ widgetInstanceId: instance.id });
      return { instance, note };
    }

    it('stores the owning instance id', async () => {
      const dashboard = await dashboards.create({ name: 'Home' });
      const { instance, note } = await noteOfNewInstance(dashboard.id);
      expect(note.widgetInstanceId).toBe(instance.id);
      expect((await repo.get(note.id))?.widgetInstanceId).toBe(instance.id);
    });

    it('deletes the note with its widget instance', async () => {
      const dashboard = await dashboards.create({ name: 'Home' });
      const { instance, note } = await noteOfNewInstance(dashboard.id);
      const other = await noteOfNewInstance(dashboard.id);
      await instances.remove(instance.id);
      expect(await repo.get(note.id)).toBeNull();
      expect(await repo.get(other.note.id)).not.toBeNull();
    });

    it('deletes the note when the dashboard is deleted', async () => {
      const dashboard = await dashboards.create({ name: 'Home' });
      const { note } = await noteOfNewInstance(dashboard.id);
      await dashboards.remove(dashboard.id);
      expect(await repo.get(note.id)).toBeNull();
    });

    it('keeps standalone notes when an instance is deleted', async () => {
      const dashboard = await dashboards.create({ name: 'Home' });
      const standalone = await repo.create();
      const { instance } = await noteOfNewInstance(dashboard.id);
      await instances.remove(instance.id);
      expect(await repo.get(standalone.id)).not.toBeNull();
    });

    it('refuses an unknown instance and a second note for the same instance', async () => {
      expect(await kindOf(repo.create({ widgetInstanceId: 'nope' }))).toBe('constraint');
      const dashboard = await dashboards.create({ name: 'Home' });
      const { instance } = await noteOfNewInstance(dashboard.id);
      expect(await kindOf(repo.create({ widgetInstanceId: instance.id }))).toBe('conflict');
    });
  });
});
