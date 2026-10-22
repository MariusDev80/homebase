import { ApplicationInitStatus, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideAppI18n } from '../../core/i18n';
import { FakeNoteRepository } from '../../core/testing/fake-note.repository';
import { PendingWrites, WIDGET_CONTEXT } from '../../core/widgets';
import type { WidgetContext } from '../../core/widgets';
import { DataError, NOTE_REPOSITORY } from '../../data';
import { NOTES_SAVE_DEBOUNCE_MS, NotesComponent } from './notes.component';
import type { NotesConfig } from './notes.config';

async function render(
  initial: NotesConfig = { noteId: null },
  repo = new FakeNoteRepository(),
  failUpdateConfig = false,
) {
  const config = signal<NotesConfig>(initial);
  const updateConfig = vi.fn((next: NotesConfig): Promise<void> => {
    if (failUpdateConfig) return Promise.reject(new Error('config write failed'));
    config.set(next);
    return Promise.resolve();
  });
  const ctx: WidgetContext<NotesConfig> = {
    instanceId: 'inst-1',
    type: 'notes',
    config,
    size: signal({ w: 4, h: 3 }),
    permissions: new Set(),
    updateConfig,
  };
  TestBed.configureTestingModule({
    providers: [
      provideAppI18n(),
      { provide: WIDGET_CONTEXT, useValue: ctx },
      { provide: NOTE_REPOSITORY, useValue: repo },
    ],
  });
  await TestBed.inject(ApplicationInitStatus).donePromise;
  const fixture = TestBed.createComponent(NotesComponent);
  const settle = async () => {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
    else await fixture.whenStable();
    fixture.detectChanges();
  };
  await settle();
  const el = fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement>(testId: string) =>
    el.querySelector(`[data-testid="${testId}"]`) as T | null;
  const type = (testId: 'notes-title' | 'notes-body', value: string) => {
    const field = q<HTMLInputElement | HTMLTextAreaElement>(testId);
    if (!field) throw new Error(`${testId} not rendered`);
    field.value = value;
    field.dispatchEvent(new Event('input'));
  };
  return { fixture, el, repo, config, updateConfig, settle, q, type };
}

describe('NotesComponent', () => {
  afterEach(() => vi.useRealTimers());

  it('creates an empty note on first display and stores its id in the config', async () => {
    const { repo, updateConfig, q } = await render();
    expect(repo.calls).toEqual(['create']);
    expect(repo.notes.get('note-1')?.widgetInstanceId).toBe('inst-1');
    expect(updateConfig).toHaveBeenCalledExactlyOnceWith({ noteId: 'note-1' });
    expect(q<HTMLInputElement>('notes-title')?.value).toBe('');
    expect(q<HTMLTextAreaElement>('notes-body')?.value).toBe('');
  });

  it('does not create a note when the config already references one', async () => {
    const repo = new FakeNoteRepository();
    repo.seed({ id: 'n-1', title: 'Courses', body: 'Lait' });
    const { q, updateConfig } = await render({ noteId: 'n-1' }, repo);
    expect(updateConfig).not.toHaveBeenCalled();
    expect(q<HTMLInputElement>('notes-title')?.value).toBe('Courses');
    expect(q<HTMLTextAreaElement>('notes-body')?.value).toBe('Lait');
  });

  it('shows a message and a create button when the note no longer exists', async () => {
    const { el, repo, config, settle, q } = await render({ noteId: 'gone' });
    expect(q('notes-missing')?.textContent).toContain('Cette note est introuvable.');
    expect(q('notes-title')).toBeNull();
    q('notes-create')?.click();
    await settle();
    expect(repo.notes.has('note-1')).toBe(true);
    expect(config()).toEqual({ noteId: 'note-1' });
    expect(q('notes-missing')).toBeNull();
    expect(el.querySelector('textarea')).not.toBeNull();
  });

  it('removes the new note and shows an error when the config cannot be stored', async () => {
    const { repo, q } = await render({ noteId: null }, new FakeNoteRepository(), true);
    expect(repo.calls).toEqual(['create', 'remove:note-1']);
    expect(repo.notes.size).toBe(0);
    expect(q('notes-error')).not.toBeNull();
  });

  it('creates only one note on a double click of the create button', async () => {
    const { repo, q, settle } = await render({ noteId: 'gone' });
    const button = q('notes-create');
    button?.click();
    button?.click();
    await settle();
    expect(repo.calls.filter((c) => c === 'create')).toHaveLength(1);
  });

  it('does nothing when destroyed while the note is loading', async () => {
    const repo = new FakeNoteRepository();
    const note = repo.seed({ id: 'n-1', title: 'T' });
    let release: (value: typeof note) => void = () => undefined;
    repo.get = () => new Promise((resolve) => (release = resolve));
    const { fixture, updateConfig } = await render({ noteId: 'n-1' }, repo);
    fixture.destroy();
    release(note);
    await Promise.resolve();
    await Promise.resolve();
    expect(updateConfig).not.toHaveBeenCalled();
    expect(repo.calls.filter((c) => c.startsWith('update'))).toEqual([]);
  });

  it('saves after the debounce, once, with the latest text', async () => {
    const { repo, settle, type, q } = await render();
    vi.useFakeTimers();
    type('notes-body', 'a');
    await vi.advanceTimersByTimeAsync(NOTES_SAVE_DEBOUNCE_MS - 100);
    type('notes-body', 'ab');
    type('notes-title', 'Titre');
    await vi.advanceTimersByTimeAsync(NOTES_SAVE_DEBOUNCE_MS - 100);
    expect(repo.calls.filter((c) => c.startsWith('update'))).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    expect(repo.calls.filter((c) => c.startsWith('update'))).toEqual(['update:note-1']);
    expect(repo.notes.get('note-1')).toMatchObject({ title: 'Titre', body: 'ab' });
    expect(q('notes-save-state')?.textContent).toContain('Enregistré');
  });

  it('shows "Enregistrement…" while saving', async () => {
    const { repo, settle, type, q } = await render();
    let release: () => void = () => undefined;
    const original = repo.update.bind(repo);
    repo.update = (id, title, body) =>
      new Promise((resolve) => {
        release = () => resolve(original(id, title, body));
      });
    vi.useFakeTimers();
    type('notes-body', 'x');
    await vi.advanceTimersByTimeAsync(NOTES_SAVE_DEBOUNCE_MS);
    await settle();
    expect(q('notes-save-state')?.textContent).toContain('Enregistrement');
    release();
    await vi.advanceTimersByTimeAsync(0);
    await settle();
    expect(q('notes-save-state')?.textContent).toContain('Enregistré');
  });

  it('saves immediately on blur', async () => {
    const { repo, settle, type, q } = await render();
    vi.useFakeTimers();
    type('notes-body', 'vite');
    q('notes-body')?.dispatchEvent(new Event('blur'));
    await vi.advanceTimersByTimeAsync(0);
    await settle();
    expect(repo.notes.get('note-1')?.body).toBe('vite');
    // The pending timer must not trigger a second write.
    await vi.advanceTimersByTimeAsync(NOTES_SAVE_DEBOUNCE_MS * 2);
    expect(repo.calls.filter((c) => c.startsWith('update'))).toHaveLength(1);
  });

  it('shows an error when saving fails and retries on the next edit', async () => {
    const { repo, settle, type, q } = await render();
    vi.useFakeTimers();
    repo.failNext(new DataError('busy', 'Database is busy'));
    type('notes-body', 'x');
    await vi.advanceTimersByTimeAsync(NOTES_SAVE_DEBOUNCE_MS);
    await settle();
    expect(q('notes-save-state')?.textContent).toContain('Échec');
    type('notes-body', 'xy');
    await vi.advanceTimersByTimeAsync(NOTES_SAVE_DEBOUNCE_MS);
    await settle();
    expect(repo.notes.get('note-1')?.body).toBe('xy');
    expect(q('notes-save-state')?.textContent).toContain('Enregistré');
  });

  it('switches to the missing state when the note is deleted while editing', async () => {
    const { repo, settle, type, q } = await render();
    vi.useFakeTimers();
    repo.notes.delete('note-1');
    type('notes-body', 'x');
    await vi.advanceTimersByTimeAsync(NOTES_SAVE_DEBOUNCE_MS);
    await settle();
    expect(q('notes-missing')).not.toBeNull();
  });

  it('flushes pending edits when the widget is destroyed', async () => {
    const { repo, fixture, type } = await render();
    type('notes-body', 'dernier mot');
    fixture.destroy();
    await Promise.resolve();
    expect(repo.notes.get('note-1')?.body).toBe('dernier mot');
  });

  it('registers in PendingWrites: flushAll saves the pending text', async () => {
    const { repo, type } = await render();
    const pending = TestBed.inject(PendingWrites);
    expect(pending.count).toBe(1);
    type('notes-body', 'avant import');
    await pending.flushAll();
    expect(repo.notes.get('note-1')?.body).toBe('avant import');
  });

  it('stays registered until the destruction flush is over, then unregisters', async () => {
    const { repo, fixture, type } = await render();
    const pending = TestBed.inject(PendingWrites);
    const real = repo.update.bind(repo);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(repo, 'update').mockImplementation(async (...args) => {
      await gate;
      return real(...args);
    });
    type('notes-body', 'dernier mot');
    fixture.destroy();
    await Promise.resolve();
    expect(pending.count).toBe(1);
    release();
    await vi.waitFor(() => expect(pending.count).toBe(0));
    expect(repo.notes.get('note-1')?.body).toBe('dernier mot');
  });

  it('renders markup as plain text and never as HTML', async () => {
    const repo = new FakeNoteRepository();
    repo.seed({ id: 'n-1', body: '<img src=x onerror=alert(1)> **gras**' });
    const { el, q } = await render({ noteId: 'n-1' }, repo);
    expect(q<HTMLTextAreaElement>('notes-body')?.value).toBe(
      '<img src=x onerror=alert(1)> **gras**',
    );
    expect(el.querySelector('img')).toBeNull();
  });

  it('shows a load error with a retry button', async () => {
    const repo = new FakeNoteRepository();
    repo.seed({ id: 'n-1', title: 'ok' });
    repo.failNext(new DataError('unavailable', 'down'));
    const { settle, q } = await render({ noteId: 'n-1' }, repo);
    expect(q('notes-error')).not.toBeNull();
    q('notes-retry')?.click();
    await settle();
    expect(q<HTMLInputElement>('notes-title')?.value).toBe('ok');
  });
});
