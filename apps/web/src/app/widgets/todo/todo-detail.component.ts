import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { TimeDisplay, Today, isValidLocalDate } from '../../core/time';
import { PendingWrites } from '../../core/widgets';
import { DataError, TODO_REPOSITORY, TODO_TITLE_MAX } from '../../data';
import type { Todo, TodoChanges } from '../../data';
import { mergeChanges } from './todo-changes';
import { dueLabel } from './todo-due';

/** Delay between the last keystroke in a text field and the automatic save. */
export const TODO_DETAIL_SAVE_DEBOUNCE_MS = 800;

const DUE_MIN = '1900-01-01';
const DUE_MAX = '2199-12-31';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function isEmpty(changes: TodoChanges): boolean {
  return Object.keys(changes).length === 0;
}

/**
 * Detail sheet of one todo (title, flag, description, due date, deletion), saved as the user goes
 * (like the notes): text fields are debounced, discrete choices are written at once. A single
 * write loop runs at a time. The sheet replaces the body of the widget (see TodoComponent).
 */
@Component({
  selector: 'app-todo-detail',
  imports: [TranslocoPipe],
  templateUrl: './todo-detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-0 flex-1 flex-col' },
})
export class TodoDetailComponent {
  /** Snapshot taken when the sheet opens. */
  readonly todo = input.required<Todo>();
  readonly instanceId = input.required<string>();
  readonly closed = output<void>();
  readonly removed = output<void>();
  readonly vanished = output<void>();

  private readonly repository = inject(TODO_REPOSITORY);
  private readonly today = inject(Today);
  private readonly display = inject(TimeDisplay);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Last todo returned by the repository (the snapshot until the first write). */
  private readonly storedState = signal<Todo | null>(null);
  protected readonly stored = computed(() => this.storedState() ?? this.todo());
  /** Text drafts; null = the saved value. */
  private readonly titleDraft = signal<string | null>(null);
  private readonly descriptionDraft = signal<string | null>(null);
  /** Discrete changes waiting for the write loop (due date, repetition, flag). */
  private readonly pending = signal<TodoChanges>({});
  /** Discrete changes of the write in progress (still wanted until it succeeds or fails). */
  private readonly inflight = signal<TodoChanges>({});

  protected readonly saveState = signal<SaveState>('idle');
  protected readonly closeFailed = signal(false);
  protected readonly removeFailed = signal(false);
  protected readonly confirmingRemove = signal(false);

  protected readonly titleValue = computed(() => this.titleDraft() ?? this.stored().title);
  protected readonly descriptionValue = computed(
    () => this.descriptionDraft() ?? this.stored().description,
  );
  protected readonly titleInvalid = computed(() => {
    const length = this.titleValue().trim().length;
    return length < 1 || length > TODO_TITLE_MAX;
  });
  /** Due date as wanted: the pending choice if any, else the saved one (never the saved one alone). */
  protected readonly wantedDue = computed(() => {
    // What is being written counts as wanted too: the batch leaves `pending` when the write starts.
    for (const changes of [this.pending(), this.inflight()]) {
      if ('dueOn' in changes) return changes.dueOn ?? null;
    }
    return this.stored().dueOn;
  });
  protected readonly wantedImportant = computed(() => {
    for (const changes of [this.pending(), this.inflight()]) {
      if ('important' in changes) return changes.important === true;
    }
    return this.stored().important;
  });
  protected readonly due = computed(() =>
    dueLabel(
      { dueOn: this.wantedDue(), completedAt: this.stored().completedAt },
      this.today.date(),
      (date, style) => this.display.formatLocalDate(date, style),
    ),
  );
  protected readonly createdOn = computed(() =>
    this.display.formatInstant(this.stored().createdAt, 'date'),
  );
  protected readonly completedOn = computed(() => {
    const at = this.stored().completedAt;
    return at === null ? null : this.display.formatInstant(at, 'date');
  });

  protected readonly dueMin = DUE_MIN;
  protected readonly dueMax = DUE_MAX;

  private textDirty = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | null = null;
  /** True when the last write attempt of the loop failed. */
  private attemptFailed = false;
  /** The sheet is over (closed, removed, vanished): nothing may be written any more. */
  private finished = false;
  private destroyed = false;

  constructor() {
    // A configuration import or a restoration flushes the pending save first (see PendingWrites).
    const unregister = inject(PendingWrites).register(() => this.flush());
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      // Last chance to persist what was typed. The flusher stays registered until then.
      void this.flush().finally(unregister);
    });
    afterNextRender(
      () => {
        const field = this.host.nativeElement.querySelector<HTMLTextAreaElement>(
          '[data-testid="todo-detail-title"]',
        );
        if (!field) return;
        field.focus();
        field.setSelectionRange(field.value.length, field.value.length);
      },
      { injector: this.injector },
    );
  }

  // ---- Title and description ----

  protected onTitleInput(event: Event): void {
    const field = event.target as HTMLTextAreaElement;
    let value = field.value;
    if (/[\r\n]/.test(value)) {
      // The title is one line: pasted line breaks become spaces (same length, caret kept).
      const start = field.selectionStart;
      const end = field.selectionEnd;
      value = value.replace(/\r\n|\r|\n/g, ' ');
      field.value = value;
      field.setSelectionRange(start, end);
    }
    this.titleDraft.set(value);
    this.onTextChanged();
  }

  protected onTitleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.isComposing) return;
    // Enter and Shift+Enter both save at once; the title never gets a line break.
    event.preventDefault();
    void this.flush();
  }

  protected onDescriptionInput(event: Event): void {
    this.descriptionDraft.set((event.target as HTMLTextAreaElement).value);
    this.onTextChanged();
  }

  protected onTextBlur(): void {
    void this.flush();
  }

  private onTextChanged(): void {
    this.closeFailed.set(false);
    if (this.finished) return;
    this.textDirty = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.save(), TODO_DETAIL_SAVE_DEBOUNCE_MS);
  }

  // ---- Discrete choices ----

  protected onImportantChange(event: Event): void {
    this.choose({ important: (event.target as HTMLInputElement).checked });
  }

  protected onDueChange(event: Event): void {
    // A date input fires `change` for every complete intermediate date while the year is typed
    // (0002-..., 0020-..., 0202-...). Only a valid in-range date or a real clearing is chosen;
    // anything else stays in the field and the wanted value is restored on blur.
    const input = event.target as HTMLInputElement;
    const value = input.value;
    if (value === '' && input.validity.badInput) return;
    if (value !== '' && !(value >= DUE_MIN && value <= DUE_MAX && isValidLocalDate(value))) return;
    const dueOn = value === '' ? null : value;
    if (dueOn === this.wantedDue()) return;
    this.choose({ dueOn });
  }

  protected onDueBlur(event: Event): void {
    const input = event.target as HTMLInputElement;
    const wanted = this.wantedDue() ?? '';
    if (input.value !== wanted || input.validity.badInput) input.value = wanted;
  }

  protected clearDue(): void {
    this.choose({ dueOn: null });
    this.focus('[data-testid="todo-detail-due"]');
  }

  private choose(change: TodoChanges): void {
    this.closeFailed.set(false);
    if (this.finished) return;
    this.pending.set(mergeChanges(this.stored(), this.pending(), change));
    void this.save();
  }

  // ---- Closing and deletion ----

  protected async back(): Promise<void> {
    if (this.finished) return;
    if (this.closeFailed()) {
      // Second press after a failure: give up on what could not be written.
      this.abandon();
      this.finished = true;
      this.closed.emit();
      return;
    }
    await this.flush();
    if (this.finished || this.destroyed) return;
    if (this.attemptFailed) {
      this.closeFailed.set(true);
      return;
    }
    this.abandon();
    this.finished = true;
    this.closed.emit();
  }

  protected onEscape(event: Event): void {
    if ((event as KeyboardEvent).isComposing) return;
    event.preventDefault();
    if (this.confirmingRemove()) {
      this.cancelRemove();
      return;
    }
    void this.back();
  }

  protected askRemove(): void {
    this.removeFailed.set(false);
    this.confirmingRemove.set(true);
    this.focus('[data-testid="todo-detail-confirm-no"]');
  }

  protected cancelRemove(): void {
    this.confirmingRemove.set(false);
    this.focus('[data-testid="todo-detail-remove"]');
  }

  protected async confirmRemove(): Promise<void> {
    if (this.finished) return;
    this.removeFailed.set(false);
    if (this.running) await this.running;
    if (this.finished) return;
    this.abandon();
    try {
      await this.repository.remove(this.stored().id);
    } catch {
      this.removeFailed.set(true);
      this.confirmingRemove.set(false);
      return;
    }
    this.finished = true;
    this.removed.emit();
  }

  // ---- Write loop ----

  /** Writes what is pending right now and waits for the loop to end. */
  private flush(): Promise<void> {
    clearTimeout(this.timer);
    return this.save();
  }

  /** One write loop at a time: edits made while it runs are picked up by the same loop. */
  private save(): Promise<void> {
    if (this.finished) return Promise.resolve();
    this.running ??= this.drain().finally(() => (this.running = null));
    return this.running;
  }

  /** Drops every waiting write (timer, discrete choices, texts). Called before emitting an exit. */
  private abandon(): void {
    clearTimeout(this.timer);
    this.pending.set({});
    this.textDirty = false;
  }

  private async drain(): Promise<void> {
    let wrote = false;
    this.attemptFailed = false;
    while (this.textDirty || !isEmpty(this.pending())) {
      const batch = this.pending();
      this.pending.set({});
      const changes: TodoChanges = { ...batch };
      const withText = this.textDirty;
      if (withText) {
        this.textDirty = false;
        const stored = this.stored();
        const description = this.descriptionValue();
        if (description !== stored.description) changes.description = description;
        const title = this.titleValue().trim();
        if (!this.titleInvalid() && title !== stored.title) changes.title = title;
      }
      if (isEmpty(changes)) continue;
      this.saveState.set('saving');
      this.inflight.set(batch);
      try {
        this.storedState.set(await this.repository.update(this.stored().id, changes));
        this.inflight.set({});
        wrote = true;
      } catch (error) {
        this.inflight.set({});
        if (error instanceof DataError && error.kind === 'not_found') {
          this.abandon();
          this.finished = true;
          this.saveState.set('idle');
          if (!this.destroyed) this.vanished.emit();
          return;
        }
        // Discrete changes (this batch and what came in meanwhile) are given up and the controls
        // fall back to the saved values; texts stay pending and are retried.
        this.pending.set({});
        if (withText) this.textDirty = true;
        this.attemptFailed = true;
        this.saveState.set('error');
        this.realignControls();
        return;
      }
    }
    if (wrote) this.saveState.set('saved');
  }

  /**
   * Puts the native controls back on the wanted values. A control the user just changed holds a
   * value that no binding ever rendered, so the bindings alone would not undo it.
   */
  private realignControls(): void {
    const root = this.host.nativeElement;
    const important = root.querySelector<HTMLInputElement>('[data-testid="todo-detail-important"]');
    if (important) important.checked = this.wantedImportant();
    const due = root.querySelector<HTMLInputElement>('[data-testid="todo-detail-due"]');
    if (due) due.value = this.wantedDue() ?? '';
  }

  /** Focuses the element once the next render has put it in the DOM. */
  private focus(selector: string): void {
    afterNextRender(
      () => {
        this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
      },
      { injector: this.injector },
    );
  }
}
