import {
  DataError,
  type Clock,
  type InstantIso,
  type TimeSession,
  type TimeSessionKind,
  type TimeSessionRepository,
  SCHEDULE_LIMITS,
} from '../../data';
import { ManualClock } from '../time/testing/manual-clock';
import { addDuration } from '../time/zoned';
import { hasControlCharacter } from './schedule-text';

const POMODORO_KINDS: readonly TimeSessionKind[] = [
  'pomodoro_work',
  'pomodoro_short_break',
  'pomodoro_long_break',
];

/**
 * In-memory TimeSessionRepository following the semantics of the Rust commands (spec 4.4): the
 * start and end instants come from the clock, and every call first completes the sessions whose
 * deadline has passed (the scheduler's job in production).
 */
export class FakeTimeSessionRepository implements TimeSessionRepository {
  items: TimeSession[] = [];
  readonly calls = { listRunning: 0, history: 0, start: 0, stop: 0, rename: 0, remove: 0 };
  private counter = 0;
  private nextFailure: unknown;

  constructor(private readonly clock: Clock = new ManualClock()) {}

  failNext(error: unknown): void {
    this.nextFailure = error;
  }

  async listRunning(): Promise<TimeSession[]> {
    this.calls.listRunning++;
    this.check();
    this.settle();
    return this.items
      .filter((s) => s.endedAt === null)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
  }

  async history(page: {
    readonly before?: { readonly startedAt: InstantIso; readonly id: string };
    readonly limit: number;
  }): Promise<TimeSession[]> {
    this.calls.history++;
    this.check();
    if (
      !Number.isInteger(page.limit) ||
      page.limit < 1 ||
      page.limit > SCHEDULE_LIMITS.listMaxLimit
    ) {
      throw new DataError('invalid_input', 'limit');
    }
    this.settle();
    const { before } = page;
    return this.items
      .filter(
        (s) =>
          s.endedAt !== null &&
          (!before ||
            s.startedAt < before.startedAt ||
            (s.startedAt === before.startedAt && s.id < before.id)),
      )
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id))
      .slice(0, page.limit);
  }

  async start(input: {
    readonly id?: string;
    readonly kind: TimeSessionKind;
    readonly label: string;
    readonly durationMs: number | null;
  }): Promise<TimeSession> {
    this.calls.start++;
    this.check();
    this.checkLabel(input.label);
    if ((input.kind === 'stopwatch') !== (input.durationMs === null)) {
      throw new DataError('invalid_input', 'durationMs');
    }
    if (
      input.durationMs !== null &&
      !(
        Number.isInteger(input.durationMs) &&
        input.durationMs >= SCHEDULE_LIMITS.durationMinMs &&
        input.durationMs <= SCHEDULE_LIMITS.durationMaxMs
      )
    ) {
      throw new DataError('invalid_input', 'durationMs');
    }
    this.settle();
    const id = input.id ?? `session-${++this.counter}`;
    if (this.items.some((s) => s.id === id)) throw new DataError('conflict', 'Id already used');
    const running = this.items.filter((s) => s.endedAt === null);
    if (running.length >= SCHEDULE_LIMITS.maxRunningSessions)
      throw new DataError('forbidden', 'Too many sessions');
    if (
      POMODORO_KINDS.includes(input.kind) &&
      running.some((s) => POMODORO_KINDS.includes(s.kind))
    ) {
      throw new DataError('conflict', 'A pomodoro is already running');
    }
    const now = this.clock.nowIso();
    const session: TimeSession = {
      id,
      kind: input.kind,
      label: input.label,
      startedAt: now,
      endsAt: input.durationMs === null ? null : addDuration(now, input.durationMs),
      endedAt: null,
      endReason: null,
      createdAt: now,
      updatedAt: now,
    };
    this.items.push(session);
    return session;
  }

  async stop(id: string): Promise<TimeSession> {
    this.calls.stop++;
    this.check();
    this.settle();
    const current = this.find(id);
    if (current.endedAt !== null) return current;
    const now = this.clock.nowIso();
    return this.replace({
      ...current,
      endedAt: now > current.startedAt ? now : current.startedAt,
      endReason: 'stopped',
      updatedAt: now,
    });
  }

  async rename(id: string, label: string): Promise<TimeSession> {
    this.calls.rename++;
    this.check();
    this.checkLabel(label);
    const current = this.find(id);
    return this.replace({ ...current, label, updatedAt: this.clock.nowIso() });
  }

  async remove(id: string): Promise<boolean> {
    this.calls.remove++;
    this.check();
    this.settle();
    const before = this.items.length;
    this.items = this.items.filter((s) => s.id !== id);
    return this.items.length < before;
  }

  /** Completes the sessions whose deadline has passed: ended_at = ends_at. */
  private settle(): void {
    const now = this.clock.nowIso();
    this.items = this.items.map((s) =>
      s.endedAt === null && s.endsAt !== null && s.endsAt <= now
        ? { ...s, endedAt: s.endsAt, endReason: 'completed', updatedAt: now }
        : s,
    );
  }

  private checkLabel(label: string): void {
    if ([...label].length > SCHEDULE_LIMITS.labelMaxChars || hasControlCharacter(label)) {
      throw new DataError('invalid_input', 'label');
    }
  }

  private find(id: string): TimeSession {
    const session = this.items.find((s) => s.id === id);
    if (!session) throw new DataError('not_found', 'Session not found');
    return session;
  }

  private replace(next: TimeSession): TimeSession {
    this.items = this.items.map((s) => (s.id === next.id ? next : s));
    return next;
  }

  private check(): void {
    if (this.nextFailure !== undefined) {
      const error = this.nextFailure;
      this.nextFailure = undefined;
      throw error;
    }
  }
}
