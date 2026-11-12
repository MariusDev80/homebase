import { TestBed } from '@angular/core/testing';
import { NOTE_REPOSITORY, SHORTCUT_REPOSITORY, TODO_REPOSITORY } from '../../data';
import type { Clock } from '../../data';
import { FakeNoteRepository } from '../testing/fake-note.repository';
import { FakeShortcutRepository } from '../testing/fake-shortcut.repository';
import { FakeTodoRepository } from '../testing/fake-todo.repository';
import { SEARCH_GROUP_LIMIT, SearchService } from './search.service';

function setup() {
  const clock: Clock = { nowIso: () => '2026-01-01T00:00:00.000Z' } as Clock;
  const shortcuts = new FakeShortcutRepository();
  const notes = new FakeNoteRepository();
  const todos = new FakeTodoRepository(clock);
  TestBed.configureTestingModule({
    providers: [
      { provide: SHORTCUT_REPOSITORY, useValue: shortcuts },
      { provide: NOTE_REPOSITORY, useValue: notes },
      { provide: TODO_REPOSITORY, useValue: todos },
    ],
  });
  return { service: TestBed.inject(SearchService), shortcuts, notes, todos };
}

describe('SearchService', () => {
  it('merges the three sources into typed groups, in a fixed order', async () => {
    const { service, shortcuts, notes, todos } = setup();
    shortcuts.seed('Angular docs', 'https://angular.dev');
    notes.seed({ id: 'n1', title: 'Angular', body: 'notes sur angular', widgetInstanceId: 'w1' });
    const list = todos.seedList('w2');
    todos.seed(list.id, 'Apprendre angular');

    const outcome = await service.search('angular');

    expect(outcome.failed).toEqual([]);
    expect(outcome.groups.map((g) => g.kind)).toEqual(['shortcut', 'note', 'todo']);
    expect(outcome.groups[0].results[0]).toMatchObject({
      kind: 'shortcut',
      title: 'Angular docs',
      url: 'https://angular.dev',
    });
    expect(outcome.groups[1].results[0]).toMatchObject({
      kind: 'note',
      id: 'n1',
      widgetInstanceId: 'w1',
    });
    expect(outcome.groups[2].results[0]).toMatchObject({
      kind: 'todo',
      title: 'Apprendre angular',
      widgetInstanceId: 'w2',
      completed: false,
    });
  });

  it('gives a todo a subtitle only when its description excerpt is not empty', async () => {
    const { service, todos } = setup();
    const list = todos.seedList(null);
    todos.seed(list.id, 'Ranger', { description: 'le mot rare est ici' });
    todos.seed(list.id, 'rare titre');
    const results = (await service.search('rare')).groups[0].results;
    const withText = results.find((r) => r.title === 'Ranger');
    const without = results.find((r) => r.title === 'rare titre');
    expect(withText).toMatchObject({ kind: 'todo', subtitle: 'le mot rare est ici' });
    expect(without).toBeDefined();
    expect(without && 'subtitle' in without).toBe(false);
  });

  it('omits empty groups and flags completed todos', async () => {
    const { service, todos } = setup();
    const list = todos.seedList(null);
    todos.seed(list.id, 'fini', { completedAt: '2026-01-01T00:00:00.000Z' });
    const outcome = await service.search('fini');
    expect(outcome.groups).toHaveLength(1);
    expect(outcome.groups[0].results[0]).toMatchObject({ kind: 'todo', completed: true });
  });

  it('asks each source for at most 5 results and keeps at most 5 per group', async () => {
    const { service, shortcuts } = setup();
    for (let i = 0; i < 8; i++) shortcuts.seed(`site ${i}`, `https://s.test/${i}`);
    const spy = vi.spyOn(shortcuts, 'search');
    const outcome = await service.search('site');
    expect(spy).toHaveBeenCalledWith('site', SEARCH_GROUP_LIMIT);
    expect(outcome.groups[0].results).toHaveLength(5);
  });

  it('returns a partial result when one source fails', async () => {
    const { service, shortcuts, notes } = setup();
    shortcuts.seed('Angular', 'https://angular.dev');
    notes.failNext(new Error('boom'));
    const outcome = await service.search('angular');
    expect(outcome.failed).toEqual(['note']);
    expect(outcome.groups.map((g) => g.kind)).toEqual(['shortcut']);
  });

  it('reports every source when all fail', async () => {
    const { service, shortcuts, notes, todos } = setup();
    shortcuts.failNext(new Error('a'));
    notes.failNext(new Error('b'));
    todos.failNext(new Error('c'));
    const outcome = await service.search('x');
    expect(outcome.groups).toEqual([]);
    expect(outcome.failed).toEqual(['shortcut', 'note', 'todo']);
  });

  it('does not query anything for a blank query and trims the term', async () => {
    const { service, shortcuts, notes } = setup();
    const spy = vi.spyOn(shortcuts, 'search');
    const noteSpy = vi.spyOn(notes, 'search');
    expect(await service.search('   ')).toEqual({ groups: [], failed: [] });
    expect(spy).not.toHaveBeenCalled();
    await service.search('  abc  ');
    expect(noteSpy).toHaveBeenCalledWith('abc', 5);
  });

  it('truncates a query longer than 200 characters', async () => {
    const { service, shortcuts } = setup();
    const spy = vi.spyOn(shortcuts, 'search');
    await service.search('x'.repeat(300));
    expect(spy).toHaveBeenCalledWith('x'.repeat(200), 5);
  });
});
