import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { TimeSessionStore } from '../../core/timers';
import {
  TimeDisplay,
  UserTimeZone,
  createNowSignal,
  durationBetween,
  toLocalDate,
} from '../../core/time';
import type { LocalDateIso, TimeSession } from '../../data';
import { commandErrorKey, durationLabel, sessionIcon, sessionNameKey } from './timer-format';

/** A session that ended less than this ago stays at the head of its day. */
export const RECENT_END_MS = 10 * 60_000;

interface HistoryRow {
  readonly id: string;
  readonly icon: string;
  readonly name: string;
  readonly start: string;
  readonly duration: string;
  readonly stopped: boolean;
}

interface HistoryGroup {
  /** The local date, or `recent` for the head block. */
  readonly key: string;
  readonly title: string;
  readonly total: string;
  readonly rows: readonly HistoryRow[];
}

/** Finished sessions grouped by local day, with the total per day (panel replacing the body). */
@Component({
  selector: 'app-timer-history',
  imports: [TranslocoPipe],
  templateUrl: './timer-history.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-0 flex-1 flex-col' },
})
export class TimerHistoryComponent {
  readonly closed = output<void>();

  protected readonly store = inject(TimeSessionStore);
  private readonly display = inject(TimeDisplay);
  private readonly userZone = inject(UserTimeZone);
  private readonly transloco = inject(TranslocoService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly now = createNowSignal(60000, inject(DestroyRef));

  /** Session whose deletion is being confirmed. */
  protected readonly confirmingId = signal<string | null>(null);
  protected readonly errorKey = signal<string | null>(null);

  protected readonly groups = computed<readonly HistoryGroup[]>(() => {
    const zone = this.userZone.id();
    const now = this.now();
    const t = (key: string, params?: Record<string, unknown>) =>
      this.transloco.translate(key, params);
    const toRow = (session: TimeSession, ms: number, startStyle: 'time' | 'date-time') => ({
      id: session.id,
      icon: sessionIcon(session.kind),
      name: session.label === '' ? t(sessionNameKey(session.kind)) : session.label,
      start: this.display.formatInstant(session.startedAt, startStyle),
      duration: durationLabel(ms, t),
      stopped: session.endReason === 'stopped',
    });
    const total = (entries: readonly { ms: number }[]): string =>
      t('widgets.timers.total', {
        duration: durationLabel(
          entries.reduce((sum, e) => sum + e.ms, 0),
          t,
        ),
      });
    const recent: { session: TimeSession; ms: number }[] = [];
    const byDay = new Map<LocalDateIso, { session: TimeSession; ms: number }[]>();
    for (const session of this.store.recent()) {
      if (session.endedAt === null) continue;
      const ms = Math.max(0, durationBetween(session.startedAt, session.endedAt));
      if (durationBetween(session.endedAt, now) < RECENT_END_MS) {
        // Whatever day it started: it just ended.
        recent.push({ session, ms });
        continue;
      }
      const date = toLocalDate(session.startedAt, zone);
      const list = byDay.get(date) ?? [];
      list.push({ session, ms });
      byDay.set(date, list);
    }
    const days = [...byDay.entries()]
      .sort(([x], [y]) => (x < y ? 1 : x > y ? -1 : 0))
      .map(([date, entries]) => ({
        key: date,
        title: this.display.formatLocalDate(date, 'weekday-long'),
        total: total(entries),
        rows: entries.map((e) => toRow(e.session, e.ms, 'time')),
      }));
    if (recent.length === 0) return days;
    return [
      {
        key: 'recent',
        title: t('widgets.timers.justFinished'),
        total: total(recent),
        rows: recent.map((e) => toRow(e.session, e.ms, 'date-time')),
      },
      ...days,
    ];
  });

  constructor() {
    afterNextRender(
      () => {
        this.host.nativeElement
          .querySelector<HTMLElement>('[data-testid="timer-history-back"]')
          ?.focus();
      },
      { injector: this.injector },
    );
  }

  protected askRemove(id: string): void {
    this.errorKey.set(null);
    this.confirmingId.set(id);
    this.focus('[data-testid="timer-history-confirm-no"]');
  }

  protected cancelRemove(): void {
    const id = this.confirmingId();
    this.confirmingId.set(null);
    this.focus(`[data-testid="timer-history-remove"][data-session="${id}"]`);
  }

  protected async confirmRemove(id: string): Promise<void> {
    this.errorKey.set(null);
    try {
      await this.store.remove(id);
      this.confirmingId.set(null);
      this.focus('[data-testid="timer-history-back"]');
    } catch (error) {
      this.errorKey.set(commandErrorKey(error, 'session'));
      this.confirmingId.set(null);
      // The row may be gone (not found): the focus stays inside the panel either way.
      this.focus(
        `[data-testid="timer-history-remove"][data-session="${id}"], [data-testid="timer-history-back"]`,
      );
    }
  }

  protected async loadMore(): Promise<void> {
    this.errorKey.set(null);
    await this.store.loadMoreHistory();
    // The store reports a failed page in `historyError` (not `error`) without throwing.
    const failure = this.store.historyError();
    if (failure !== null) this.errorKey.set(commandErrorKey(failure, 'session'));
  }

  protected onEscape(): void {
    if (this.confirmingId() !== null) {
      this.cancelRemove();
      return;
    }
    this.closed.emit();
  }

  private focus(selector: string): void {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(), {
      injector: this.injector,
    });
  }
}
