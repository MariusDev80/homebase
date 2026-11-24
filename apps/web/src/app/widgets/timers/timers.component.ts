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
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ReminderStore } from '../../core/reminders';
import { TimeSessionStore } from '../../core/timers';
import {
  CLOCK,
  TimeDisplay,
  UserTimeZone,
  createNowSignal,
  addDays,
  durationBetween,
  formatClock,
  toLocalDate,
} from '../../core/time';
import { injectWidgetContext } from '../../core/widgets';
import { SCHEDULE_LIMITS } from '../../data';
import type { Reminder, ReminderInput, TimeSession } from '../../data';
import { dayAfterAlarm, nextAlarm } from './alarm-time';
import { StopwatchDetailComponent } from './stopwatch-detail.component';
import {
  MAX_MINUTES,
  PRESET_MINUTES,
  commandErrorKey,
  durationLabel,
  parseTimerDuration,
  sessionNameKey,
} from './timer-format';
import { TimerHistoryComponent } from './timer-history.component';
import type { TimersConfig } from './timers.config';

type View = 'main' | 'history' | 'detail';

interface RunningRow {
  readonly id: string;
  readonly kind: 'stopwatch' | 'countdown';
  readonly name: string;
  readonly clock: string;
  readonly finished: boolean;
  /** "Fin à 14:05" (timer) or "depuis 14:03" (stopwatch). */
  readonly detail: string;
  /** "En cours depuis 1 h 05" (stopwatch only). */
  readonly since: string | null;
}

@Component({
  selector: 'app-timers-widget',
  imports: [TranslocoPipe, StopwatchDetailComponent, TimerHistoryComponent],
  templateUrl: './timers.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full min-h-0 flex-col gap-2 focus:outline-none', tabindex: '-1' },
})
export class TimersComponent {
  protected readonly ctx = injectWidgetContext<TimersConfig>();
  protected readonly store = inject(TimeSessionStore);
  private readonly clock = inject(CLOCK);
  private readonly display = inject(TimeDisplay);
  private readonly userZone = inject(UserTimeZone);
  private readonly transloco = inject(TranslocoService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly now = createNowSignal(1000, inject(DestroyRef));

  protected readonly view = signal<View>('main');
  protected readonly detailId = signal<string | null>(null);
  protected readonly minutes = signal('5');
  protected readonly seconds = signal('0');
  protected readonly label = signal('');
  protected readonly alarmTime = signal('');
  protected readonly alarmLabel = signal('');
  /** i18n key of the last failed action (start, stop, alarm). */
  protected readonly actionError = signal<string | null>(null);
  protected readonly durationError = signal<string | null>(null);
  protected readonly alarmError = signal<string | null>(null);
  protected readonly alarmMessage = signal('');
  /** Gap or fold remark, in its own element (the message stays short for screen readers). */
  protected readonly alarmNote = signal('');
  /** A number field holds text the browser cannot read (validity.badInput). */
  private readonly minutesBad = signal(false);
  private readonly secondsBad = signal(false);
  protected readonly busy = signal(false);
  protected readonly alarmBusy = signal(false);

  protected readonly presets = PRESET_MINUTES;
  protected readonly maxMinutes = MAX_MINUTES;
  protected readonly labelMax = SCHEDULE_LIMITS.labelMaxChars;
  protected readonly sessionMax = SCHEDULE_LIMITS.maxRunningSessions;
  protected readonly ids = {
    minutes: `timers-minutes-${this.ctx.instanceId}`,
    seconds: `timers-seconds-${this.ctx.instanceId}`,
    label: `timers-label-${this.ctx.instanceId}`,
    alarmTime: `timers-alarm-time-${this.ctx.instanceId}`,
    alarmLabel: `timers-alarm-label-${this.ctx.instanceId}`,
  };

  protected readonly unavailable = computed(() => this.store.error()?.kind === 'unavailable');
  /** A failed read (a failed action only rejects, and has its own message). */
  protected readonly loadError = computed(() => this.store.error() !== null && !this.unavailable());
  protected readonly actionMessage = computed(() =>
    this.unavailable() ? null : this.actionError(),
  );

  protected readonly rows = computed<readonly RunningRow[]>(() => {
    const now = this.now();
    return this.store
      .running()
      .filter((s) => s.kind === 'stopwatch' || s.kind === 'countdown')
      .map((s) => this.rowOf(s, now));
  });

  /** Announced by the permanent status region; only its text changes. */
  protected readonly finishedAnnouncement = computed(() => {
    const last = this.rows()
      .filter((r) => r.finished)
      .at(-1);
    return last === undefined ? '' : this.t('widgets.timers.finishedOf', { name: last.name });
  });

  private opener = 'history';
  /** The running list when the last action failed: a later successful re-read clears the message. */
  private failedAt: readonly TimeSession[] | null = null;

  constructor() {
    effect(() => {
      const running = this.store.running();
      untracked(() => {
        if (running !== this.failedAt) this.actionError.set(null);
      });
    });
  }

  private failAction(error: unknown): void {
    this.failedAt = this.store.running();
    this.actionError.set(commandErrorKey(error, 'session'));
  }

  private rowOf(session: TimeSession, now: string): RunningRow {
    const name = session.label === '' ? this.t(sessionNameKey(session.kind)) : session.label;
    if (session.kind === 'stopwatch' || session.endsAt === null) {
      const elapsed = durationBetween(session.startedAt, now);
      return {
        id: session.id,
        kind: 'stopwatch',
        name,
        clock: formatClock(elapsed, 'floor'),
        finished: false,
        detail: this.t('widgets.timers.sinceTime', {
          time: this.display.formatInstant(session.startedAt, 'time'),
        }),
        since: this.t('widgets.timers.since', {
          duration: durationLabel(Math.max(0, elapsed), (k, p) => this.t(k, p)),
        }),
      };
    }
    const remaining = durationBetween(now, session.endsAt);
    return {
      id: session.id,
      kind: 'countdown',
      name,
      clock: formatClock(remaining, 'ceil'),
      finished: remaining <= 0,
      detail: this.t('widgets.timers.endsAt', {
        time: this.display.formatInstant(session.endsAt, 'time'),
      }),
      since: null,
    };
  }

  protected onMinutes(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.minutes.set(input.value);
    this.minutesBad.set(input.value === '' && input.validity.badInput);
    this.durationError.set(null);
  }

  protected onSeconds(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.seconds.set(input.value);
    this.secondsBad.set(input.value === '' && input.validity.badInput);
    this.durationError.set(null);
  }

  protected onLabel(event: Event): void {
    this.label.set((event.target as HTMLInputElement).value);
  }

  protected usePreset(minutes: number): void {
    this.minutes.set(String(minutes));
    this.seconds.set('0');
    this.minutesBad.set(false);
    this.secondsBad.set(false);
    this.durationError.set(null);
  }

  protected async startTimer(): Promise<void> {
    // Unreadable text in a number field is an error, not zero.
    const parsed = this.minutesBad()
      ? ({ kind: 'error', field: 'minutes' } as const)
      : this.secondsBad()
        ? ({ kind: 'error', field: 'seconds' } as const)
        : parseTimerDuration(this.minutes(), this.seconds());
    if (parsed.kind === 'error') {
      this.durationError.set(`widgets.timers.errors.${parsed.field}`);
      return;
    }
    await this.start('countdown', parsed.ms);
  }

  protected async startStopwatch(): Promise<void> {
    await this.start('stopwatch', null);
  }

  private async start(kind: 'countdown' | 'stopwatch', durationMs: number | null): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.actionError.set(null);
    try {
      await this.store.start({ kind, label: this.label().trim(), durationMs });
    } catch (error) {
      this.failAction(error);
    } finally {
      this.busy.set(false);
    }
  }

  protected async stop(id: string): Promise<void> {
    this.actionError.set(null);
    const before = this.rows();
    const index = before.findIndex((r) => r.id === id);
    try {
      await this.store.stop(id);
    } catch (error) {
      this.failAction(error);
      return;
    }
    // The stopped row is gone: the focus goes to the row after it, else to the heading.
    const next = before.slice(index + 1).find((r) => this.rows().some((x) => x.id === r.id));
    afterNextRender(
      () => {
        const host = this.host.nativeElement;
        const row =
          next === undefined
            ? null
            : host.querySelector<HTMLElement>(`[data-row-id="${next.id}"] button`);
        (row ?? host.querySelector<HTMLElement>('[data-focus-key="running-heading"]'))?.focus();
      },
      { injector: this.injector },
    );
  }

  protected onAlarmTime(event: Event): void {
    this.alarmTime.set((event.target as HTMLInputElement).value);
    this.alarmError.set(null);
  }

  protected onAlarmLabel(event: Event): void {
    this.alarmLabel.set((event.target as HTMLInputElement).value);
  }

  /** M1: an alarm is a one-shot reminder at the next HH:MM in the user's time zone. */
  protected async setAlarm(): Promise<void> {
    if (this.alarmBusy()) return;
    const zone = this.userZone.id();
    const time = this.alarmTime();
    let plan = nextAlarm(time, this.clock.nowIso(), zone);
    this.alarmMessage.set('');
    this.alarmNote.set('');
    if (plan === null) {
      this.alarmError.set('widgets.timers.errors.alarmTime');
      return;
    }
    const reminders = this.injector.get(ReminderStore);
    this.alarmBusy.set(true);
    this.alarmError.set(null);
    let orphan: string | null = null;
    try {
      // Read lazily: the reminders are only needed once an alarm is set.
      const input: ReminderInput = {
        title: this.alarmLabel().trim() || this.t('widgets.timers.alarm'),
        startLocal: plan.startLocal,
        timeZone: zone,
        rrule: null,
        exdates: [],
        enabled: true,
      };
      let saved = await reminders.create(input);
      orphan = saved.id;
      if (!this.rings(saved)) {
        // Rust has the last word: nothing ahead for that choice, so try the next day, once.
        const later = dayAfterAlarm(plan, time, zone);
        if (later === null) {
          await this.discard(reminders, orphan);
          this.alarmError.set('widgets.timers.errors.alarmNotScheduled');
          return;
        }
        plan = later;
        saved = await reminders.update(saved.id, { ...input, startLocal: later.startLocal });
        if (!this.rings(saved)) {
          await this.discard(reminders, orphan);
          this.alarmError.set('widgets.timers.errors.alarmNotScheduled');
          return;
        }
      }
      orphan = null;
      this.alarmMessage.set(
        this.t('widgets.timers.alarmSet', { when: this.whenText(saved, zone) }),
      );
      this.alarmNote.set(
        plan.kind === 'gap'
          ? this.t('time.nonexistent', { time: plan.time })
          : plan.kind === 'fold'
            ? this.t('time.ambiguous')
            : '',
      );
    } catch (error) {
      if (orphan !== null) await this.discard(reminders, orphan);
      this.alarmError.set(commandErrorKey(error, 'alarm'));
    } finally {
      this.alarmBusy.set(false);
    }
  }

  /** Best effort: an alarm that is not scheduled must not stay in the Reminders widget. */
  private async discard(reminders: ReminderStore, id: string): Promise<void> {
    try {
      await reminders.remove(id);
    } catch {
      // Ignored: the user sees the alarm error either way.
    }
  }

  private rings(reminder: Reminder): boolean {
    return reminder.status === 'scheduled' && reminder.nextFireAt !== null;
  }

  /** "aujourd'hui à 07:00", "demain à 07:00" or "mar. 17 à 07:00", from the instant Rust computed. */
  private whenText(reminder: Reminder, zone: string): string {
    const at = reminder.nextFireAt ?? this.clock.nowIso();
    const date = toLocalDate(at, zone);
    const today = toLocalDate(this.clock.nowIso(), zone);
    const time = this.display.formatInstant(at, 'time', zone);
    if (date === today) return this.t('widgets.timers.alarmToday', { time });
    if (date === addDays(today, 1)) return this.t('widgets.timers.alarmTomorrow', { time });
    return this.t('widgets.timers.alarmOther', {
      date: this.display.formatLocalDate(date, 'weekday-short'),
      time,
    });
  }

  protected openHistory(): void {
    this.open('history', 'history');
  }

  protected openDetail(id: string): void {
    this.detailId.set(id);
    this.open('detail', `detail-${id}`);
  }

  protected closePanel(): void {
    if (this.view() === 'main') return;
    const opener = this.opener;
    this.view.set('main');
    this.detailId.set(null);
    afterNextRender(
      () => {
        const host = this.host.nativeElement;
        const target = host.querySelector<HTMLElement>(`[data-focus-key="${opener}"]`) ?? host;
        target.focus();
      },
      { injector: this.injector },
    );
  }

  private open(view: View, opener: string): void {
    this.opener = opener;
    this.view.set(view);
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(key, params);
  }
}
