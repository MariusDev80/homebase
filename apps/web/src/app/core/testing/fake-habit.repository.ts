import {
  DataError,
  HABIT_LIMITS,
  type Clock,
  type Habit,
  type HabitCheck,
  type HabitInput,
  type HabitReminder,
  type HabitRepository,
  type LocalDateIso,
} from '../../data';
import { addDays, compareLocalDates, daysBetween } from '../time/local-date';
import { ManualClock } from '../time/testing/manual-clock';
import { hasControlCharacter } from './schedule-text';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const FIRST_DAY = '1900-01-01';
const WEEK = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

/** Same error as the Rust `invalid_input`, so that `commandErrorDetails` reads its field (the cause carries it). */
function invalid(field: string): DataError {
  return new DataError('invalid_input', 'Invalid input', {
    cause: { kind: 'invalid_input', field },
  });
}

/** A DataError shaped like the one `invokeCommand` builds: the Rust error is the cause. */
function rustError(dataKind: 'forbidden' | 'not_found' | 'conflict', kind: string): DataError {
  return new DataError(dataKind, 'Command failed', { cause: { kind } });
}

/** Distinct tokens MO to SU, 1 to 7 of them (`mask_of`). */
function validDays(days: readonly string[]): boolean {
  return (
    days.length >= 1 &&
    days.length <= 7 &&
    new Set(days).size === days.length &&
    days.every((d) => WEEK.includes(d))
  );
}

/**
 * In-memory HabitRepository following the semantics of the Rust commands (spec habits 4.3). The
 * reminder next occurrence is not computed: its cache is always empty.
 */
export class FakeHabitRepository implements HabitRepository {
  items: Habit[] = [];
  checkRows: HabitCheck[] = [];
  /** Number of calls per method, for "re-read" assertions. */
  readonly calls = {
    list: 0,
    create: 0,
    update: 0,
    setArchived: 0,
    remove: 0,
    checks: 0,
    setCheck: 0,
  };
  private counter = 0;
  private nextFailure: unknown;

  constructor(private readonly clock: Clock = new ManualClock()) {}

  /** The next call rejects with `error`. */
  failNext(error: unknown): void {
    this.nextFailure = error;
  }

  async list(): Promise<Habit[]> {
    this.calls.list++;
    this.check();
    return [...this.items].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
  }

  async create(input: HabitInput & { readonly id?: string }): Promise<Habit> {
    this.calls.create++;
    this.check();
    this.validate(input);
    const id = input.id ?? `habit-${++this.counter}`;
    if (this.items.some((h) => h.id === id)) throw rustError('conflict', 'conflict');
    if (this.items.length >= HABIT_LIMITS.maxHabits) {
      throw rustError('forbidden', 'limit_reached');
    }
    const now = this.clock.nowIso();
    const habit = this.build(id, input, null, null, now, now);
    this.items.push(habit);
    return habit;
  }

  async update(id: string, input: HabitInput): Promise<Habit> {
    this.calls.update++;
    this.check();
    this.validate(input);
    const existing = this.find(id);
    const next = this.build(
      id,
      input,
      existing.archivedAt,
      existing.reminder,
      existing.createdAt,
      this.clock.nowIso(),
    );
    this.items = this.items.map((h) => (h.id === id ? next : h));
    return next;
  }

  async setArchived(id: string, archived: boolean): Promise<Habit> {
    this.calls.setArchived++;
    this.check();
    const existing = this.find(id);
    const next: Habit = archived
      ? {
          ...existing,
          archivedAt: existing.archivedAt ?? this.clock.nowIso(),
          reminder:
            existing.reminder === null
              ? null
              : { ...existing.reminder, enabled: false, status: 'disabled' },
        }
      : { ...existing, archivedAt: null };
    this.items = this.items.map((h) => (h.id === id ? next : h));
    return next;
  }

  async remove(id: string): Promise<boolean> {
    this.calls.remove++;
    this.check();
    const before = this.items.length;
    this.items = this.items.filter((h) => h.id !== id);
    this.checkRows = this.checkRows.filter((c) => c.habitId !== id);
    return this.items.length < before;
  }

  async checks(range: {
    readonly from: LocalDateIso;
    readonly to: LocalDateIso;
  }): Promise<HabitCheck[]> {
    this.calls.checks++;
    this.check();
    if (
      compareLocalDates(range.from, range.to) > 0 ||
      daysBetween(range.from, range.to) >= HABIT_LIMITS.historyDays
    ) {
      throw invalid('to');
    }
    return this.checkRows
      .filter(
        (c) =>
          compareLocalDates(c.dayOn, range.from) >= 0 && compareLocalDates(c.dayOn, range.to) <= 0,
      )
      .map((c) => ({ ...c }));
  }

  async setCheck(habitId: string, dayOn: LocalDateIso, done: boolean): Promise<boolean> {
    this.calls.setCheck++;
    this.check();
    // Same order as Rust: the date is validated before the habit is looked up.
    if (compareLocalDates(dayOn, FIRST_DAY) < 0 || compareLocalDates(dayOn, this.latestDay()) > 0) {
      throw invalid('dayOn');
    }
    const habit = this.find(habitId);
    if (compareLocalDates(dayOn, habit.startOn) < 0) throw invalid('dayOn');
    const present = this.checkRows.some((c) => c.habitId === habitId && c.dayOn === dayOn);
    if (done === present) return false;
    this.checkRows = done
      ? [...this.checkRows, { habitId, dayOn }]
      : this.checkRows.filter((c) => !(c.habitId === habitId && c.dayOn === dayOn));
    return true;
  }

  /** `latest_allowed_day`: the UTC date of now plus one day. */
  private latestDay(): LocalDateIso {
    return addDays(this.clock.nowIso().slice(0, 10), 1);
  }

  private find(id: string): Habit {
    const habit = this.items.find((h) => h.id === id);
    if (!habit) throw rustError('not_found', 'not_found');
    return habit;
  }

  private validate(input: HabitInput): void {
    const title = input.title;
    if (
      title.trim() === '' ||
      [...title].length > HABIT_LIMITS.titleMaxChars ||
      hasControlCharacter(title)
    ) {
      throw invalid('title');
    }
    const schedule = input.schedule;
    if (schedule.kind === 'days' && !validDays(schedule.days)) {
      throw invalid('schedule.days');
    }
    if (
      schedule.kind === 'weekly' &&
      (!Number.isInteger(schedule.target) || schedule.target < 1 || schedule.target > 7)
    ) {
      throw invalid('schedule.target');
    }
    if (
      compareLocalDates(input.startOn, FIRST_DAY) < 0 ||
      compareLocalDates(input.startOn, this.latestDay()) > 0
    ) {
      throw invalid('startOn');
    }
    if (input.reminder !== null) {
      if (!TIME.test(input.reminder.time)) throw invalid('reminder.time');
      if (!validDays(input.reminder.days)) throw invalid('reminder.days');
    }
  }

  private build(
    id: string,
    input: HabitInput,
    archivedAt: string | null,
    existing: HabitReminder | null,
    createdAt: string,
    updatedAt: string,
  ): Habit {
    let reminder: HabitReminder | null = null;
    if (input.reminder !== null) {
      // An archived habit keeps its reminder disabled (H7); an existing reminder keeps its id.
      const enabled = archivedAt === null && input.reminder.enabled;
      reminder = {
        reminderId: existing?.reminderId ?? `reminder-${++this.counter}`,
        time: input.reminder.time,
        days: [...input.reminder.days],
        timeZone: existing?.timeZone ?? input.reminder.timeZone,
        enabled,
        nextFireAt: null,
        nextFireKey: null,
        status: enabled ? 'finished' : 'disabled',
      };
    }
    const schedule =
      input.schedule.kind === 'days'
        ? { kind: 'days' as const, days: [...input.schedule.days] }
        : { kind: 'weekly' as const, target: input.schedule.target };
    return {
      id,
      title: input.title,
      schedule,
      startOn: input.startOn,
      archivedAt,
      reminder,
      createdAt,
      updatedAt,
    };
  }

  private check(): void {
    if (this.nextFailure !== undefined) {
      const error = this.nextFailure;
      this.nextFailure = undefined;
      throw error;
    }
  }
}
