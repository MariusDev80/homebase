import { ApplicationInitStatus } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideAppI18n } from '../../core/i18n';
import { FakeSettingsRepository } from '../../core/testing/fake-settings.repository';
import { FakeTodoRepository } from '../../core/testing/fake-todo.repository';
import { SYSTEM_TIME_ZONE_READER } from '../../core/time';
import { ManualClock } from '../../core/time/testing/manual-clock';
import { PendingWrites } from '../../core/widgets';
import { CLOCK, DataError, SETTINGS_REPOSITORY, TODO_REPOSITORY } from '../../data';
import type { Todo } from '../../data';
import { TODO_DETAIL_SAVE_DEBOUNCE_MS, TodoDetailComponent } from './todo-detail.component';

// 12:00 on 2026-10-21 in Paris (CEST).
const NOON = '2026-10-21T10:00:00.000Z';
const INSTANCE = 'inst-1';

async function render(over: Partial<Todo> = {}) {
  vi.useFakeTimers();
  const clock = new ManualClock(NOON);
  const repo = new FakeTodoRepository(clock);
  const list = repo.seedList(INSTANCE);
  const todo = repo.seed(list.id, 'Alpha', over);
  TestBed.configureTestingModule({
    providers: [
      provideAppI18n(),
      { provide: TODO_REPOSITORY, useValue: repo },
      { provide: CLOCK, useValue: clock },
      { provide: SETTINGS_REPOSITORY, useValue: new FakeSettingsRepository() },
      { provide: SYSTEM_TIME_ZONE_READER, useValue: () => 'Europe/Paris' },
    ],
  });
  await TestBed.inject(ApplicationInitStatus).donePromise;
  const fixture = TestBed.createComponent(TodoDetailComponent);
  fixture.componentRef.setInput('todo', todo);
  fixture.componentRef.setInput('instanceId', INSTANCE);
  const closed = vi.fn();
  const removed = vi.fn();
  const vanished = vi.fn();
  fixture.componentInstance.closed.subscribe(closed);
  fixture.componentInstance.removed.subscribe(removed);
  fixture.componentInstance.vanished.subscribe(vanished);
  const settle = async (ms = 0) => {
    await vi.advanceTimersByTimeAsync(ms);
    fixture.detectChanges();
  };
  fixture.detectChanges();
  await settle();
  const el = fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement>(id: string) =>
    el.querySelector(`[data-testid="${id}"]`) as T | null;
  const field = <T extends HTMLElement>(id: string): T => {
    const found = q<T>(id);
    if (!found) throw new Error(`${id} not rendered`);
    return found;
  };
  const type = (id: string, value: string) => {
    const target = field<HTMLTextAreaElement>(id);
    target.value = value;
    target.dispatchEvent(new Event('input'));
  };
  const blur = async (id: string) => {
    field(id).dispatchEvent(new Event('blur'));
    await settle();
  };
  const click = async (id: string) => {
    field(id).click();
    await settle();
  };
  const key = (target: HTMLElement, name: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', {
      key: name,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    target.dispatchEvent(event);
    return event;
  };
  const chooseDate = async (value: string) => {
    const input = field<HTMLInputElement>('todo-detail-due');
    input.value = value;
    input.dispatchEvent(new Event('change'));
    await settle();
  };
  const updates = () => repo.calls.filter((c) => c.startsWith('update:'));
  /** Makes the next `update` wait for `release()`. */
  const gate = () => {
    const original = repo.update.bind(repo);
    let release: () => void = () => undefined;
    const waiting = new Promise<void>((resolve) => (release = resolve));
    const spy = vi.spyOn(repo, 'update').mockImplementationOnce(async (id, changes) => {
      await waiting;
      return original(id, changes);
    });
    return { release, spy };
  };
  return {
    fixture,
    el,
    repo,
    todo,
    closed,
    removed,
    vanished,
    settle,
    q,
    field,
    type,
    blur,
    click,
    key,
    chooseDate,
    updates,
    gate,
  };
}

describe('TodoDetailComponent', () => {
  afterEach(() => vi.useRealTimers());

  it('shows the initial values and focuses the title with the caret at the end', async () => {
    const { field, q } = await render({
      description: 'Une note',
      dueOn: '2026-11-03',
      important: true,
      completedAt: '2026-10-20T08:00:00.000Z',
    });
    expect(field<HTMLTextAreaElement>('todo-detail-title').value).toBe('Alpha');
    expect(field<HTMLTextAreaElement>('todo-detail-description').value).toBe('Une note');
    expect(field<HTMLInputElement>('todo-detail-due').value).toBe('2026-11-03');
    expect(field<HTMLInputElement>('todo-detail-important').checked).toBe(true);
    expect(document.activeElement).toBe(field('todo-detail-title'));
    expect(field<HTMLTextAreaElement>('todo-detail-title').selectionStart).toBe(5);
    expect(q('todo-detail')?.getAttribute('aria-label')).toBe('Détails de « Alpha »');
    expect(q('todo-detail-created')?.textContent).toContain('Créée le 1 janv. 2026');
    expect(q('todo-detail-completed')?.textContent).toContain('Terminée le 20 oct. 2026');
  });

  it('has exactly one native date input, labelled, and no completed line when active', async () => {
    const { el, q, field } = await render();
    expect(el.querySelectorAll('input[type="date"]')).toHaveLength(1);
    const input = field<HTMLInputElement>('todo-detail-due');
    expect(input.min).toBe('1900-01-01');
    expect(input.max).toBe('2199-12-31');
    expect(el.querySelector(`label[for="${input.id}"]`)).not.toBeNull();
    expect(q('todo-detail-completed')).toBeNull();
  });

  describe('text fields', () => {
    it('writes the title once, 800 ms after the last keystroke', async () => {
      const { type, settle, repo, updates } = await render();
      type('todo-detail-title', 'Be');
      await settle(TODO_DETAIL_SAVE_DEBOUNCE_MS - 1);
      type('todo-detail-title', 'Beta');
      await settle(TODO_DETAIL_SAVE_DEBOUNCE_MS - 1);
      expect(updates()).toHaveLength(0);
      await settle(1);
      expect(updates()).toHaveLength(1);
      expect(repo.items[0].title).toBe('Beta');
    });

    it('writes at once on blur and sends only what differs from the saved todo', async () => {
      const { type, blur, repo, updates, settle } = await render({ description: 'Même' });
      const spy = vi.spyOn(repo, 'update');
      type('todo-detail-description', 'Même');
      type('todo-detail-title', '  Alpha ');
      await blur('todo-detail-title');
      expect(updates()).toHaveLength(0);
      type('todo-detail-description', 'Autre');
      await blur('todo-detail-description');
      expect(spy).toHaveBeenCalledExactlyOnceWith(repo.items[0].id, { description: 'Autre' });
      await settle(TODO_DETAIL_SAVE_DEBOUNCE_MS);
      expect(updates()).toHaveLength(1);
    });

    it.each([
      ['Enter', {}],
      ['Enter', { shiftKey: true }],
    ])('saves on %s %j in the title without a line break', async (name, init) => {
      const { type, key, field, settle, repo } = await render();
      type('todo-detail-title', 'Gamma');
      const event = key(field('todo-detail-title'), name, init);
      await settle();
      expect(event.defaultPrevented).toBe(true);
      expect(repo.items[0].title).toBe('Gamma');
    });

    it('ignores Enter while composing', async () => {
      const { type, key, field, settle, updates } = await render();
      type('todo-detail-title', 'Gamma');
      const event = key(field('todo-detail-title'), 'Enter', { isComposing: true });
      await settle();
      expect(event.defaultPrevented).toBe(false);
      expect(updates()).toHaveLength(0);
    });

    it('turns pasted line breaks into spaces', async () => {
      const { type, field } = await render();
      type('todo-detail-title', 'Une\nligne\nde plus');
      expect(field<HTMLTextAreaElement>('todo-detail-title').value).toBe('Une ligne de plus');
    });

    it('lets Enter insert a line break in the description', async () => {
      const { type, key, field, settle, repo, blur } = await render();
      const description = field<HTMLTextAreaElement>('todo-detail-description');
      const event = key(description, 'Enter');
      expect(event.defaultPrevented).toBe(false);
      type('todo-detail-description', 'a\nb');
      await blur('todo-detail-description');
      await settle();
      expect(repo.items[0].description).toBe('a\nb');
    });

    it('does not write an empty title, shows the error, and still writes the description', async () => {
      const { type, blur, q, repo, updates, field } = await render();
      type('todo-detail-title', '   ');
      type('todo-detail-description', 'Texte');
      await blur('todo-detail-description');
      expect(q('todo-detail-title-error')?.textContent).toContain('de 1 à 500 caractères');
      expect(field('todo-detail-title').getAttribute('aria-invalid')).toBe('true');
      expect(updates()).toHaveLength(1);
      expect(repo.items[0]).toMatchObject({ title: 'Alpha', description: 'Texte' });
    });

    it('shows a description with markup as text', async () => {
      const { el, field } = await render({ description: '<img src=x onerror="alert(1)">' });
      expect(field<HTMLTextAreaElement>('todo-detail-description').value).toBe(
        '<img src=x onerror="alert(1)">',
      );
      expect(el.querySelector('img')).toBeNull();
    });
  });

  describe('important', () => {
    it('writes { important: true }', async () => {
      const { click, repo } = await render();
      const spy = vi.spyOn(repo, 'update');
      await click('todo-detail-important');
      expect(spy).toHaveBeenCalledExactlyOnceWith(repo.items[0].id, { important: true });
      expect(repo.items[0].important).toBe(true);
    });
  });

  describe('due date', () => {
    it('writes a valid date', async () => {
      const { chooseDate, repo, q } = await render();
      const spy = vi.spyOn(repo, 'update');
      await chooseDate('2026-11-03');
      expect(spy).toHaveBeenCalledExactlyOnceWith(repo.items[0].id, { dueOn: '2026-11-03' });
      expect(q('todo-detail-due-label')?.textContent).toContain('3 nov.');
      expect(q('todo-detail-due-clear')).not.toBeNull();
    });

    it('ignores intermediate years, invalid dates and partial input', async () => {
      const { chooseDate, field, updates } = await render();
      await chooseDate('0002-11-03');
      await chooseDate('2026-02-31');
      await chooseDate('2300-01-01');
      const input = field<HTMLInputElement>('todo-detail-due');
      Object.defineProperty(input, 'validity', { value: { badInput: true } });
      await chooseDate('');
      expect(updates()).toHaveLength(0);
    });

    it('puts the saved value back on blur after a partial input', async () => {
      const { chooseDate, field, blur, settle } = await render({ dueOn: '2026-11-03' });
      const input = field<HTMLInputElement>('todo-detail-due');
      input.value = '0002-11-03';
      input.dispatchEvent(new Event('change'));
      await blur('todo-detail-due');
      await settle();
      expect(input.value).toBe('2026-11-03');
      await chooseDate('');
      expect(field<HTMLInputElement>('todo-detail-due').value).toBe('');
    });

    it('puts the wanted value back on blur while the write is in progress', async () => {
      const { chooseDate, field, blur, gate, settle } = await render({ dueOn: '2026-11-03' });
      const { release } = gate();
      await chooseDate('2026-12-01');
      const input = field<HTMLInputElement>('todo-detail-due');
      input.value = '0002-12-01';
      await blur('todo-detail-due');
      expect(input.value).toBe('2026-12-01');
      release();
      await settle();
      expect(input.value).toBe('2026-12-01');
    });

    it('clears the due date and moves the focus to the field', async () => {
      const { click, repo, q, field, settle } = await render({ dueOn: '2026-11-03' });
      const spy = vi.spyOn(repo, 'update');
      await click('todo-detail-due-clear');
      await settle();
      expect(spy).toHaveBeenCalledExactlyOnceWith(repo.items[0].id, { dueOn: null, rrule: null });
      expect(q('todo-detail-due-clear')).toBeNull();
      expect(document.activeElement).toBe(field('todo-detail-due'));
    });

    it('labels an overdue date with the icon and the number of days', async () => {
      const { q } = await render({ dueOn: '2026-10-19' });
      const label = q('todo-detail-due-label');
      expect(label?.textContent).toContain('En retard de 2 jours');
      expect(label?.querySelector('.pi-exclamation-circle')).not.toBeNull();
    });
  });

  describe('write loop', () => {
    it('picks up a choice made during a write in the same loop', async () => {
      const { click, chooseDate, gate, settle, repo, updates } = await render();
      const { release, spy } = gate();
      await chooseDate('2026-11-03');
      await click('todo-detail-important');
      expect(spy).toHaveBeenCalledOnce();
      release();
      await settle();
      expect(updates()).toHaveLength(2);
      expect(repo.items[0]).toMatchObject({ dueOn: '2026-11-03', important: true });
    });

    it('gives up a failed discrete change, realigns the control, and retries the text later', async () => {
      const { click, type, blur, settle, repo, field, updates, q } = await render();
      repo.failNext(new DataError('busy', 'boom'));
      await click('todo-detail-important');
      await settle();
      expect(updates()).toHaveLength(1);
      expect(field<HTMLInputElement>('todo-detail-important').checked).toBe(false);
      expect(q('todo-detail-error')).not.toBeNull();
      await settle(5000);
      expect(updates()).toHaveLength(1);
      type('todo-detail-title', 'Beta');
      await blur('todo-detail-title');
      expect(updates()).toHaveLength(2);
      expect(repo.items[0]).toMatchObject({ title: 'Beta', important: false });
    });

    it('keeps the text after a failed write and retries it on the next keystroke', async () => {
      const { type, blur, settle, repo, updates } = await render();
      type('todo-detail-title', 'Beta');
      repo.failNext(new DataError('busy', 'boom'));
      await blur('todo-detail-title');
      expect(repo.items[0].title).toBe('Alpha');
      type('todo-detail-title', 'Betas');
      await settle(TODO_DETAIL_SAVE_DEBOUNCE_MS);
      expect(updates()).toHaveLength(2);
      expect(repo.items[0].title).toBe('Betas');
    });
  });

  describe('Back', () => {
    it('waits for the write, then emits closed', async () => {
      const { type, click, gate, settle, closed, repo } = await render();
      const { release } = gate();
      type('todo-detail-title', 'Beta');
      void click('todo-detail-back');
      await settle();
      expect(closed).not.toHaveBeenCalled();
      release();
      await settle();
      expect(repo.items[0].title).toBe('Beta');
      expect(closed).toHaveBeenCalledOnce();
    });

    it('closes at once when nothing is pending', async () => {
      const { click, closed, updates } = await render();
      await click('todo-detail-back');
      expect(closed).toHaveBeenCalledOnce();
      expect(updates()).toHaveLength(0);
    });

    it('closes without writing an invalid title and keeps the saved one', async () => {
      const { type, click, closed, repo } = await render();
      type('todo-detail-title', '  ');
      await click('todo-detail-back');
      expect(closed).toHaveBeenCalledOnce();
      expect(repo.items[0].title).toBe('Alpha');
    });

    it('stays open with a message after a failure; a second Back abandons, and destruction writes nothing', async () => {
      const { type, click, repo, closed, q, updates, fixture, settle } = await render();
      type('todo-detail-title', 'Beta');
      repo.failNext(new DataError('busy', 'boom'));
      await click('todo-detail-back');
      expect(closed).not.toHaveBeenCalled();
      expect(q('todo-detail-error')?.textContent).toContain('appuyez de nouveau sur Retour');
      expect(updates()).toHaveLength(1);
      await click('todo-detail-back');
      expect(closed).toHaveBeenCalledOnce();
      fixture.destroy();
      await settle(TODO_DETAIL_SAVE_DEBOUNCE_MS * 2);
      expect(updates()).toHaveLength(1);
      expect(repo.items[0].title).toBe('Alpha');
    });

    it('behaves like Back on Escape, except while composing', async () => {
      const { key, field, settle, closed } = await render();
      key(field('todo-detail-title'), 'Escape', { isComposing: true });
      await settle();
      expect(closed).not.toHaveBeenCalled();
      key(field('todo-detail-title'), 'Escape');
      await settle();
      expect(closed).toHaveBeenCalledOnce();
    });
  });

  describe('removal', () => {
    it('asks for confirmation with the focus on Cancel, and Escape cancels it without closing', async () => {
      const { click, q, key, field, settle, closed } = await render();
      await click('todo-detail-remove');
      expect(q('todo-detail-confirm')).not.toBeNull();
      expect(document.activeElement).toBe(q('todo-detail-confirm-no'));
      key(field('todo-detail-confirm-no'), 'Escape');
      await settle();
      expect(q('todo-detail-confirm')).toBeNull();
      expect(document.activeElement).toBe(q('todo-detail-remove'));
      expect(closed).not.toHaveBeenCalled();
    });

    it('removes the todo, emits removed, and writes nothing afterwards', async () => {
      const { click, type, repo, removed, fixture, settle, updates } = await render();
      await click('todo-detail-remove');
      await click('todo-detail-confirm-yes');
      expect(repo.items).toHaveLength(0);
      expect(removed).toHaveBeenCalledOnce();
      type('todo-detail-title', 'Beta');
      fixture.destroy();
      await settle(TODO_DETAIL_SAVE_DEBOUNCE_MS * 2);
      expect(updates()).toHaveLength(0);
    });

    it('stays open with a message when the removal fails', async () => {
      const { click, repo, removed, q } = await render();
      await click('todo-detail-remove');
      repo.failNext(new DataError('busy', 'boom'));
      await click('todo-detail-confirm-yes');
      expect(removed).not.toHaveBeenCalled();
      expect(q('todo-detail-error')).not.toBeNull();
      expect(q('todo-detail-confirm')).toBeNull();
    });
  });

  describe('removal safeguards and status', () => {
    const gatedRemove = (repo: FakeTodoRepository) => {
      const original = repo.remove.bind(repo);
      let release: () => void = () => undefined;
      const waiting = new Promise<void>((resolve) => (release = resolve));
      const spy = vi.spyOn(repo, 'remove').mockImplementationOnce(async (id) => {
        await waiting;
        return original(id);
      });
      return { release, spy };
    };

    it('calls remove once and emits removed once on a double click on Delete', async () => {
      const { click, repo, removed, settle } = await render();
      const { release, spy } = gatedRemove(repo);
      await click('todo-detail-remove');
      await click('todo-detail-confirm-yes');
      await click('todo-detail-confirm-yes');
      release();
      await settle();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(removed).toHaveBeenCalledTimes(1);
    });

    it('ignores typing, Back and Escape during the removal: no write, no second exit', async () => {
      const { fixture, click, type, field, key, repo, removed, vanished, closed, settle, updates } =
        await render();
      const { release } = gatedRemove(repo);
      await click('todo-detail-remove');
      await click('todo-detail-confirm-yes');
      type('todo-detail-title', 'Beta');
      await fixture.componentInstance['back']();
      key(field('todo-detail'), 'Escape');
      await settle(TODO_DETAIL_SAVE_DEBOUNCE_MS * 2);
      release();
      await settle();
      expect(updates()).toHaveLength(0);
      expect(removed).toHaveBeenCalledTimes(1);
      expect(vanished).not.toHaveBeenCalled();
      expect(closed).not.toHaveBeenCalled();
    });

    it('keeps the status container permanent, as a status region', async () => {
      const { q, type, blur } = await render();
      expect(q('todo-detail-status')?.getAttribute('role')).toBe('status');
      type('todo-detail-title', 'Beta');
      await blur('todo-detail-title');
      expect(q('todo-detail-status')?.getAttribute('role')).toBe('status');
      expect(q('todo-detail-status')?.textContent).toContain('Enregistré');
    });

    it('clears a removal error as soon as the user types or chooses', async () => {
      const { click, repo, q, type, settle } = await render();
      await click('todo-detail-remove');
      repo.failNext(new DataError('busy', 'boom'));
      await click('todo-detail-confirm-yes');
      expect(q('todo-detail-error')).not.toBeNull();
      type('todo-detail-title', 'Beta');
      await settle();
      expect(q('todo-detail-error')).toBeNull();
      await click('todo-detail-remove');
      repo.failNext(new DataError('busy', 'boom'));
      await click('todo-detail-confirm-yes');
      expect(q('todo-detail-error')).not.toBeNull();
      await click('todo-detail-important');
      expect(q('todo-detail-error')).toBeNull();
    });

    it('says "the change" when only a discrete choice failed, and keeps the old message for texts', async () => {
      const { click, repo, q, type, blur } = await render();
      repo.failNext(new DataError('busy', 'boom'));
      await click('todo-detail-important');
      expect(q('todo-detail-error')?.textContent).toContain(
        "La modification n'a pas pu être enregistrée.",
      );
      expect(q('todo-detail-error')?.textContent).not.toContain('Retour');
      repo.failNext(new DataError('busy', 'boom'));
      type('todo-detail-title', 'Beta');
      await blur('todo-detail-title');
      expect(q('todo-detail-error')?.textContent).toContain('appuyez de nouveau sur Retour');
    });
  });

  describe('vanished todo', () => {
    it('emits vanished on not_found; the destruction then writes nothing', async () => {
      const { type, blur, repo, vanished, closed, fixture, settle, updates } = await render();
      type('todo-detail-title', 'Beta');
      repo.failNext(new DataError('not_found', 'gone'));
      await blur('todo-detail-title');
      expect(vanished).toHaveBeenCalledOnce();
      expect(closed).not.toHaveBeenCalled();
      fixture.destroy();
      await settle(TODO_DETAIL_SAVE_DEBOUNCE_MS * 2);
      expect(updates()).toHaveLength(1);
    });
  });

  describe('destruction and PendingWrites', () => {
    it('sends the pending text when the sheet is destroyed, without emitting anything', async () => {
      const { type, fixture, settle, repo, closed, vanished, removed } = await render();
      type('todo-detail-title', 'Beta');
      fixture.destroy();
      await settle();
      expect(repo.items[0].title).toBe('Beta');
      expect(closed).not.toHaveBeenCalled();
      expect(vanished).not.toHaveBeenCalled();
      expect(removed).not.toHaveBeenCalled();
    });

    it('registers a flusher that writes the draft before an import or a restoration', async () => {
      const { type, repo, settle } = await render();
      const pendingWrites = TestBed.inject(PendingWrites);
      expect(pendingWrites.count).toBe(1);
      type('todo-detail-description', 'Brouillon');
      await pendingWrites.flushAll();
      await settle();
      expect(repo.items[0].description).toBe('Brouillon');
    });

    it('unregisters its flusher once destroyed', async () => {
      const { fixture, settle } = await render();
      fixture.destroy();
      await settle();
      expect(TestBed.inject(PendingWrites).count).toBe(0);
    });
  });

  describe('repetition', () => {
    const choose = async (
      f: <T extends HTMLElement>(id: string) => T,
      settle: () => Promise<void>,
      value: string,
    ) => {
      const select = f<HTMLSelectElement>('todo-detail-repeat');
      select.value = value;
      select.dispatchEvent(new Event('change'));
      await settle();
    };
    const setInterval = async (
      f: <T extends HTMLElement>(id: string) => T,
      settle: () => Promise<void>,
      value: string,
    ) => {
      const input = f<HTMLInputElement>('todo-detail-interval');
      input.value = value;
      input.dispatchEvent(new Event('change'));
      await settle();
    };

    it('disables the selector without a due date and explains why', async () => {
      const { field, q } = await render();
      expect(field<HTMLSelectElement>('todo-detail-repeat').disabled).toBe(true);
      expect(q('todo-detail-repeat-help')?.textContent).toContain(
        "Choisissez d'abord une échéance.",
      );
    });

    it('writes a weekly rule, then an interval of 2', async () => {
      const { field, settle, repo, q } = await render({ dueOn: '2026-11-03' });
      const spy = vi.spyOn(repo, 'update');
      expect(field<HTMLSelectElement>('todo-detail-repeat').disabled).toBe(false);
      expect(q('todo-detail-interval')).toBeNull();
      await choose(field, settle, 'WEEKLY');
      expect(spy).toHaveBeenLastCalledWith(repo.items[0].id, { rrule: 'FREQ=WEEKLY' });
      await setInterval(field, settle, '2');
      expect(spy).toHaveBeenLastCalledWith(repo.items[0].id, { rrule: 'FREQ=WEEKLY;INTERVAL=2' });
      expect(q('todo-detail-repeat-summary')?.textContent).toContain('Toutes les 2 semaines.');
      expect(q('todo-detail-repeat-summary')?.textContent).toContain('elle reste dans la liste');
    });

    it('refuses 0 and 53 weeks, writes nothing and restores the value on blur', async () => {
      const { field, settle, updates, q } = await render({
        dueOn: '2026-11-03',
        rrule: 'FREQ=WEEKLY',
      });
      await setInterval(field, settle, '0');
      expect(q('todo-detail-interval-error')?.textContent).toContain('de 1 à 52');
      expect(field('todo-detail-interval').getAttribute('aria-invalid')).toBe('true');
      await setInterval(field, settle, '53');
      expect(updates()).toHaveLength(0);
      field('todo-detail-interval').dispatchEvent(new Event('blur'));
      await settle();
      expect(field<HTMLInputElement>('todo-detail-interval').value).toBe('1');
      // The explanation stays after the value was put back, until the next input.
      expect(q('todo-detail-interval-error')).not.toBeNull();
      field('todo-detail-interval').dispatchEvent(new Event('input'));
      await settle();
      expect(q('todo-detail-interval-error')).toBeNull();
    });

    it('includes the unit in the accessible description of the interval', async () => {
      const { field, el } = await render({ dueOn: '2026-11-03', rrule: 'FREQ=WEEKLY' });
      const ids = field('todo-detail-interval').getAttribute('aria-describedby') ?? '';
      expect(el.querySelector('#' + ids.split(' ')[0])?.textContent).toContain('semaine(s)');
    });

    it('resets the interval to 1 and unticks "last day" when the frequency changes', async () => {
      const { field, settle, repo } = await render({
        dueOn: '2026-01-31',
        rrule: 'FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=-1',
      });
      const spy = vi.spyOn(repo, 'update');
      await choose(field, settle, 'WEEKLY');
      expect(spy).toHaveBeenLastCalledWith(repo.items[0].id, { rrule: 'FREQ=WEEKLY' });
      await choose(field, settle, 'MONTHLY');
      expect(spy).toHaveBeenLastCalledWith(repo.items[0].id, { rrule: 'FREQ=MONTHLY' });
    });

    describe('choices made while a write is in flight', () => {
      it('normalises the last-day rule against the in-flight rule (A)', async () => {
        const { field, settle, chooseDate, gate, repo } = await render({
          dueOn: '2026-01-31',
          rrule: 'FREQ=MONTHLY',
        });
        const { release } = gate();
        field('todo-detail-monthday-last').click();
        await settle();
        await chooseDate('2026-01-15');
        release();
        await settle();
        expect(repo.items[0]).toMatchObject({ dueOn: '2026-01-15', rrule: 'FREQ=MONTHLY' });
      });

      it('keeps the last-day choice made on an in-flight last-day due date (B)', async () => {
        const { field, settle, chooseDate, gate, repo } = await render({
          dueOn: '2026-01-15',
          rrule: 'FREQ=MONTHLY',
        });
        const { release } = gate();
        await chooseDate('2026-01-31');
        field('todo-detail-monthday-last').click();
        await settle();
        release();
        await settle();
        expect(repo.items[0]).toMatchObject({
          dueOn: '2026-01-31',
          rrule: 'FREQ=MONTHLY;BYMONTHDAY=-1',
        });
      });

      it('does not bring the rule back when the due date is cleared then set again', async () => {
        const { click, settle, chooseDate, gate, repo } = await render({
          dueOn: '2026-01-31',
          rrule: 'FREQ=MONTHLY;BYMONTHDAY=-1',
        });
        const { release } = gate();
        await click('todo-detail-due-clear');
        await chooseDate('2026-01-15');
        release();
        await settle();
        expect(repo.items[0]).toMatchObject({ dueOn: '2026-01-15', rrule: null });
      });
    });

    it('offers the day-of-month choice only on a last day, and writes the last-day rule', async () => {
      const first = await render({ dueOn: '2026-11-15', rrule: 'FREQ=MONTHLY' });
      expect(first.q('todo-detail-monthday')).toBeNull();
      TestBed.resetTestingModule();
      const { field, q, settle, repo } = await render({
        dueOn: '2026-11-30',
        rrule: 'FREQ=MONTHLY',
      });
      expect(q('todo-detail-monthday')).not.toBeNull();
      expect(field<HTMLInputElement>('todo-detail-monthday-day').checked).toBe(true);
      expect(q('todo-detail-monthday')?.textContent).toContain('Le 30 de chaque mois');
      const spy = vi.spyOn(repo, 'update');
      field('todo-detail-monthday-last').click();
      await settle();
      expect(spy).toHaveBeenCalledExactlyOnceWith(repo.items[0].id, {
        rrule: 'FREQ=MONTHLY;BYMONTHDAY=-1',
      });
    });

    it('rewrites a last-day rule in the same write when the due date moves to another day', async () => {
      const { chooseDate, repo } = await render({
        dueOn: '2026-01-31',
        rrule: 'FREQ=MONTHLY;BYMONTHDAY=-1',
      });
      const spy = vi.spyOn(repo, 'update');
      await chooseDate('2026-01-15');
      expect(spy).toHaveBeenCalledExactlyOnceWith(repo.items[0].id, {
        dueOn: '2026-01-15',
        rrule: 'FREQ=MONTHLY',
      });
    });

    it('notes skipped months (day 30) and skipped years (29 February)', async () => {
      const month = await render({ dueOn: '2026-01-30', rrule: 'FREQ=MONTHLY' });
      expect(month.q('todo-detail-repeat-note')?.textContent).toContain(
        "Les mois qui n'ont pas de 30 sont sautés.",
      );
      TestBed.resetTestingModule();
      const year = await render({ dueOn: '2028-02-29', rrule: 'FREQ=YEARLY' });
      expect(year.q('todo-detail-repeat-note')?.textContent).toContain(
        'Les années non bissextiles sont sautées.',
      );
      TestBed.resetTestingModule();
      const none = await render({ dueOn: '2026-01-15', rrule: 'FREQ=MONTHLY' });
      expect(none.q('todo-detail-repeat-note')).toBeNull();
    });

    it('clears the rule with the due date in one write and says so', async () => {
      const { field, click, repo, q } = await render({ dueOn: '2026-11-03', rrule: 'FREQ=DAILY' });
      const spy = vi.spyOn(repo, 'update');
      await click('todo-detail-due-clear');
      expect(spy).toHaveBeenCalledExactlyOnceWith(repo.items[0].id, { dueOn: null, rrule: null });
      expect(field<HTMLSelectElement>('todo-detail-repeat').value).toBe('none');
      expect(q('todo-detail-repeat-cleared')?.textContent).toContain(
        'Échéance effacée : la répétition est retirée.',
      );
    });

    it('selects the disabled "unrecognised" option for an unknown rule and keeps it', async () => {
      const { field, updates } = await render({ dueOn: '2026-11-03', rrule: 'FREQ=HOURLY' });
      const select = field<HTMLSelectElement>('todo-detail-repeat');
      expect(select.value).toBe('other');
      expect(select.selectedOptions[0].disabled).toBe(true);
      expect(updates()).toHaveLength(0);
    });

    it('removes the repetition with "Ne se répète pas"', async () => {
      const { field, settle, repo } = await render({ dueOn: '2026-11-03', rrule: 'FREQ=DAILY' });
      const spy = vi.spyOn(repo, 'update');
      await choose(field, settle, 'none');
      expect(spy).toHaveBeenCalledExactlyOnceWith(repo.items[0].id, { rrule: null });
    });

    it('realigns the form on the saved rule when the write fails', async () => {
      const { field, settle, repo } = await render({ dueOn: '2026-11-03' });
      repo.failNext(new DataError('busy', 'boom'));
      await choose(field, settle, 'WEEKLY');
      expect(field<HTMLSelectElement>('todo-detail-repeat').value).toBe('none');
      expect(repo.items[0].rrule).toBeNull();
    });

    it('realigns the interval and the day-of-month radios after a failed write', async () => {
      const { field, settle, repo } = await render({ dueOn: '2026-11-30', rrule: 'FREQ=MONTHLY' });
      repo.failNext(new DataError('busy', 'boom'));
      field('todo-detail-monthday-last').click();
      await settle();
      expect(field<HTMLInputElement>('todo-detail-monthday-day').checked).toBe(true);
      expect(field<HTMLInputElement>('todo-detail-monthday-last').checked).toBe(false);
      repo.failNext(new DataError('busy', 'boom'));
      const input = field<HTMLInputElement>('todo-detail-interval');
      input.value = '4';
      input.dispatchEvent(new Event('change'));
      await settle();
      expect(field<HTMLInputElement>('todo-detail-interval').value).toBe('1');
    });
  });
});
