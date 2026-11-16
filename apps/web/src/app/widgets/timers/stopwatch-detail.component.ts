import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { TimeSessionStore } from '../../core/timers';
import { TimeDisplay, createNowSignal, durationBetween, formatClock } from '../../core/time';
import { PendingWrites } from '../../core/widgets';
import { SCHEDULE_LIMITS } from '../../data';
import { commandErrorKey, durationLabel, sessionNameKey } from './timer-format';

/** Delay between the last keystroke in the label and the automatic save (DESIGN.md, panel). */
export const STOPWATCH_DETAIL_SAVE_DEBOUNCE_MS = 800;

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface PastRow {
  readonly id: string;
  readonly start: string;
  readonly duration: string;
}

/**
 * Detail panel of a running stopwatch: editable label (saved as the user types), start, elapsed
 * time and the finished sessions with the same label. Replaces the body of the widget.
 */
@Component({
  selector: 'app-stopwatch-detail',
  imports: [TranslocoPipe],
  templateUrl: './stopwatch-detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-0 flex-1 flex-col' },
})
export class StopwatchDetailComponent {
  readonly sessionId = input.required<string>();
  /** Id of the widget instance, to keep element ids unique when several widgets are shown. */
  readonly instanceId = input.required<string>();
  readonly closed = output<void>();

  private readonly store = inject(TimeSessionStore);
  private readonly display = inject(TimeDisplay);
  private readonly transloco = inject(TranslocoService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly now = createNowSignal(1000, inject(DestroyRef));

  protected readonly labelMax = SCHEDULE_LIMITS.labelMaxChars;
  protected readonly session = computed(() =>
    this.store.running().find((s) => s.id === this.sessionId()),
  );
  private readonly draft = signal<string | null>(null);
  protected readonly labelValue = computed(() => this.draft() ?? this.session()?.label ?? '');
  protected readonly saveState = signal<SaveState>('idle');
  protected readonly errorKey = signal('widgets.timers.errors.unknown');
  protected readonly defaultName = computed(() => {
    const kind = this.session()?.kind;
    return kind === undefined ? '' : this.transloco.translate(sessionNameKey(kind));
  });
  protected readonly elapsed = computed(() => {
    const s = this.session();
    return s === undefined ? '' : formatClock(durationBetween(s.startedAt, this.now()), 'floor');
  });
  protected readonly startedText = computed(() => {
    const s = this.session();
    return s === undefined ? '' : this.display.formatInstant(s.startedAt, 'date-time');
  });
  protected readonly past = computed<readonly PastRow[]>(() => {
    const label = this.session()?.label ?? '';
    if (label === '') return [];
    return this.store
      .recent()
      .filter((s) => s.label === label && s.endedAt !== null)
      .map((s) => ({
        id: s.id,
        start: this.display.formatInstant(s.startedAt, 'date-time'),
        duration: durationLabel(durationBetween(s.startedAt, s.endedAt ?? s.startedAt), (k, p) =>
          this.transloco.translate(k, p),
        ),
      }));
  });

  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | null = null;
  /** The last write failed and nothing was typed since. */
  private saveFailed = false;
  /** The user was warned once by Retour: a second press leaves anyway. */
  private warned = false;
  private finished = false;
  private dirty = false;

  constructor() {
    const unregister = inject(PendingWrites).register(() => this.flush());
    inject(DestroyRef).onDestroy(() => {
      this.finished = true;
      // Last chance to persist what was typed, unless a failure was already reported.
      void (this.saveFailed ? Promise.resolve() : this.write()).finally(unregister);
    });
    // The stopwatch was stopped or removed elsewhere: nothing left to show.
    effect(() => {
      if (this.session() === undefined && !this.store.loading()) {
        untracked(() => this.leave());
      }
    });
    afterNextRender(
      () => {
        this.host.nativeElement
          .querySelector<HTMLInputElement>('[data-testid="stopwatch-detail-label"]')
          ?.focus();
      },
      { injector: this.injector },
    );
  }

  protected onInput(event: Event): void {
    this.draft.set((event.target as HTMLInputElement).value);
    this.dirty = true;
    this.saveFailed = false;
    this.warned = false;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.write(), STOPWATCH_DETAIL_SAVE_DEBOUNCE_MS);
  }

  protected onBlur(): void {
    void this.flush();
  }

  protected async back(): Promise<void> {
    if (this.finished) return;
    await this.flush();
    // A second press after a failure gives up on what could not be saved.
    if (this.saveFailed && !this.warned) {
      this.warned = true;
      return;
    }
    this.leave();
  }

  private leave(): void {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.timer);
    this.closed.emit();
  }

  private flush(): Promise<void> {
    clearTimeout(this.timer);
    return this.write();
  }

  private write(): Promise<void> {
    this.running ??= this.drain().finally(() => (this.running = null));
    return this.running;
  }

  /** One save loop at a time: edits made while it runs are picked up by the same loop. */
  private async drain(): Promise<void> {
    while (this.dirty) {
      this.dirty = false;
      if (!(await this.save())) {
        // Kept dirty: a later flush retries.
        this.dirty = true;
        return;
      }
    }
  }

  /** Writes the current draft; false when the write failed. */
  private async save(): Promise<boolean> {
    const draft = this.draft();
    const session = this.session();
    if (draft === null || session === undefined) return true;
    const label = draft.trim();
    // The draft stays as typed (trailing spaces included) until the panel closes.
    if (label === session.label) return true;
    this.saveState.set('saving');
    try {
      await this.store.rename(session.id, label);
      this.saveFailed = false;
      this.saveState.set('saved');
      return true;
    } catch (error) {
      this.saveFailed = true;
      this.errorKey.set(commandErrorKey(error, 'session'));
      this.saveState.set('error');
      return false;
    }
  }
}
