import {
  DataError,
  type Clock,
  type InstantIso,
  type LocalDateTimeIso,
  type MarkSeenTarget,
  type Reminder,
  type ReminderDelivery,
  type ReminderInput,
  type ReminderRepository,
  SCHEDULE_LIMITS,
} from '../../data';
import { ManualClock } from '../time/testing/manual-clock';
import { hasControlCharacter } from './schedule-text';

/**
 * In-memory ReminderRepository following the semantics of the Rust commands (spec 4.4). It has no
 * recurrence engine: the next occurrence of a reminder is set by hand with `schedule`.
 */
export class FakeReminderRepository implements ReminderRepository {
  items: Reminder[] = [];
  deliveries: ReminderDelivery[] = [];
  /** Number of calls per method, for "re-read" assertions. */
  readonly calls = { list: 0, unseenDeliveries: 0, create: 0, update: 0, remove: 0, markSeen: 0 };
  private counter = 0;
  private nextFailure: unknown;

  constructor(private readonly clock: Clock = new ManualClock()) {}

  /** The next call rejects with `error`. */
  failNext(error: unknown): void {
    this.nextFailure = error;
  }

  /** Sets the cached next occurrence of a reminder (what the Rust scheduler would compute). */
  schedule(id: string, nextFireAt: InstantIso | null, nextFireKey: LocalDateTimeIso | null): void {
    this.replace(id, (r) => ({
      ...r,
      nextFireAt,
      nextFireKey,
      status: !r.enabled ? 'disabled' : nextFireAt === null ? 'finished' : 'scheduled',
    }));
  }

  /** Adds a delivery as the scheduler would. */
  addDelivery(delivery: Partial<ReminderDelivery> & Pick<ReminderDelivery, 'reminderId'>): void {
    const now = this.clock.nowIso();
    this.deliveries.push({
      title: 'Reminder',
      timeZone: 'Europe/Paris',
      occurrenceKey: '2026-01-01T08:00:00',
      dueAt: now,
      outcome: 'on_time',
      skippedCount: 0,
      seenAt: null,
      createdAt: now,
      ...delivery,
    });
  }

  async list(): Promise<Reminder[]> {
    this.calls.list++;
    this.check();
    return [...this.items].sort(
      (a, b) =>
        Number(a.nextFireAt === null) - Number(b.nextFireAt === null) ||
        (a.nextFireAt ?? '').localeCompare(b.nextFireAt ?? '') ||
        a.title.toLowerCase().localeCompare(b.title.toLowerCase()) ||
        a.id.localeCompare(b.id),
    );
  }

  async create(input: ReminderInput & { readonly id?: string }): Promise<Reminder> {
    this.calls.create++;
    this.check();
    this.validate(input);
    if (this.items.length >= SCHEDULE_LIMITS.maxReminders) {
      throw new DataError('forbidden', 'Too many reminders');
    }
    const id = input.id ?? `reminder-${++this.counter}`;
    if (this.items.some((r) => r.id === id)) throw new DataError('conflict', 'Id already used');
    const now = this.clock.nowIso();
    const reminder = this.build(id, input, now, now);
    this.items.push(reminder);
    return reminder;
  }

  async update(id: string, input: ReminderInput): Promise<Reminder> {
    this.calls.update++;
    this.check();
    this.validate(input);
    const existing = this.items.find((r) => r.id === id);
    if (!existing) throw new DataError('not_found', 'Reminder not found');
    const next = this.build(id, input, existing.createdAt, this.clock.nowIso());
    this.items = this.items.map((r) => (r.id === id ? next : r));
    return next;
  }

  async remove(id: string): Promise<boolean> {
    this.calls.remove++;
    this.check();
    const before = this.items.length;
    this.items = this.items.filter((r) => r.id !== id);
    this.deliveries = this.deliveries.filter((d) => d.reminderId !== id);
    return this.items.length < before;
  }

  async unseenDeliveries(limit: number): Promise<ReminderDelivery[]> {
    this.calls.unseenDeliveries++;
    this.check();
    if (!Number.isInteger(limit) || limit < 1 || limit > SCHEDULE_LIMITS.listMaxLimit) {
      throw new DataError('invalid_input', 'limit');
    }
    return this.deliveries
      .filter((d) => d.seenAt === null)
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) ||
          a.reminderId.localeCompare(b.reminderId) ||
          a.occurrenceKey.localeCompare(b.occurrenceKey),
      )
      .slice(0, limit);
  }

  async markSeen(target: MarkSeenTarget): Promise<number> {
    this.calls.markSeen++;
    this.check();
    const now = this.clock.nowIso();
    let marked = 0;
    this.deliveries = this.deliveries.map((d) => {
      const hit =
        d.seenAt === null &&
        (target.kind === 'all' ||
          (d.reminderId === target.reminderId && d.occurrenceKey === target.occurrenceKey));
      if (!hit) return d;
      marked++;
      return { ...d, seenAt: now };
    });
    return marked;
  }

  private validate(input: ReminderInput): void {
    if (
      input.title.trim() === '' ||
      [...input.title].length > SCHEDULE_LIMITS.titleMaxChars ||
      hasControlCharacter(input.title)
    ) {
      throw new DataError('invalid_input', 'title');
    }
    if (input.exdates.length > SCHEDULE_LIMITS.maxExdates)
      throw new DataError('invalid_input', 'exdates');
  }

  private build(id: string, input: ReminderInput, createdAt: string, updatedAt: string): Reminder {
    return {
      id,
      title: input.title,
      startLocal: input.startLocal,
      timeZone: input.timeZone,
      rrule: input.rrule,
      exdates: [...input.exdates],
      enabled: input.enabled,
      nextFireAt: null,
      nextFireKey: null,
      status: input.enabled ? 'finished' : 'disabled',
      createdAt,
      updatedAt,
    };
  }

  private replace(id: string, change: (r: Reminder) => Reminder): void {
    const index = this.items.findIndex((r) => r.id === id);
    if (index < 0) throw new Error(`Unknown reminder ${id}`);
    this.items[index] = change(this.items[index]);
  }

  private check(): void {
    if (this.nextFailure !== undefined) {
      const error = this.nextFailure;
      this.nextFailure = undefined;
      throw error;
    }
  }
}
