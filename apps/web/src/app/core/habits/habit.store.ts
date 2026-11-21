import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, Signal, effect, inject, signal, untracked } from '@angular/core';
import {
  CLOCK,
  DataError,
  HABIT_LIMITS,
  type Habit,
  type HabitCheck,
  type HabitInput,
  type LocalDateIso,
} from '../../data';
import { HABIT_REPOSITORY } from '../../data/schedule.tokens';
import { CalendarChanges } from '../calendar/calendar-changes';
import { DueRefresher } from '../time/due-refresher';
import { addDays } from '../time/local-date';
import { Today } from '../time/today';

export type HabitChecks = ReadonlyMap<string, ReadonlySet<LocalDateIso>>;

function asDataError(error: unknown): DataError {
  return error instanceof DataError
    ? error
    : new DataError('unknown', 'Unexpected habit error', { cause: error });
}

/**
 * Groups the rows per habit, re-applies the checks still waiting for Rust's answer and reuses the
 * previous Set of a habit whose days did not change (stable references for the consumers).
 */
function groupChecks(
  rows: readonly HabitCheck[],
  pending: ReadonlyMap<string, PendingCheck>,
  previous: HabitChecks,
): HabitChecks {
  const map = new Map<string, Set<LocalDateIso>>();
  const days = (habitId: string): Set<LocalDateIso> => {
    let set = map.get(habitId);
    if (set === undefined) map.set(habitId, (set = new Set<LocalDateIso>()));
    return set;
  };
  for (const row of rows) days(row.habitId).add(row.dayOn);
  for (const { habitId, dayOn, done } of pending.values()) {
    if (done) days(habitId).add(dayOn);
    else map.get(habitId)?.delete(dayOn);
  }
  const result = new Map<string, ReadonlySet<LocalDateIso>>();
  for (const [habitId, set] of map) {
    const old = previous.get(habitId);
    const same = old !== undefined && old.size === set.size && [...set].every((d) => old.has(d));
    result.set(habitId, same ? old : set);
  }
  return result;
}

interface PendingCheck {
  readonly habitId: string;
  readonly dayOn: LocalDateIso;
  readonly done: boolean;
}

/**
 * Habits and their checks over a 400-day window ending today, shared by every widget (spec habits
 * H5). Rust is the only writer: the store re-reads at first use, when the window is visible again
 * or focused, when the local day changes and after each of its actions. `setCheck` is optimistic
 * and rolled back by a re-read when it fails.
 */
@Injectable({ providedIn: 'root' })
export class HabitStore {
  private readonly repository = inject(HABIT_REPOSITORY);
  private readonly today = inject(Today);
  private readonly calendarChanges = inject(CalendarChanges);
  // Visibility and focus: re-read (no deadline to watch, so `arm` is never called).
  private readonly refresher = new DueRefresher(
    inject(DOCUMENT),
    inject(CLOCK),
    inject(DestroyRef),
    () => void this.refresh(),
  );

  private readonly habitsState = signal<readonly Habit[]>([]);
  private readonly checksState = signal<HabitChecks>(new Map());
  private readonly windowStartState = signal<LocalDateIso>(this.windowStartFor(this.today.date()));
  private readonly loadingState = signal(false);
  private readonly errorState = signal<DataError | null>(null);
  private sequence = 0;
  private activeReads = 0;
  /** Checks sent to Rust and not answered yet, re-applied on every read that lands meanwhile. */
  private readonly pendingChecks = new Map<string, PendingCheck>();
  private loaded = false;
  private readDay: LocalDateIso | null = null;
  private latest: Promise<void> = Promise.resolve();

  readonly habits: Signal<readonly Habit[]> = this.habitsState.asReadonly();
  /** Checked days per habit id, within the window. */
  readonly checks: Signal<HabitChecks> = this.checksState.asReadonly();
  /** First day of the loaded checks (today minus 399 days). */
  readonly windowStart: Signal<LocalDateIso> = this.windowStartState.asReadonly();
  readonly loading: Signal<boolean> = this.loadingState.asReadonly();
  readonly error: Signal<DataError | null> = this.errorState.asReadonly();

  constructor() {
    void this.refresh();
    // The window slides with the local day.
    effect(() => {
      const day = this.today.date();
      if (day !== this.readDay) untracked(() => void this.refresh());
    });
  }

  /** Re-reads habits and checks. Never rejects: a failure is exposed in `error`. */
  refresh(): Promise<void> {
    this.latest = this.read();
    return this.latest;
  }

  private windowStartFor(today: LocalDateIso): LocalDateIso {
    return addDays(today, 1 - HABIT_LIMITS.historyDays);
  }

  private async read(): Promise<void> {
    const mine = ++this.sequence;
    const day = this.today.date();
    this.readDay = day;
    const from = this.windowStartFor(day);
    // `loading` is for the first load only, not for background re-reads.
    if (!this.loaded) this.loadingState.set(true);
    this.activeReads++;
    try {
      const [habits, rows] = await Promise.all([
        this.repository.list(),
        this.repository.checks({ from, to: day }),
      ]);
      if (mine !== this.sequence) return;
      this.habitsState.set(habits);
      this.checksState.set(groupChecks(rows, this.pendingChecks, this.checksState()));
      this.windowStartState.set(from);
      this.loaded = true;
      this.errorState.set(null);
    } catch (error) {
      if (mine !== this.sequence) return;
      this.errorState.set(asDataError(error));
    } finally {
      this.activeReads--;
      if (mine === this.sequence) this.loadingState.set(false);
    }
  }

  create(input: HabitInput & { readonly id?: string }): Promise<Habit> {
    return this.act(() => this.repository.create(input));
  }

  update(id: string, input: HabitInput): Promise<Habit> {
    return this.act(() => this.repository.update(id, input));
  }

  setArchived(id: string, archived: boolean): Promise<Habit> {
    return this.act(() => this.repository.setArchived(id, archived));
  }

  remove(id: string): Promise<boolean> {
    return this.act(() => this.repository.remove(id));
  }

  /**
   * Checks or unchecks a day. The display changes at once and survives reads that land before
   * Rust answers. A failure restores the previous state of the day locally, re-reads and rejects.
   */
  async setCheck(habitId: string, dayOn: LocalDateIso, done: boolean): Promise<boolean> {
    const key = `${habitId}|${dayOn}`;
    const before = this.checksState().get(habitId)?.has(dayOn) ?? false;
    this.pendingChecks.set(key, { habitId, dayOn, done });
    this.applyCheck(habitId, dayOn, done);
    try {
      const changed = await this.repository.setCheck(habitId, dayOn, done);
      this.pendingChecks.delete(key);
      this.calendarChanges.notify('habits');
      // A read still in flight may have been answered before the commit: read again.
      if (this.activeReads > 0) void this.refresh();
      return changed;
    } catch (error) {
      const failure = asDataError(error);
      this.pendingChecks.delete(key);
      this.applyCheck(habitId, dayOn, before);
      await this.refresh();
      await this.latest;
      throw failure;
    }
  }

  private applyCheck(habitId: string, dayOn: LocalDateIso, done: boolean): void {
    this.checksState.update((current) => {
      const next = new Map(current);
      const days = new Set(next.get(habitId) ?? []);
      if (done) days.add(dayOn);
      else days.delete(dayOn);
      next.set(habitId, days);
      return next;
    });
  }

  /**
   * Runs an action, then re-reads (also after a failure: the state may have moved). A failed action
   * only rejects: `error` is for reads, and the re-read sets it if it fails itself.
   */
  private async act<T>(action: () => Promise<T>): Promise<T> {
    try {
      const result = await action();
      this.calendarChanges.notify('habits');
      await this.refresh();
      await this.latest;
      return result;
    } catch (error) {
      const failure = asDataError(error);
      await this.refresh();
      await this.latest;
      throw failure;
    }
  }
}
