import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, Signal, inject, signal } from '@angular/core';
import {
  CLOCK,
  DataError,
  SCHEDULE_LIMITS,
  type InstantIso,
  type MarkSeenTarget,
  type Reminder,
  type ReminderDelivery,
  type ReminderInput,
} from '../../data';
import { REMINDER_REPOSITORY } from '../../data/schedule.tokens';
import { CalendarChanges } from '../calendar/calendar-changes';
import { DueRefresher } from '../time';

/** Rust accepts at most 200 deliveries per read (spec 4.4). */
export const UNSEEN_DELIVERIES_LIMIT = 200;
/** ADR-003 section 3.5.3. */
export const MAX_EXDATES = SCHEDULE_LIMITS.maxExdates;

function asDataError(error: unknown): DataError {
  return error instanceof DataError
    ? error
    : new DataError('unknown', 'Unexpected reminder error', { cause: error });
}

/**
 * Reminders and their unseen deliveries, shared by every widget (spec timers-reminders M9). The
 * Rust scheduler is the only writer of deadlines and there is no push (D8): the store re-reads at
 * first use, when the window is visible again or focused, after each of its actions, and 1 s after
 * the next displayed deadline.
 */
@Injectable({ providedIn: 'root' })
export class ReminderStore {
  private readonly repository = inject(REMINDER_REPOSITORY);
  private readonly calendarChanges = inject(CalendarChanges);
  private readonly refresher = new DueRefresher(
    inject(DOCUMENT),
    inject(CLOCK),
    inject(DestroyRef),
    () => void this.refresh(),
  );

  private readonly remindersState = signal<readonly Reminder[]>([]);
  private readonly unseenState = signal<readonly ReminderDelivery[]>([]);
  private readonly loadingState = signal(false);
  private readonly errorState = signal<DataError | null>(null);
  private sequence = 0;
  private loaded = false;
  private latest: Promise<void> = Promise.resolve();

  readonly reminders: Signal<readonly Reminder[]> = this.remindersState.asReadonly();
  readonly unseen: Signal<readonly ReminderDelivery[]> = this.unseenState.asReadonly();
  readonly loading: Signal<boolean> = this.loadingState.asReadonly();
  readonly error: Signal<DataError | null> = this.errorState.asReadonly();

  constructor() {
    void this.refresh();
  }

  /** Re-reads reminders and unseen deliveries. Never rejects: a failure is exposed in `error`. */
  refresh(): Promise<void> {
    this.latest = this.read();
    return this.latest;
  }

  private async read(): Promise<void> {
    const mine = ++this.sequence;
    // `loading` is for the first load only, not for background re-reads.
    if (!this.loaded) this.loadingState.set(true);
    try {
      const [reminders, unseen] = await Promise.all([
        this.repository.list(),
        this.repository.unseenDeliveries(UNSEEN_DELIVERIES_LIMIT),
      ]);
      if (mine !== this.sequence) return;
      this.remindersState.set(reminders);
      this.unseenState.set(unseen);
      this.loaded = true;
      this.errorState.set(null);
      this.refresher.arm(nextDeadline(reminders));
    } catch (error) {
      if (mine !== this.sequence) return;
      this.errorState.set(asDataError(error));
      this.refresher.arm(null);
    } finally {
      if (mine === this.sequence) this.loadingState.set(false);
    }
  }

  create(input: ReminderInput & { readonly id?: string }): Promise<Reminder> {
    return this.act(() => this.repository.create(input), true);
  }

  update(id: string, input: ReminderInput): Promise<Reminder> {
    return this.act(() => this.repository.update(id, input), true);
  }

  remove(id: string): Promise<boolean> {
    return this.act(() => this.repository.remove(id), true);
  }

  /** Not a calendar change: the calendar shows reminders, not their deliveries. */
  markSeen(target: MarkSeenTarget): Promise<number> {
    return this.act(() => this.repository.markSeen(target), false);
  }

  /**
   * Skips the next occurrence of a series: its key joins the exceptions (M8, D12). Rejects with
   * invalid_input when there is no next occurrence. The 366 limit is not checked here: the Rust
   * scheduler applies it (answers invalid_input), after pruning a saturated list of the entries
   * older than the catch-up window, so a full list must still reach it.
   */
  skipNext(reminder: Reminder): Promise<Reminder> {
    const refuse = (message: string): Promise<never> => {
      return Promise.reject(new DataError('invalid_input', message));
    };
    const key = reminder.nextFireKey;
    if (key === null) return refuse('No next occurrence to skip');
    const exdates = [...new Set([...reminder.exdates, key])].sort();
    return this.update(reminder.id, {
      title: reminder.title,
      startLocal: reminder.startLocal,
      timeZone: reminder.timeZone,
      rrule: reminder.rrule,
      exdates,
      enabled: reminder.enabled,
    });
  }

  /**
   * Runs an action, then re-reads (also after a failure: the state may have moved). A failed action
   * only rejects: `error` is for reads, and the re-read sets it if it fails itself.
   */
  private async act<T>(action: () => Promise<T>, calendarChange: boolean): Promise<T> {
    try {
      const result = await action();
      if (calendarChange) this.calendarChanges.notify('reminders');
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

/** Earliest deadline among the reminders that are waiting for one. */
function nextDeadline(reminders: readonly Reminder[]): InstantIso | null {
  let earliest: InstantIso | null = null;
  for (const r of reminders) {
    if (r.status !== 'scheduled' || r.nextFireAt === null) continue;
    if (earliest === null || r.nextFireAt < earliest) earliest = r.nextFireAt;
  }
  return earliest;
}
