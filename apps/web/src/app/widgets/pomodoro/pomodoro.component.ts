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
  signal,
  untracked,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { TimeSessionStore } from '../../core/timers';
import {
  UserTimeZone,
  createNowSignal,
  durationBetween,
  formatClock,
  toLocalDate,
} from '../../core/time';
import { injectWidgetContext } from '../../core/widgets';
import { SCHEDULE_LIMITS } from '../../data';
import type { TimeSession } from '../../data';
import {
  POMODORO_PHASES,
  completedWorkCount,
  cycleProgress,
  kindOfPhase,
  phaseOfKind,
  suggestNextPhase,
} from './pomodoro-cycle';
import type { PomodoroPhase } from './pomodoro-cycle';
import { pomodoroErrorKey } from './pomodoro-errors';
import { PomodoroSettingsComponent } from './pomodoro-settings.component';
import type { PomodoroConfig } from './pomodoro.config';

const MS_PER_MINUTE = 60_000;

const PHASE_KEYS: Record<PomodoroPhase, string> = {
  work: 'widgets.pomodoro.work',
  short_break: 'widgets.pomodoro.shortBreak',
  long_break: 'widgets.pomodoro.longBreak',
};

interface CurrentPhase {
  readonly id: string;
  readonly phase: PomodoroPhase;
  readonly name: string;
  readonly label: string;
  readonly clock: string;
}

@Component({
  selector: 'app-pomodoro-widget',
  imports: [NgTemplateOutlet, TranslocoPipe, PomodoroSettingsComponent],
  templateUrl: './pomodoro.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full min-h-0 flex-col gap-2 focus:outline-none', tabindex: '-1' },
})
export class PomodoroComponent {
  protected readonly ctx = injectWidgetContext<PomodoroConfig>();
  protected readonly store = inject(TimeSessionStore);
  private readonly userZone = inject(UserTimeZone);
  private readonly transloco = inject(TranslocoService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly now = createNowSignal(1000, inject(DestroyRef));

  protected readonly settingsOpen = signal(false);
  protected readonly label = signal('');
  /** i18n key of the last failed action (start, stop). */
  protected readonly actionError = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly labelMax = SCHEDULE_LIMITS.labelMaxChars;
  protected readonly labelId = `pomodoro-label-${this.ctx.instanceId}`;
  protected readonly headingId = `pomodoro-heading-${this.ctx.instanceId}`;
  protected readonly sessionMax = SCHEDULE_LIMITS.maxRunningSessions;
  protected readonly phases = POMODORO_PHASES;

  protected readonly unavailable = computed(() => this.store.error()?.kind === 'unavailable');
  /** A failed read (a failed action only rejects, and has its own message). */
  protected readonly loadError = computed(() => this.store.error() !== null && !this.unavailable());
  /** Buttons wait for the first read: starting blind could hit a pomodoro already running. */
  protected readonly startDisabled = computed(
    () => this.busy() || this.unavailable() || this.store.loading(),
  );
  protected readonly actionMessage = computed(() =>
    this.unavailable() ? null : this.actionError(),
  );

  /** The running pomodoro session, possibly past its deadline and not yet completed by Rust. */
  private readonly active = computed<TimeSession | null>(
    () => this.store.running().find((s) => phaseOfKind(s.kind) !== null) ?? null,
  );
  private readonly activeExpired = computed(() => {
    const s = this.active();
    return s !== null && s.endsAt !== null && durationBetween(this.now(), s.endsAt) <= 0;
  });

  protected readonly current = computed<CurrentPhase | null>(() => {
    const s = this.active();
    const phase = s === null ? null : phaseOfKind(s.kind);
    if (s === null || phase === null || s.endsAt === null || this.activeExpired()) return null;
    return {
      id: s.id,
      phase,
      name: this.t(PHASE_KEYS[phase]),
      label: s.label,
      clock: formatClock(durationBetween(this.now(), s.endsAt), 'ceil'),
    };
  });

  /** Pomodoro sessions that ended, plus the expired one (it will be completed at its deadline). */
  private readonly ended = computed<readonly TimeSession[]>(() => {
    const s = this.active();
    const history = this.store.recent().filter((x) => phaseOfKind(x.kind) !== null);
    if (s === null || !this.activeExpired()) return history;
    return [{ ...s, endedAt: s.endsAt, endReason: 'completed' }, ...history];
  });

  private readonly today = computed(() => toLocalDate(this.now(), this.userZone.id()));
  protected readonly every = computed(() => this.ctx.config().longBreakEvery);

  protected readonly suggested = computed(() =>
    suggestNextPhase(this.ended(), this.today(), this.userZone.id(), this.every()),
  );
  protected readonly others = computed(() => this.phases.filter((p) => p !== this.suggested()));
  protected readonly doneToday = computed(() =>
    completedWorkCount(this.ended(), this.today(), this.userZone.id()),
  );
  protected readonly dots = computed(() => {
    const filled = cycleProgress(this.ended(), this.today(), this.userZone.id(), this.every());
    return Array.from({ length: this.every() }, (_, i) => i < filled);
  });
  protected readonly filledDots = computed(() => this.dots().filter(Boolean).length);

  /** Announced by the permanent status region; only its text changes. */
  protected readonly announcement = signal('');
  /** Id of the last completed session seen; undefined until the first read. */
  private seenCompleted: string | null | undefined;
  private wasRunning = false;
  /** The running list when the last action failed: a later successful re-read clears the message. */
  private failedAt: readonly TimeSession[] | null = null;

  constructor() {
    // A new completed session is announced; starting a phase empties the region.
    effect(() => {
      if (this.store.loading()) return;
      const latest = this.latestCompleted();
      const running = this.current() !== null;
      untracked(() => {
        if (this.seenCompleted === undefined) {
          this.seenCompleted = latest?.id ?? null;
          return;
        }
        if (running) this.announcement.set('');
        if ((latest?.id ?? null) !== this.seenCompleted) {
          this.seenCompleted = latest?.id ?? null;
          if (!running && latest !== null) {
            this.announcement.set(
              this.t(
                latest.kind === 'pomodoro_work'
                  ? 'widgets.pomodoro.doneWork'
                  : 'widgets.pomodoro.doneBreak',
              ),
            );
          }
        }
      });
    });
    // The Stop button disappears when the phase ends: do not leave the focus on nothing.
    effect(() => {
      const running = this.current() !== null;
      untracked(() => {
        if (this.wasRunning && !running) {
          const active = document.activeElement;
          if (
            active === null ||
            active === document.body ||
            this.host.nativeElement.contains(active)
          ) {
            this.focus('start');
          }
        }
        this.wasRunning = running;
      });
    });
    // A successful re-read after a failed action clears the action message.
    effect(() => {
      const running = this.store.running();
      untracked(() => {
        if (running !== this.failedAt) this.actionError.set(null);
      });
    });
  }

  private latestCompleted(): TimeSession | null {
    return this.ended()
      .filter((s) => s.endReason === 'completed' && s.endedAt !== null)
      .reduce<TimeSession | null>(
        (best, s) => (best === null || (s.endedAt ?? '') > (best.endedAt ?? '') ? s : best),
        null,
      );
  }

  private failAction(error: unknown): void {
    this.failedAt = this.store.running();
    this.actionError.set(pomodoroErrorKey(error));
  }

  protected phaseName(phase: PomodoroPhase): string {
    return this.t(PHASE_KEYS[phase]);
  }

  protected onLabel(event: Event): void {
    this.label.set((event.target as HTMLInputElement).value);
  }

  private minutesOf(phase: PomodoroPhase): number {
    const c = this.ctx.config();
    switch (phase) {
      case 'work':
        return c.workMinutes;
      case 'short_break':
        return c.shortBreakMinutes;
      case 'long_break':
        return c.longBreakMinutes;
    }
  }

  /**
   * No guard on a phase that just ended: Rust completes an expired session itself before starting
   * the next one (settle before mutation), so `AlreadyRunning` only means a real running pomodoro.
   */
  protected async startPhase(phase: PomodoroPhase): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.actionError.set(null);
    try {
      await this.store.start({
        kind: kindOfPhase(phase),
        label: phase === 'work' ? this.label().trim() : '',
        durationMs: this.minutesOf(phase) * MS_PER_MINUTE,
      });
      this.focus('stop');
    } catch (error) {
      this.failAction(error);
      this.focus('start');
    } finally {
      this.busy.set(false);
    }
  }

  protected async stop(id: string): Promise<void> {
    this.actionError.set(null);
    try {
      await this.store.stop(id);
    } catch (error) {
      this.failAction(error);
      return;
    }
    this.focus('start');
  }

  protected openSettings(): void {
    this.settingsOpen.set(true);
  }

  protected closeSettings(): void {
    this.settingsOpen.set(false);
    this.focus('settings');
  }

  /** Moves the focus to the control that replaces the one just used, else to the heading. */
  private focus(key: 'start' | 'stop' | 'settings'): void {
    afterNextRender(
      () => {
        const host = this.host.nativeElement;
        const target =
          host.querySelector<HTMLElement>(`[data-focus-key="${key}"]:not([disabled])`) ??
          host.querySelector<HTMLElement>(`#${CSS.escape(this.headingId)}`) ??
          host;
        target.focus();
      },
      { injector: this.injector },
    );
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(key, params);
  }
}
