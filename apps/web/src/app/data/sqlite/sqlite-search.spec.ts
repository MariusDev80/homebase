import { DataError } from '../data-error';
import { excerptAround, likeContains } from '../search';
import { FixedClock, sequentialIds } from '../testing/fixed-clock';
import { createTestDatabase } from '../testing/migrations';
import { NodeSqliteExecutor } from '../testing/node-sqlite-executor';
import { SqliteDashboardRepository } from './sqlite-dashboard.repository';
import { SqliteNoteRepository } from './sqlite-note.repository';
import { SqliteShortcutRepository } from './sqlite-shortcut.repository';
import { SqliteTodoRepository } from './sqlite-todo.repository';
import { SqliteWidgetInstanceRepository } from './sqlite-widget-instance.repository';

const STAMP = '2026-01-01T00:00:00.000Z';

async function kindOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof DataError) return e.kind;
    throw e;
  }
  return 'no error';
}

describe('search helpers', () => {
  it('escapes backslash, percent and underscore in the LIKE pattern', () => {
    expect(likeContains('50%_a\\b')).toBe('%50\\%\\_a\\\\b%');
  });

  it('builds a short excerpt around the first match with ellipses', () => {
    const body = `${'a '.repeat(50)}NEEDLE${' b'.repeat(80)}`;
    const excerpt = excerptAround(body, 'needle');
    expect(excerpt.startsWith('…')).toBe(true);
    expect(excerpt.endsWith('…')).toBe(true);
    expect(excerpt).toContain('NEEDLE');
    expect(excerpt.length).toBeLessThan(110);
  });

  it('collapses whitespace and falls back to the start of the body without a match', () => {
    expect(excerptAround('line one\n\n  line two', 'zzz')).toBe('line one line two');
    expect(excerptAround('', 'x')).toBe('');
  });
});

describe('repositories search', () => {
  let db: NodeSqliteExecutor;
  let clock: FixedClock;
  let shortcuts: SqliteShortcutRepository;
  let notes: SqliteNoteRepository;
  let todos: SqliteTodoRepository;

  beforeEach(() => {
    db = createTestDatabase();
    clock = new FixedClock(STAMP);
    const ids = sequentialIds();
    shortcuts = new SqliteShortcutRepository(db, clock, ids);
    notes = new SqliteNoteRepository(db, clock, ids);
    todos = new SqliteTodoRepository(db, clock, ids);
  });
  afterEach(() => db.close());

  describe('shortcuts', () => {
    it('matches label or url, ASCII case-insensitively, label matches first', async () => {
      await shortcuts.create({ label: 'Docs', url: 'https://example.com/angular' });
      await shortcuts.create({ label: 'Angular', url: 'https://angular.dev' });
      await shortcuts.create({ label: 'Autre', url: 'https://autre.org' });
      const hits = await shortcuts.search('ANGULAR', 10);
      expect(hits.map((s) => s.label)).toEqual(['Angular', 'Docs']);
    });

    it('finds %, _ and \\ literally', async () => {
      await shortcuts.create({ label: '100% pur', url: 'https://a.test/1' });
      await shortcuts.create({ label: 'snake_case', url: 'https://a.test/2' });
      await shortcuts.create({ label: 'plain', url: 'https://a.test/3?p=c:\\dir' });
      await shortcuts.create({ label: 'abcd', url: 'https://a.test/4' });
      expect((await shortcuts.search('%', 10)).map((s) => s.label)).toEqual(['100% pur']);
      expect((await shortcuts.search('_', 10)).map((s) => s.label)).toEqual(['snake_case']);
      expect((await shortcuts.search('\\', 10)).map((s) => s.label)).toEqual(['plain']);
      expect(await shortcuts.search('a_c', 10)).toEqual([]);
    });

    it('honours the limit and sort order', async () => {
      for (const n of [1, 2, 3, 4]) {
        await shortcuts.create({ label: `site ${n}`, url: `https://s.test/${n}` });
      }
      expect((await shortcuts.search('site', 2)).map((s) => s.label)).toEqual(['site 1', 'site 2']);
    });

    it('validates query and limit', async () => {
      expect(await kindOf(shortcuts.search('', 5))).toBe('invalid_input');
      expect(await kindOf(shortcuts.search('   ', 5))).toBe('invalid_input');
      expect(await kindOf(shortcuts.search('x'.repeat(201), 5))).toBe('invalid_input');
      expect(await kindOf(shortcuts.search('x', 0))).toBe('invalid_input');
      expect(await kindOf(shortcuts.search('x', 21))).toBe('invalid_input');
      expect(await kindOf(shortcuts.search('x', 1.5))).toBe('invalid_input');
      expect(await kindOf(shortcuts.search(' x ', 20))).toBe('no error');
      expect(await kindOf(shortcuts.search('x'.repeat(200), 1))).toBe('no error');
    });

    it('is not vulnerable to quotes in the query', async () => {
      await shortcuts.create({ label: "it's", url: 'https://a.test' });
      expect(await shortcuts.search("'; DROP TABLE shortcuts; --", 5)).toEqual([]);
      expect(await shortcuts.search("it's", 5)).toHaveLength(1);
    });
  });

  describe('notes', () => {
    it('matches title or body, title matches first, with an excerpt', async () => {
      await notes.create({ title: 'Courses', body: 'acheter du lait et du pain' });
      clock.set('2026-02-01T00:00:00.000Z');
      await notes.create({ title: 'Lait de coco', body: 'recette' });
      const hits = await notes.search('LAIT', 10);
      expect(hits.map((n) => n.title)).toEqual(['Lait de coco', 'Courses']);
      expect(hits[1].excerpt).toContain('lait');
      expect(hits[1].widgetInstanceId).toBeNull();
    });

    it('finds %, _ and \\ literally in titles and bodies', async () => {
      await notes.create({ title: 'a', body: 'taux 5% fixe' });
      await notes.create({ title: 'b', body: 'my_var' });
      await notes.create({ title: 'c', body: 'C:\\temp' });
      await notes.create({ title: 'd', body: 'rien' });
      expect((await notes.search('5%', 10)).map((n) => n.title)).toEqual(['a']);
      expect((await notes.search('y_v', 10)).map((n) => n.title)).toEqual(['b']);
      expect((await notes.search('\\t', 10)).map((n) => n.title)).toEqual(['c']);
      expect(await notes.search('%', 10)).toHaveLength(1);
    });

    it('honours the limit, orders by recency and validates input', async () => {
      for (const day of ['01', '02', '03']) {
        clock.set(`2026-03-${day}T00:00:00.000Z`);
        await notes.create({ title: `n${day}`, body: 'common' });
      }
      expect((await notes.search('common', 2)).map((n) => n.title)).toEqual(['n03', 'n02']);
      expect(await kindOf(notes.search('', 5))).toBe('invalid_input');
      expect(await kindOf(notes.search('x', 21))).toBe('invalid_input');
    });

    it('returns the owning widget instance id', async () => {
      const dashboard = await new SqliteDashboardRepository(db, clock, sequentialIds()).create({
        name: 'Home',
      });
      const instance = await new SqliteWidgetInstanceRepository(db, clock, sequentialIds()).create({
        dashboardId: dashboard.id,
        widgetType: 'notes',
        grid: { x: 0, y: 0, w: 4, h: 3 },
        config: {},
        configVersion: 1,
      });
      await notes.create({ widgetInstanceId: instance.id, title: 'Perso', body: '' });
      expect((await notes.search('perso', 5))[0].widgetInstanceId).toBe(instance.id);
    });
  });

  describe('todos', () => {
    async function listFor(): Promise<{ listId: string; instanceId: string }> {
      const dashboards = new SqliteDashboardRepository(db, clock, sequentialIds());
      const dashboard = await dashboards.create({ name: 'Home' });
      const instance = await new SqliteWidgetInstanceRepository(db, clock, sequentialIds()).create({
        dashboardId: dashboard.id,
        widgetType: 'todo',
        grid: { x: 0, y: 0, w: 4, h: 3 },
        config: {},
        configVersion: 1,
      });
      const list = await todos.createList({ name: 'Tâches', widgetInstanceId: instance.id });
      return { listId: list.id, instanceId: instance.id };
    }

    it('matches active and completed todos, active first, with list instance', async () => {
      const { listId, instanceId } = await listFor();
      const done = await todos.create({ listId, title: 'payer facture' });
      await todos.setCompleted(done.id, true);
      clock.set('2026-02-01T00:00:00.000Z');
      await todos.create({ listId, title: 'Facture EDF' });
      await todos.create({ listId, title: 'sans rapport' });
      const hits = await todos.search('facture', 10);
      expect(hits.map((t) => t.title)).toEqual(['Facture EDF', 'payer facture']);
      expect(hits[0]).toMatchObject({ listId, widgetInstanceId: instanceId, completedAt: null });
      expect(hits[1].completedAt).toBe(STAMP);
    });

    it('finds %, _ and \\ literally and honours the limit', async () => {
      const { listId } = await listFor();
      await todos.create({ listId, title: 'solde 20%' });
      await todos.create({ listId, title: 'a_b' });
      await todos.create({ listId, title: 'x\\y' });
      await todos.create({ listId, title: 'axb' });
      expect((await todos.search('%', 10)).map((t) => t.title)).toEqual(['solde 20%']);
      expect((await todos.search('a_b', 10)).map((t) => t.title)).toEqual(['a_b']);
      expect((await todos.search('\\', 10)).map((t) => t.title)).toEqual(['x\\y']);
      expect(await todos.search('x', 1)).toHaveLength(1);
      expect(await kindOf(todos.search('x', 0))).toBe('invalid_input');
    });
  });
});
