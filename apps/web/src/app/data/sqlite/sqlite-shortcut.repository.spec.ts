import { DataError } from '../data-error';
import { FixedClock, sequentialIds } from '../testing/fixed-clock';
import { createTestDatabase } from '../testing/migrations';
import { NodeSqliteExecutor } from '../testing/node-sqlite-executor';
import { SqliteShortcutRepository } from './sqlite-shortcut.repository';

const STAMP = '2026-01-01T00:00:00.000Z';
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

describe('V2 shortcuts table', () => {
  let db: NodeSqliteExecutor;
  let counter = 0;
  beforeEach(() => {
    db = createTestDatabase();
    counter = 0;
  });
  afterEach(() => db.close());

  const insert = (label: string, url: string, sortOrder = 0) =>
    db.execute(
      `INSERT INTO shortcuts (id, label, url, sort_order, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5)`,
      [
        `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
        label,
        url,
        sortOrder,
        STAMP,
      ],
    );

  it('accepts http and https URLs and a label of 80 characters', async () => {
    await insert('A', 'https://example.com/');
    await insert('B', 'http://example.com/');
    await insert('x'.repeat(80), 'https://example.com/');
    expect(await db.select('SELECT id FROM shortcuts')).toHaveLength(3);
  });

  it.each([
    'javascript:alert(1)',
    'file:///C:/Windows/system32/cmd.exe',
    'data:text/html,hi',
    'ftp://example.com/',
    'example.com',
  ])('refuses the URL %s', async (url) => {
    expect(await kindOf(insert('A', url))).toBe('constraint');
  });

  it('refuses a URL longer than 2048 characters', async () => {
    expect(await kindOf(insert('A', 'https://e.com/' + 'a'.repeat(2048)))).toBe('constraint');
  });

  it('refuses an empty or blank label and a label of 81 characters', async () => {
    expect(await kindOf(insert('', 'https://e.com/'))).toBe('constraint');
    expect(await kindOf(insert('   ', 'https://e.com/'))).toBe('constraint');
    expect(await kindOf(insert('x'.repeat(81), 'https://e.com/'))).toBe('constraint');
  });

  it('refuses a negative sort_order', async () => {
    expect(await kindOf(insert('A', 'https://e.com/', -1))).toBe('constraint');
  });
});

describe('SqliteShortcutRepository', () => {
  let db: NodeSqliteExecutor;
  let clock: FixedClock;
  let repo: SqliteShortcutRepository;

  beforeEach(() => {
    db = createTestDatabase();
    clock = new FixedClock(STAMP);
    repo = new SqliteShortcutRepository(db, clock, sequentialIds());
  });
  afterEach(() => db.close());

  const labels = async () => (await repo.list()).map((s) => s.label);

  it('creates with increasing sort_order and trims the label', async () => {
    const a = await repo.create({ label: '  A  ', url: 'https://a.example/' });
    const b = await repo.create({ label: 'B', url: 'http://b.example/' });
    expect(a).toEqual({
      id: '00000000-0000-4000-8000-000000000001',
      label: 'A',
      url: 'https://a.example/',
      sortOrder: 0,
      createdAt: STAMP,
      updatedAt: STAMP,
    });
    expect(b.sortOrder).toBe(1);
  });

  it('lists by sort_order then created_at', async () => {
    await repo.create({ label: 'A', url: 'https://a.example/' });
    await repo.create({ label: 'B', url: 'https://b.example/' });
    await repo.create({ label: 'C', url: 'https://c.example/' });
    expect(await labels()).toEqual(['A', 'B', 'C']);
    await db.execute(
      "UPDATE shortcuts SET sort_order = 0, created_at = '2025-01-01T00:00:00.000Z' WHERE label = 'C'",
    );
    expect(await labels()).toEqual(['C', 'A', 'B']);
  });

  it('gives a new shortcut the maximum sort_order + 1 after a removal', async () => {
    const a = await repo.create({ label: 'A', url: 'https://a.example/' });
    await repo.create({ label: 'B', url: 'https://b.example/' });
    await repo.remove(a.id);
    const c = await repo.create({ label: 'C', url: 'https://c.example/' });
    expect(c.sortOrder).toBe(2);
    expect(await labels()).toEqual(['B', 'C']);
  });

  it('updates label and url, keeping sort_order and created_at', async () => {
    const a = await repo.create({ label: 'A', url: 'https://a.example/' });
    clock.set('2026-02-02T00:00:00.000Z');
    const updated = await repo.update(a.id, { label: 'Z', url: 'https://z.example/' });
    expect(updated).toEqual({
      ...a,
      label: 'Z',
      url: 'https://z.example/',
      updatedAt: '2026-02-02T00:00:00.000Z',
    });
  });

  it('update throws not_found when absent', async () => {
    const result = repo.update(MISSING, { label: 'A', url: 'https://a.example/' });
    expect(await kindOf(result)).toBe('not_found');
  });

  it('refuses invalid fields with invalid_input', async () => {
    const ok = 'https://a.example/';
    expect(await kindOf(repo.create({ label: ' ', url: ok }))).toBe('invalid_input');
    expect(await kindOf(repo.create({ label: 'x'.repeat(81), url: ok }))).toBe('invalid_input');
    expect(await kindOf(repo.create({ label: 'A', url: 'javascript:alert(1)' }))).toBe(
      'invalid_input',
    );
    expect(await kindOf(repo.create({ label: 'A', url: ok + 'a'.repeat(2048) }))).toBe(
      'invalid_input',
    );
    expect(await labels()).toEqual([]);
  });

  it('remove returns true then false', async () => {
    const a = await repo.create({ label: 'A', url: 'https://a.example/' });
    expect(await repo.remove(a.id)).toBe(true);
    expect(await repo.remove(a.id)).toBe(false);
  });

  it('reorders according to the given ids', async () => {
    const a = await repo.create({ label: 'A', url: 'https://a.example/' });
    const b = await repo.create({ label: 'B', url: 'https://b.example/' });
    const c = await repo.create({ label: 'C', url: 'https://c.example/' });
    await repo.reorder([c.id, a.id, b.id]);
    expect(await labels()).toEqual(['C', 'A', 'B']);
    expect((await repo.list()).map((s) => s.sortOrder)).toEqual([0, 1, 2]);
  });

  it('reorder ignores unknown ids and does nothing for an empty batch', async () => {
    const a = await repo.create({ label: 'A', url: 'https://a.example/' });
    const b = await repo.create({ label: 'B', url: 'https://b.example/' });
    await repo.reorder([]);
    await repo.reorder([MISSING, b.id, a.id]);
    expect(await labels()).toEqual(['B', 'A']);
    const sorted = await repo.list();
    expect(sorted.find((s) => s.id === b.id)?.sortOrder).toBe(1);
    expect(sorted.find((s) => s.id === a.id)?.sortOrder).toBe(2);
  });

  it('reorder rejects duplicate ids before any change', async () => {
    const a = await repo.create({ label: 'A', url: 'https://a.example/' });
    expect(await kindOf(repo.reorder([a.id, a.id]))).toBe('invalid_input');
  });

  it('reorder rejects more than 1000 ids', async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => 'id-' + i);
    expect(await kindOf(repo.reorder(ids))).toBe('invalid_input');
  });

  it('reorder only touches rows whose sort_order changes', async () => {
    const a = await repo.create({ label: 'A', url: 'https://a.example/' });
    const b = await repo.create({ label: 'B', url: 'https://b.example/' });
    const c = await repo.create({ label: 'C', url: 'https://c.example/' });
    clock.set('2026-03-03T00:00:00.000Z');
    await repo.reorder([a.id, c.id, b.id]);
    const byLabel = new Map((await repo.list()).map((s) => [s.label, s]));
    expect(byLabel.get('A')?.updatedAt).toBe(STAMP);
    expect(byLabel.get('B')?.updatedAt).toBe('2026-03-03T00:00:00.000Z');
    expect(byLabel.get('C')?.updatedAt).toBe('2026-03-03T00:00:00.000Z');
  });
});
