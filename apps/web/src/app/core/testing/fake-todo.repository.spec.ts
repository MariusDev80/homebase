import { DataError } from '../../data';
import { ManualClock } from '../time/testing/manual-clock';
import { FakeTodoRepository } from './fake-todo.repository';

describe('FakeTodoRepository.search', () => {
  function setup() {
    const clock = new ManualClock('2026-10-21T10:00:00.000Z');
    const repo = new FakeTodoRepository(clock);
    const list = repo.seedList('w1');
    return { repo, list };
  }

  it('validates the query and the limit like the real repository', async () => {
    const { repo } = setup();
    await expect(repo.search('   ', 5)).rejects.toMatchObject({ kind: 'invalid_input' });
    await expect(repo.search('a'.repeat(201), 5)).rejects.toBeInstanceOf(DataError);
    await expect(repo.search('a', 0)).rejects.toMatchObject({ kind: 'invalid_input' });
    await expect(repo.search('a', 21)).rejects.toMatchObject({ kind: 'invalid_input' });
  });

  it('orders active first, then title matches, then most recently updated, then id', async () => {
    const { repo, list } = setup();
    const done = repo.seed(list.id, 'foo done', { completedAt: '2026-10-20T08:00:00.000Z' });
    const body = repo.seed(list.id, 'Zeta', { description: 'a foo here' });
    const oldTitle = repo.seed(list.id, 'foo old', { updatedAt: '2026-01-01T00:00:00.000Z' });
    const newTitle = repo.seed(list.id, 'foo new', { updatedAt: '2026-06-01T00:00:00.000Z' });
    const hits = await repo.search(' foo ', 10);
    expect(hits.map((h) => h.id)).toEqual([newTitle.id, oldTitle.id, body.id, done.id]);
    expect(hits[2].excerpt).toContain('foo');
  });

  it('applies the limit after sorting', async () => {
    const { repo, list } = setup();
    repo.seed(list.id, 'Zeta', { description: 'foo' });
    const title = repo.seed(list.id, 'foo');
    expect((await repo.search('foo', 1)).map((h) => h.id)).toEqual([title.id]);
  });
});
