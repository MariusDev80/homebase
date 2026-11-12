import { ApplicationInitStatus, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideAppI18n } from '../../core/i18n';
import { FakeSettingsRepository } from '../../core/testing/fake-settings.repository';
import { FakeTodoRepository } from '../../core/testing/fake-todo.repository';
import { SYSTEM_TIME_ZONE_READER } from '../../core/time';
import { ManualClock } from '../../core/time/testing/manual-clock';
import { WIDGET_CONTEXT } from '../../core/widgets';
import type { WidgetContext } from '../../core/widgets';
import { CLOCK, DataError, SETTINGS_REPOSITORY, TODO_REPOSITORY } from '../../data';
import { TodoComponent } from './todo.component';
import type { TodoConfig } from './todo.config';

const INSTANCE = 'inst-1';
// 12:00 on 2026-10-21 in Paris (CEST).
const NOON = '2026-10-21T10:00:00.000Z';

interface Options {
  config?: TodoConfig;
  repo?: FakeTodoRepository;
  clock?: ManualClock;
  failUpdateConfig?: boolean;
}

async function render(options: Options = {}) {
  const clock = options.clock ?? new ManualClock(NOON);
  const repo = options.repo ?? new FakeTodoRepository(clock);
  const config = signal<TodoConfig>(options.config ?? { listId: null, showCompleted: true });
  const updateConfig = vi.fn((next: TodoConfig): Promise<void> => {
    if (options.failUpdateConfig) return Promise.reject(new Error('config write failed'));
    config.set(next);
    return Promise.resolve();
  });
  const ctx: WidgetContext<TodoConfig> = {
    instanceId: INSTANCE,
    type: 'todo',
    config,
    size: signal({ w: 4, h: 4 }),
    permissions: new Set(),
    updateConfig,
  };
  TestBed.configureTestingModule({
    providers: [
      provideAppI18n(),
      { provide: WIDGET_CONTEXT, useValue: ctx },
      { provide: TODO_REPOSITORY, useValue: repo },
      { provide: CLOCK, useValue: clock },
      { provide: SETTINGS_REPOSITORY, useValue: new FakeSettingsRepository() },
      { provide: SYSTEM_TIME_ZONE_READER, useValue: () => 'Europe/Paris' },
    ],
  });
  await TestBed.inject(ApplicationInitStatus).donePromise;
  const fixture = TestBed.createComponent(TodoComponent);
  const settle = async () => {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
    else await fixture.whenStable();
    fixture.detectChanges();
  };
  await settle();
  const el = fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement>(id: string) =>
    el.querySelector(`[data-testid="${id}"]`) as T | null;
  const all = (id: string) => Array.from(el.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`));
  const click = async (target: HTMLElement | null) => {
    if (!target) throw new Error('element not found');
    target.click();
    await settle();
  };
  const fill = (target: HTMLInputElement | null, value: string) => {
    if (!target) throw new Error('input not rendered');
    target.value = value;
    target.dispatchEvent(new Event('input'));
  };
  const press = async (target: HTMLElement | null, key: string) => {
    if (!target) throw new Error('element not found');
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    await settle();
  };
  const titles = () => all('todo-title').map((t) => t.textContent?.trim());
  const focusedId = () => document.activeElement?.getAttribute('data-testid');
  return {
    fixture,
    el,
    repo,
    clock,
    config,
    updateConfig,
    settle,
    q,
    all,
    click,
    fill,
    press,
    titles,
    focusedId,
  };
}

function seeded(clock = new ManualClock(NOON)) {
  const repo = new FakeTodoRepository(clock);
  const list = repo.seedList(INSTANCE);
  const a = repo.seed(list.id, 'Alpha');
  const b = repo.seed(list.id, 'Bravo');
  const c = repo.seed(list.id, 'Charlie');
  const config: TodoConfig = { listId: list.id, showCompleted: true };
  return { repo, list, a, b, c, config, clock };
}

describe('TodoComponent', () => {
  afterEach(() => vi.useRealTimers());

  describe('loading', () => {
    it('creates the list on first display and stores its id in the config', async () => {
      const { repo, config, q, updateConfig } = await render();
      expect(repo.calls.filter((c) => c === 'createList')).toHaveLength(1);
      const [list] = [...repo.lists.values()];
      expect(list).toMatchObject({ widgetInstanceId: INSTANCE, name: 'Tâches' });
      expect(updateConfig).toHaveBeenCalledExactlyOnceWith({
        listId: list.id,
        showCompleted: true,
      });
      expect(config().listId).toBe(list.id);
      expect(q('todo-empty')).not.toBeNull();
      expect(q('todo-new')).not.toBeNull();
    });

    it('adopts the list of the instance when the config lost its id (no second list)', async () => {
      const clock = new ManualClock(NOON);
      const repo = new FakeTodoRepository(clock);
      const list = repo.seedList(INSTANCE);
      repo.seed(list.id, 'Déjà là');
      const { updateConfig, titles } = await render({ repo, clock });
      expect(repo.calls).not.toContain('createList');
      expect(updateConfig).toHaveBeenCalledWith({ listId: list.id, showCompleted: true });
      expect(titles()).toEqual(['Déjà là']);
    });

    it('does not leave a second list behind when the config write fails, then recovers', async () => {
      const clock = new ManualClock(NOON);
      const repo = new FakeTodoRepository(clock);
      const first = await render({ repo, clock, failUpdateConfig: true });
      expect(first.q('todo-error')).not.toBeNull();
      expect(repo.lists.size).toBe(1);
      TestBed.resetTestingModule();
      await render({ repo, clock });
      expect(repo.lists.size).toBe(1);
    });

    it('stays usable when adopting the list cannot be stored in the config', async () => {
      const clock = new ManualClock(NOON);
      const repo = new FakeTodoRepository(clock);
      const list = repo.seedList(INSTANCE);
      repo.seed(list.id, 'Garde-moi');
      const { q, titles, updateConfig, config } = await render({
        repo,
        clock,
        failUpdateConfig: true,
      });
      expect(updateConfig).toHaveBeenCalledWith({ listId: list.id, showCompleted: true });
      expect(config().listId).toBeNull();
      expect(q('todo-error')).toBeNull();
      expect(q('todo-new')).not.toBeNull();
      expect(titles()).toEqual(['Garde-moi']);
    });

    it('uses the list owned by this instance when the config points at another one', async () => {
      const clock = new ManualClock(NOON);
      const repo = new FakeTodoRepository(clock);
      const mine = repo.seedList(INSTANCE);
      const theirs = repo.seedList('inst-2');
      repo.seed(mine.id, 'À moi');
      repo.seed(theirs.id, "À l'autre");
      const { titles, updateConfig, config } = await render({
        repo,
        clock,
        config: { listId: theirs.id, showCompleted: true },
      });
      expect(titles()).toEqual(['À moi']);
      expect(updateConfig).toHaveBeenCalledWith({ listId: mine.id, showCompleted: true });
      expect(config().listId).toBe(mine.id);
    });

    it('adopts the existing list when creation loses a race (conflict)', async () => {
      const clock = new ManualClock(NOON);
      const repo = new FakeTodoRepository(clock);
      const real = repo.getListForInstance.bind(repo);
      let first = true;
      repo.getListForInstance = async (id) => {
        if (first) {
          first = false;
          return null;
        }
        return real(id);
      };
      repo.createList = async () => {
        repo.seedList(INSTANCE);
        throw new DataError('conflict', 'duplicate');
      };
      const { q, config } = await render({ repo, clock });
      expect(repo.lists.size).toBe(1);
      expect(q('todo-error')).toBeNull();
      expect(config().listId).toBe([...repo.lists.values()][0].id);
    });

    it('shows a missing state and recreates the list on demand', async () => {
      const { q, click, repo, config } = await render({
        config: { listId: 'gone', showCompleted: true },
      });
      expect(q('todo-missing')).not.toBeNull();
      expect(repo.calls).not.toContain('createList');
      await click(q('todo-create'));
      expect(repo.calls.filter((c) => c === 'createList')).toHaveLength(1);
      expect(config().listId).toBe([...repo.lists.values()][0].id);
      expect(q('todo-missing')).toBeNull();
      expect(q('todo-new')).not.toBeNull();
    });

    it('shows an error state and retries', async () => {
      const clock = new ManualClock(NOON);
      const repo = new FakeTodoRepository(clock);
      repo.seedList(INSTANCE);
      repo.failNext(new DataError('unavailable', 'down'));
      const { q, click } = await render({ repo, clock });
      expect(q('todo-error')).not.toBeNull();
      await click(q('todo-retry'));
      expect(q('todo-error')).toBeNull();
      expect(q('todo-empty')).not.toBeNull();
    });
  });

  describe('adding', () => {
    it('adds on Enter, clears the field and keeps the focus', async () => {
      const { q, fill, press, titles, repo, settle } = await render();
      const input = q<HTMLInputElement>('todo-new');
      input?.focus();
      fill(input, '  Acheter du pain  ');
      await press(input, 'Enter');
      await settle();
      expect(titles()).toEqual(['Acheter du pain']);
      expect(input?.value).toBe('');
      expect(document.activeElement).toBe(input);
      expect(repo.calls.filter((c) => c === 'create')).toHaveLength(1);
    });

    it('adds with the button and ignores an empty title', async () => {
      const { q, fill, click, titles, repo } = await render();
      await click(q('todo-add'));
      expect(repo.calls).not.toContain('create');
      fill(q<HTMLInputElement>('todo-new'), 'Une tâche');
      await click(q('todo-add'));
      expect(titles()).toEqual(['Une tâche']);
    });

    it('ignores a second submission while the first one is in flight', async () => {
      const { q, fill, press, titles, repo, settle } = await render();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const original = repo.create.bind(repo);
      const create = vi.fn(async (input: Parameters<typeof original>[0]) => {
        await gate;
        return original(input);
      });
      repo.create = create;
      const input = q<HTMLInputElement>('todo-new');
      fill(input, 'Une seule fois');
      await press(input, 'Enter');
      await press(input, 'Enter');
      release();
      await vi.waitFor(async () => {
        await settle();
        expect(titles()).toEqual(['Une seule fois']);
      });
      expect(create).toHaveBeenCalledTimes(1);
    });

    it('keeps text typed while the submission is in flight', async () => {
      const { q, fill, press, repo, settle } = await render();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const original = repo.create.bind(repo);
      repo.create = async (input) => {
        await gate;
        return original(input);
      };
      const input = q<HTMLInputElement>('todo-new');
      fill(input, 'abc');
      await press(input, 'Enter');
      fill(input, 'abcd');
      release();
      await vi.waitFor(() => expect(repo.items).toHaveLength(1));
      await settle();
      expect(input?.value).toBe('abcd');
    });

    it('shows an error and keeps the text when the write fails', async () => {
      const { q, fill, press, repo, settle } = await render();
      const input = q<HTMLInputElement>('todo-new');
      fill(input, 'Échec');
      repo.failNext(new DataError('unavailable', 'down'));
      // The next call is `create` (listTodos only runs after it).
      await press(input, 'Enter');
      await settle();
      expect(q('todo-action-error')).not.toBeNull();
      expect(input?.value).toBe('Échec');
    });
  });

  describe('completing', () => {
    it('checks and unchecks a task, labelled by its title', async () => {
      const { repo, all, click, q, clock } = await render(seeded());
      expect(all('todo-check')[0].getAttribute('aria-label')).toBe('Alpha');
      clock.set('2026-10-21T11:00:00.000Z');
      await click(all('todo-check')[0]);
      const done = repo.items.find((t) => t.title === 'Alpha');
      expect(done?.completedAt).toBe('2026-10-21T11:00:00.000Z');
      // Completed tasks go last, struck through.
      const last = all('todo-row')[2];
      expect(last.querySelector('[data-testid="todo-title"]')?.textContent?.trim()).toBe('Alpha');
      expect(last.querySelector('[data-testid="todo-title"]')?.classList).toContain('line-through');
      expect(q('todo-remaining')?.textContent?.trim()).toBe('2 restantes');
      await click(all('todo-check')[2]);
      expect(repo.items.find((t) => t.title === 'Alpha')?.completedAt).toBeNull();
      expect(q('todo-remaining')?.textContent?.trim()).toBe('3 restantes');
    });

    it('puts an unchecked task at the end of the active ones', async () => {
      const { all, click, titles } = await render(seeded());
      await click(all('todo-check')[0]);
      expect(titles()).toEqual(['Bravo', 'Charlie', 'Alpha']);
      await click(all('todo-check')[2]);
      expect(titles()).toEqual(['Bravo', 'Charlie', 'Alpha']);
      expect(all('todo-check').every((c) => !(c as HTMLInputElement).checked)).toBe(true);
    });

    it('reverts the checkbox when the write fails', async () => {
      const { all, click, q, repo } = await render(seeded());
      repo.failNext(new DataError('unavailable', 'down'));
      const box = all('todo-check')[0] as HTMLInputElement;
      await click(box);
      expect(box.checked).toBe(false);
      expect(q('todo-action-error')).not.toBeNull();
    });

    it('ignores a second click while a write is in flight (checkbox and arrows)', async () => {
      const { all, click, settle, repo } = await render(seeded());
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const originalCompleted = repo.setCompleted.bind(repo);
      repo.setCompleted = async (id, completed) => {
        await gate;
        return originalCompleted(id, completed);
      };
      void click(all('todo-check')[0]);
      await settle();
      const second = all('todo-check')[1] as HTMLInputElement;
      await click(second);
      expect(second.checked).toBe(false);
      await click(all('todo-down')[0]);
      expect(repo.calls.filter((c) => c.startsWith('reorder:'))).toHaveLength(0);
      release();
      await vi.waitFor(() =>
        expect(repo.calls.filter((c) => c.startsWith('setCompleted:'))).toHaveLength(1),
      );
    });

    it('pluralises the counter', async () => {
      const clock = new ManualClock(NOON);
      const repo = new FakeTodoRepository(clock);
      const list = repo.seedList(INSTANCE);
      repo.seed(list.id, 'Seule');
      const { q, click, all } = await render({
        repo,
        clock,
        config: { listId: list.id, showCompleted: true },
      });
      expect(q('todo-remaining')?.textContent?.trim()).toBe('1 restante');
      await click(all('todo-check')[0]);
      expect(q('todo-remaining')?.textContent?.trim()).toBe('0 restante');
    });
  });

  describe('editing', () => {
    it('edits through the button: Enter saves and gives the focus back', async () => {
      const s = seeded();
      const { all, q, click, fill, press, titles, focusedId } = await render(s);
      await click(all('todo-edit')[1]);
      const input = q<HTMLInputElement>('todo-edit-input');
      expect(document.activeElement).toBe(input);
      fill(input, '  Bravo bis ');
      await press(input, 'Enter');
      expect(titles()).toEqual(['Alpha', 'Bravo bis', 'Charlie']);
      expect(q('todo-edit-input')).toBeNull();
      expect(focusedId()).toBe('todo-edit');
      expect(document.activeElement).toBe(all('todo-edit')[1]);
    });

    it('opens on double click', async () => {
      const s = seeded();
      const { all, q, settle } = await render(s);
      all('todo-title')[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await settle();
      expect(q<HTMLInputElement>('todo-edit-input')?.value).toBe('Alpha');
    });

    it('Escape cancels without saving and restores the focus', async () => {
      const s = seeded();
      const { all, q, click, fill, press, titles, repo } = await render(s);
      await click(all('todo-edit')[0]);
      const input = q<HTMLInputElement>('todo-edit-input');
      fill(input, 'Modifié');
      await press(input, 'Escape');
      expect(titles()).toEqual(['Alpha', 'Bravo', 'Charlie']);
      expect(repo.calls.some((c) => c.startsWith('update:'))).toBe(false);
      expect(document.activeElement).toBe(all('todo-edit')[0]);
    });

    it('refuses an empty title and stays in edit mode', async () => {
      const s = seeded();
      const { all, q, click, fill, press, repo } = await render(s);
      await click(all('todo-edit')[0]);
      fill(q<HTMLInputElement>('todo-edit-input'), '   ');
      await press(q('todo-edit-input'), 'Enter');
      expect(q('todo-edit-error')).not.toBeNull();
      expect(q('todo-edit-input')).not.toBeNull();
      expect(repo.calls.some((c) => c.startsWith('update:'))).toBe(false);
    });
  });

  describe('due dates', () => {
    function withDates(clock = new ManualClock(NOON)) {
      const repo = new FakeTodoRepository(clock);
      const list = repo.seedList(INSTANCE);
      repo.seed(list.id, 'Hier', { dueOn: '2026-10-20' });
      repo.seed(list.id, 'Aujourd', { dueOn: '2026-10-21' });
      repo.seed(list.id, 'Demain', { dueOn: '2026-10-22' });
      repo.seed(list.id, 'Noël', { dueOn: '2026-12-25' });
      repo.seed(list.id, 'Sans');
      return { repo, clock, config: { listId: list.id, showCompleted: true } };
    }

    it('shows relative labels and a short French date', async () => {
      const { all } = await render(withDates());
      const labels = all('todo-row').map((row) => {
        const due = row.querySelector('[data-testid="todo-due"]');
        return [due?.getAttribute('data-due'), due?.textContent?.replace(/\s+/g, ' ').trim()];
      });
      expect(labels[0]).toEqual(['overdue', "En retard d'1 jour"]);
      expect(labels[1]).toEqual(['today', "Aujourd'hui"]);
      expect(labels[2]).toEqual(['tomorrow', 'Demain']);
      expect(labels[3][0]).toBe('date');
      expect(labels[3][1]).toMatch(/^25 déc\.? 2026$/);
      expect(labels[4]).toEqual([undefined, undefined]);
    });

    it('counts the days late, and updates the count at midnight', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const clock = new ManualClock('2026-10-21T21:59:50.000Z');
      const repo = new FakeTodoRepository(clock);
      const list = repo.seedList(INSTANCE);
      repo.seed(list.id, 'Vieux', { dueOn: '2026-10-18' });
      const { all, fixture } = await render({
        repo,
        clock,
        config: { listId: list.id, showCompleted: true },
      });
      const text = () => all('todo-due')[0].textContent?.replace(/\s+/g, ' ').trim();
      expect(text()).toBe('En retard de 3 jours');
      clock.set('2026-10-21T22:00:05.000Z');
      await vi.advanceTimersByTimeAsync(15_000);
      fixture.detectChanges();
      expect(text()).toBe('En retard de 4 jours');
    });

    it('styles the overdue label as an alert', async () => {
      const { all } = await render(withDates());
      const overdue = all('todo-due')[0];
      expect(overdue.classList).toContain('text-danger');
    });

    it('does not flag a completed task as overdue', async () => {
      const s = withDates();
      s.repo.items[0] = { ...s.repo.items[0], completedAt: '2026-10-20T08:00:00.000Z' };
      const { all } = await render(s);
      const row = all('todo-row').at(-1);
      expect(row?.querySelector('[data-testid="todo-due"]')?.getAttribute('data-due')).toBe('date');
    });

    it('turns overdue after local midnight without a reload', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const clock = new ManualClock('2026-10-21T21:59:50.000Z'); // 23:59:50 in Paris
      const { all, fixture } = await render(withDates(clock));
      const dueOf = (title: number) =>
        all('todo-row')[title].querySelector('[data-testid="todo-due"]')?.getAttribute('data-due');
      expect(dueOf(1)).toBe('today');
      expect(dueOf(2)).toBe('tomorrow');
      clock.set('2026-10-21T22:00:05.000Z'); // 00:00:05 on the 22nd
      await vi.advanceTimersByTimeAsync(15_000);
      fixture.detectChanges();
      expect(dueOf(1)).toBe('overdue');
      expect(dueOf(2)).toBe('today');
    });

    it('sets a due date from the date input (YYYY-MM-DD)', async () => {
      const s = seeded();
      const { all, fill, settle, repo } = await render(s);
      const input = all('todo-due-input')[0] as HTMLInputElement;
      fill(input, '2026-11-05');
      input.dispatchEvent(new Event('change'));
      await settle();
      expect(repo.items.find((t) => t.title === 'Alpha')?.dueOn).toBe('2026-11-05');
      expect(all('todo-due')[0].getAttribute('data-due')).toBe('date');
    });

    it('does not reset the field while the year is being typed', async () => {
      const s = seeded();
      s.repo.items[0] = { ...s.repo.items[0], dueOn: '2026-11-03' };
      const { all, fill, settle, repo, q } = await render(s);
      const input = all('todo-due-input')[0] as HTMLInputElement;
      input.focus();
      for (const partial of ['0002-11-03', '0020-11-03', '0202-11-03', '2200-01-01']) {
        fill(input, partial);
        input.dispatchEvent(new Event('change'));
        await settle();
        expect(input.value).toBe(partial);
      }
      expect(repo.calls.some((c) => c.startsWith('update:'))).toBe(false);
      expect(q('todo-action-error')).toBeNull();
      fill(input, '2027-11-03');
      input.dispatchEvent(new Event('change'));
      await settle();
      expect(repo.items[0].dueOn).toBe('2027-11-03');
    });

    it('restores the stored value on blur when the typed date was never committed', async () => {
      const s = seeded();
      s.repo.items[0] = { ...s.repo.items[0], dueOn: '2026-11-03' };
      const { all, fill, settle } = await render(s);
      const input = all('todo-due-input')[0] as HTMLInputElement;
      fill(input, '0002-11-03');
      input.dispatchEvent(new Event('change'));
      input.dispatchEvent(new Event('blur'));
      await settle();
      expect(input.value).toBe('2026-11-03');
    });

    it('ignores an empty value caused by partial input (badInput)', async () => {
      const s = seeded();
      s.repo.items[0] = { ...s.repo.items[0], dueOn: '2026-11-03' };
      const { all, fill, settle, repo } = await render(s);
      const input = all('todo-due-input')[0] as HTMLInputElement;
      Object.defineProperty(input, 'validity', { value: { badInput: true } });
      fill(input, '');
      input.dispatchEvent(new Event('change'));
      await settle();
      expect(repo.calls.some((c) => c.startsWith('update:'))).toBe(false);
      expect(repo.items[0].dueOn).toBe('2026-11-03');
    });

    it('clears the due date when the field is emptied without badInput', async () => {
      const s = seeded();
      s.repo.items[0] = { ...s.repo.items[0], dueOn: '2026-11-03' };
      const { all, fill, settle, repo } = await render(s);
      const input = all('todo-due-input')[0] as HTMLInputElement;
      fill(input, '');
      input.dispatchEvent(new Event('change'));
      await settle();
      expect(repo.items[0].dueOn).toBeNull();
    });

    it('says so instead of dropping a date chosen while a write is in flight', async () => {
      const s = seeded();
      const { all, fill, settle, repo, q, click } = await render(s);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const original = repo.setCompleted.bind(repo);
      repo.setCompleted = async (id, completed) => {
        await gate;
        return original(id, completed);
      };
      void click(all('todo-check')[1]);
      await settle();
      const input = all('todo-due-input')[0] as HTMLInputElement;
      fill(input, '2026-11-05');
      input.dispatchEvent(new Event('change'));
      await settle();
      expect(q('todo-action-error')).not.toBeNull();
      expect(repo.calls.some((c) => c.startsWith('update:'))).toBe(false);
      release();
      await vi.waitFor(() => expect(repo.items[1].completedAt).not.toBeNull());
    });

    it('clears the due date with its button', async () => {
      const { all, click, repo } = await render(withDates());
      await click(all('todo-due-clear')[0]);
      expect(repo.items.find((t) => t.title === 'Hier')?.dueOn).toBeNull();
      expect(all('todo-due')).toHaveLength(3);
    });
  });

  describe('completed tasks', () => {
    function withDone() {
      const s = seeded();
      s.repo.items[0] = { ...s.repo.items[0], completedAt: '2026-10-20T08:00:00.000Z' };
      return s;
    }

    it('hides them and persists the preference in the config', async () => {
      const s = withDone();
      const { titles, q, click, updateConfig, config } = await render(s);
      expect(titles()).toEqual(['Bravo', 'Charlie', 'Alpha']);
      await click(q('todo-show-completed'));
      expect(updateConfig).toHaveBeenCalledWith({ listId: s.list.id, showCompleted: false });
      expect(config().showCompleted).toBe(false);
      expect(titles()).toEqual(['Bravo', 'Charlie']);
      await click(q('todo-show-completed'));
      expect(config().showCompleted).toBe(true);
      expect(titles()).toEqual(['Bravo', 'Charlie', 'Alpha']);
    });

    it('starts hidden when the config says so', async () => {
      const s = withDone();
      const { titles, q } = await render({ ...s, config: { ...s.config, showCompleted: false } });
      expect(titles()).toEqual(['Bravo', 'Charlie']);
      expect((q('todo-show-completed') as HTMLInputElement).checked).toBe(false);
    });

    it('clears them after confirmation', async () => {
      const s = withDone();
      const { q, click, titles, repo, focusedId } = await render(s);
      await click(q('todo-clear'));
      expect(q('todo-clear-confirm')?.textContent).toContain('Effacer 1 tâche terminée ?');
      expect(focusedId()).toBe('todo-clear-no');
      await click(q('todo-clear-yes'));
      expect(repo.calls).toContain('clearCompleted');
      expect(titles()).toEqual(['Bravo', 'Charlie']);
      expect(focusedId()).toBe('todo-new');
      expect((q('todo-clear') as HTMLButtonElement).disabled).toBe(true);
    });

    it('keeps them when the confirmation is cancelled', async () => {
      const s = withDone();
      const { q, click, titles, repo, focusedId } = await render(s);
      await click(q('todo-clear'));
      await click(q('todo-clear-no'));
      expect(repo.calls).not.toContain('clearCompleted');
      expect(titles()).toHaveLength(3);
      expect(focusedId()).toBe('todo-clear');
    });

    it('disables the button when nothing is completed', async () => {
      const { q } = await render(seeded());
      expect((q('todo-clear') as HTMLButtonElement).disabled).toBe(true);
    });
  });

  describe('removing', () => {
    it('asks for confirmation inline, then focuses the row that took its place', async () => {
      const s = seeded();
      const { all, q, click, titles, focusedId } = await render(s);
      await click(all('todo-remove')[1]);
      expect(q('todo-confirm')?.textContent).toContain('Supprimer « Bravo » ?');
      expect(q('todo-confirm-no')?.getAttribute('aria-describedby')).toBe(q('todo-confirm')?.id);
      expect(focusedId()).toBe('todo-confirm-no');
      await click(q('todo-confirm-yes'));
      expect(titles()).toEqual(['Alpha', 'Charlie']);
      expect(document.activeElement).toBe(all('todo-remove')[1]);
    });

    it('focuses the previous row after removing the last one', async () => {
      const s = seeded();
      const { all, q, click, titles } = await render(s);
      await click(all('todo-remove')[2]);
      await click(q('todo-confirm-yes'));
      expect(titles()).toEqual(['Alpha', 'Bravo']);
      expect(document.activeElement).toBe(all('todo-remove')[1]);
    });

    it('focuses the field when the list becomes empty', async () => {
      const clock = new ManualClock(NOON);
      const repo = new FakeTodoRepository(clock);
      const list = repo.seedList(INSTANCE);
      repo.seed(list.id, 'Seule');
      const { all, q, click, focusedId } = await render({
        repo,
        clock,
        config: { listId: list.id, showCompleted: true },
      });
      await click(all('todo-remove')[0]);
      await click(q('todo-confirm-yes'));
      expect(q('todo-empty')).not.toBeNull();
      expect(focusedId()).toBe('todo-new');
    });

    it('cancelling gives the focus back to the delete button', async () => {
      const s = seeded();
      const { all, q, click, titles } = await render(s);
      await click(all('todo-remove')[0]);
      await click(q('todo-confirm-no'));
      expect(titles()).toHaveLength(3);
      expect(document.activeElement).toBe(all('todo-remove')[0]);
    });
  });

  describe('reordering', () => {
    it('moves a task down and keeps the focus on the same button', async () => {
      const s = seeded();
      const { all, click, titles } = await render(s);
      await click(all('todo-down')[0]);
      expect(titles()).toEqual(['Bravo', 'Alpha', 'Charlie']);
      expect(document.activeElement).toBe(all('todo-down')[1]);
    });

    it('moves a task up, and switches the focus to the other button at the list end', async () => {
      const s = seeded();
      const { all, click, titles } = await render(s);
      await click(all('todo-up')[1]);
      expect(titles()).toEqual(['Bravo', 'Alpha', 'Charlie']);
      // Bravo is now first: its "up" button is disabled, so the focus lands on "down".
      expect(document.activeElement).toBe(all('todo-down')[0]);
    });

    it('disables the buttons at both ends and only reorders active tasks', async () => {
      const s = seeded();
      s.repo.items[2] = { ...s.repo.items[2], completedAt: '2026-10-20T08:00:00.000Z' };
      const { all, click, repo } = await render(s);
      expect((all('todo-up')[0] as HTMLButtonElement).disabled).toBe(true);
      expect((all('todo-down')[1] as HTMLButtonElement).disabled).toBe(true);
      expect(all('todo-up')).toHaveLength(2);
      await click(all('todo-down')[0]);
      const reorder = repo.calls.find((c) => c.startsWith('reorder:'));
      expect(reorder).toBe(`reorder:${s.b.id},${s.a.id}`);
    });
  });
});
