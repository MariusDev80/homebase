import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, Signal, inject, signal } from '@angular/core';
import {
  CLOCK,
  DataError,
  type InstantIso,
  type TimeSession,
  type TimeSessionKind,
} from '../../data';
import { TIME_SESSION_REPOSITORY } from '../../data/schedule.tokens';
import { DueRefresher } from '../time';

/** Size of one history page (Rust accepts up to 200). */
export const HISTORY_PAGE_SIZE = 100;

function asDataError(error: unknown): DataError {
  return error instanceof DataError
    ? error
    : new DataError('unknown', 'Unexpected session error', { cause: error });
}

/**
 * Running timers, stopwatches and pomodoro phases plus their history, shared by every widget (M9).
 * The deadline is held by Rust; this store only displays it and re-reads (D8) at first use, when
 * the window is visible again or focused, after each action and 1 s after the next `endsAt`.
 * A refresh reloads the first history page only (pages loaded with `loadMoreHistory` are dropped).
 */
@Injectable({ providedIn: 'root' })
export class TimeSessionStore {
  private readonly repository = inject(TIME_SESSION_REPOSITORY);
  private readonly refresher = new DueRefresher(
    inject(DOCUMENT),
    inject(CLOCK),
    inject(DestroyRef),
    () => void this.refresh(),
  );

  private readonly runningState = signal<readonly TimeSession[]>([]);
  private readonly recentState = signal<readonly TimeSession[]>([]);
  private readonly hasMoreState = signal(false);
  private readonly loadingState = signal(false);
  private readonly errorState = signal<DataError | null>(null);
  private sequence = 0;
  private loaded = false;
  private reading = 0;
  private latest: Promise<void> = Promise.resolve();
  private loadingMore = false;

  readonly running: Signal<readonly TimeSession[]> = this.runningState.asReadonly();
  /** First page of the history, most recent first, then the pages loaded since. */
  readonly recent: Signal<readonly TimeSession[]> = this.recentState.asReadonly();
  readonly hasMoreHistory: Signal<boolean> = this.hasMoreState.asReadonly();
  readonly loading: Signal<boolean> = this.loadingState.asReadonly();
  readonly error: Signal<DataError | null> = this.errorState.asReadonly();

  constructor() {
    void this.refresh();
  }

  /** Re-reads the running sessions and the first history page. Never rejects (see `error`). */
  refresh(): Promise<void> {
    this.latest = this.read();
    return this.latest;
  }

  private async read(): Promise<void> {
    const mine = ++this.sequence;
    this.reading++;
    // `loading` is for the first load only, not for background re-reads.
    if (!this.loaded) this.loadingState.set(true);
    try {
      const [running, recent] = await Promise.all([
        this.repository.listRunning(),
        this.repository.history({ limit: HISTORY_PAGE_SIZE }),
      ]);
      if (mine !== this.sequence) return;
      this.runningState.set(running);
      this.recentState.set(recent);
      this.hasMoreState.set(recent.length === HISTORY_PAGE_SIZE);
      this.loaded = true;
      this.errorState.set(null);
      this.refresher.arm(nextDeadline(running));
    } catch (error) {
      if (mine !== this.sequence) return;
      this.errorState.set(asDataError(error));
      this.refresher.arm(null);
    } finally {
      this.reading--;
      if (mine === this.sequence) this.loadingState.set(false);
    }
  }

  /** Appends the next history page. Does nothing when there is none or a page is being read. */
  async loadMoreHistory(): Promise<void> {
    const last = this.recentState().at(-1);
    if (!this.hasMoreState() || last === undefined || this.loadingMore || this.reading > 0) {
      return;
    }
    this.loadingMore = true;
    const mine = this.sequence;
    try {
      const page = await this.repository.history({
        before: { startedAt: last.startedAt, id: last.id },
        limit: HISTORY_PAGE_SIZE,
      });
      if (mine !== this.sequence) return;
      this.recentState.update((list) => [...list, ...page]);
      this.hasMoreState.set(page.length === HISTORY_PAGE_SIZE);
    } catch (error) {
      if (mine === this.sequence) this.errorState.set(asDataError(error));
    } finally {
      this.loadingMore = false;
    }
  }

  /** `id` is generated when absent. `durationMs` is null for a stopwatch. */
  start(input: {
    readonly id?: string;
    readonly kind: TimeSessionKind;
    readonly label: string;
    readonly durationMs: number | null;
  }): Promise<TimeSession> {
    return this.act(() => this.repository.start(input));
  }

  stop(id: string): Promise<TimeSession> {
    return this.act(() => this.repository.stop(id));
  }

  rename(id: string, label: string): Promise<TimeSession> {
    return this.act(() => this.repository.rename(id, label));
  }

  remove(id: string): Promise<boolean> {
    return this.act(() => this.repository.remove(id));
  }

  /** Runs an action, then re-reads (also after a failure: the state may have moved). */
  private async act<T>(action: () => Promise<T>): Promise<T> {
    this.errorState.set(null);
    try {
      const result = await action();
      await this.refresh();
      await this.latest;
      return result;
    } catch (error) {
      const failure = asDataError(error);
      await this.refresh();
      await this.latest;
      this.errorState.set(failure);
      throw failure;
    }
  }
}

/** Earliest `endsAt` among the running sessions that have one. */
function nextDeadline(running: readonly TimeSession[]): InstantIso | null {
  let earliest: InstantIso | null = null;
  for (const s of running) {
    if (s.endsAt !== null && (earliest === null || s.endsAt < earliest)) earliest = s.endsAt;
  }
  return earliest;
}
