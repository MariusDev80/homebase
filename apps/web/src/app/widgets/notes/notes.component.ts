import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { DataError, NOTE_REPOSITORY } from '../../data';
import { PendingWrites, injectWidgetContext } from '../../core/widgets';
import type { NotesConfig } from './notes.config';

/** Delay between the last keystroke and the automatic save. */
export const NOTES_SAVE_DEBOUNCE_MS = 800;

type Status = 'loading' | 'ready' | 'missing' | 'error';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

@Component({
  selector: 'app-notes-widget',
  imports: [TranslocoPipe],
  templateUrl: './notes.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full min-h-0 flex-col gap-2' },
})
export class NotesComponent {
  protected readonly ctx = injectWidgetContext<NotesConfig>();
  private readonly notes = inject(NOTE_REPOSITORY);

  protected readonly status = signal<Status>('loading');
  protected readonly saveState = signal<SaveState>('idle');
  protected readonly title = signal('');
  protected readonly body = signal('');
  protected readonly busy = signal(false);

  private noteId: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private dirty = false;
  private running: Promise<void> | null = null;
  private destroyed = false;

  constructor() {
    // A configuration import or a restoration flushes the pending save first (see PendingWrites);
    // while it runs the page is inert (AppLock), so no new deferred save can start.
    const unregister = inject(PendingWrites).register(() => this.flush());
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      // Last chance to persist what was typed just before the widget disappears. The flusher
      // stays registered until that save is over, so that an import waits for it too.
      void this.flush().finally(unregister);
    });
    void this.load();
  }

  protected async load(): Promise<void> {
    this.status.set('loading');
    try {
      const id = this.ctx.config().noteId;
      if (id === null) {
        await this.createAndAttach();
        return;
      }
      const note = await this.notes.get(id);
      if (this.destroyed) return;
      if (note === null) {
        this.status.set('missing');
        return;
      }
      this.show(note.id, note.title, note.body);
    } catch {
      if (!this.destroyed) this.status.set('error');
    }
  }

  protected async createNew(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.status.set('loading');
    try {
      await this.createAndAttach();
    } catch {
      if (!this.destroyed) this.status.set('error');
    } finally {
      this.busy.set(false);
    }
  }

  protected onTitleInput(event: Event): void {
    this.title.set((event.target as HTMLInputElement).value);
    this.schedule();
  }

  protected onBodyInput(event: Event): void {
    this.body.set((event.target as HTMLTextAreaElement).value);
    this.schedule();
  }

  /** Saves right now if something is pending (blur, destroy). */
  protected flush(): Promise<void> {
    clearTimeout(this.timer);
    return this.save();
  }

  private async createAndAttach(): Promise<void> {
    const note = await this.notes.create({ widgetInstanceId: this.ctx.instanceId });
    try {
      await this.ctx.updateConfig({ ...this.ctx.config(), noteId: note.id });
    } catch (error) {
      // Do not leave an orphan note behind when the reference could not be stored.
      await this.notes.remove(note.id).catch(() => false);
      throw error;
    }
    if (!this.destroyed) this.show(note.id, note.title, note.body);
  }

  private show(id: string, title: string, body: string): void {
    this.noteId = id;
    this.dirty = false;
    this.title.set(title);
    this.body.set(body);
    this.saveState.set('idle');
    this.status.set('ready');
  }

  private schedule(): void {
    this.dirty = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.save(), NOTES_SAVE_DEBOUNCE_MS);
  }

  /** One save loop at a time: edits made while it runs are picked up by the same loop. */
  private save(): Promise<void> {
    this.running ??= this.drain().finally(() => (this.running = null));
    return this.running;
  }

  private async drain(): Promise<void> {
    let wrote = false;
    while (this.dirty && this.noteId !== null) {
      this.dirty = false;
      this.saveState.set('saving');
      try {
        await this.notes.update(this.noteId, this.title(), this.body());
        wrote = true;
      } catch (error) {
        if (error instanceof DataError && error.kind === 'not_found') {
          this.status.set('missing');
        } else {
          // Kept dirty: the next keystroke or blur retries.
          this.dirty = true;
          this.saveState.set('error');
        }
        return;
      }
    }
    if (wrote) this.saveState.set('saved');
  }
}
