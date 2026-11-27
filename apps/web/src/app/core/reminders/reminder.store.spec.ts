import { TestBed } from '@angular/core/testing';
import { CLOCK, DataError, type Reminder, type ReminderInput } from '../../data';
import { REMINDER_REPOSITORY } from '../../data/schedule.tokens';
import { CalendarChanges } from '../calendar/calendar-changes';
import { FakeReminderRepository } from '../testing/fake-reminder.repository';
import { ManualClock } from '../time/testing/manual-clock';
import { MAX_EXDATES, ReminderStore } from './reminder.store';

const INPUT: ReminderInput = {
  title: 'Pills',
  startLocal: '2026-11-16T08:00:00',
  timeZone: 'Europe/Paris',
  rrule: 'FREQ=DAILY',
  exdates: [],
  enabled: true,
};

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('ReminderStore', () => {
  let clock: ManualClock;
  let repo: FakeReminderRepository;

  /** Lets pending promises settle without moving the fake timers. */
  const flush = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(0);
  };

  async function create(): Promise<ReminderStore> {
    TestBed.configureTestingModule({
      providers: [
        { provide: CLOCK, useValue: clock },
        { provide: REMINDER_REPOSITORY, useValue: repo },
      ],
    });
    const store = TestBed.inject(ReminderStore);
    await flush();
    return store;
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    clock = new ManualClock('2026-11-16T10:00:00.000Z');
    repo = new FakeReminderRepository(clock);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('reads reminders and unseen deliveries at first use', async () => {
    const seeded = await repo.create(INPUT);
    repo.addDelivery({ reminderId: seeded.id });
    repo.calls.list = 0;
    const store = await create();
    expect(repo.calls.list).toBe(1);
    expect(store.reminders().map((r) => r.id)).toEqual([seeded.id]);
    expect(store.unseen()).toHaveLength(1);
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('re-reads 1 s after the next deadline', async () => {
    const r = await repo.create(INPUT);
    repo.schedule(r.id, '2026-11-16T10:00:30.000Z', '2026-11-16T11:00:30');
    const store = await create();
    expect(repo.calls.list).toBe(1);
    await vi.advanceTimersByTimeAsync(30_999);
    expect(repo.calls.list).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(repo.calls.list).toBe(2);
    expect(store.reminders()).toHaveLength(1);
  });

  it('does not wait for a disabled or finished reminder', async () => {
    await repo.create(INPUT);
    await repo.create({ ...INPUT, enabled: false });
    await create();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('re-reads on focus', async () => {
    await create();
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(repo.calls.list).toBe(2);
  });

  it('re-reads after each action', async () => {
    const store = await create();
    const created = await store.create(INPUT);
    expect(repo.calls.list).toBe(2);
    expect(store.reminders().map((r) => r.id)).toEqual([created.id]);
    await store.update(created.id, { ...INPUT, title: 'Vitamins' });
    expect(store.reminders()[0].title).toBe('Vitamins');
    repo.addDelivery({ reminderId: created.id });
    await store.refresh();
    expect(store.unseen()).toHaveLength(1);
    await expect(store.markSeen({ kind: 'all' })).resolves.toBe(1);
    expect(store.unseen()).toHaveLength(0);
    await expect(store.remove(created.id)).resolves.toBe(true);
    expect(store.reminders()).toEqual([]);
    expect(repo.calls.list).toBe(6);
  });

  it('rejects a failed action and leaves error for reads', async () => {
    const store = await create();
    const failure = new DataError('invalid_input', 'title');
    repo.failNext(failure);
    await expect(store.create(INPUT)).rejects.toBe(failure);
    expect(store.error()).toBeNull();
  });

  it('notifies the calendar after a successful create, update, remove and skipNext (CA-C3-1)', async () => {
    const store = await create();
    const changes = TestBed.inject(CalendarChanges);
    expect(changes.version()).toBe(0);
    const created = await store.create(INPUT);
    expect(changes.version()).toBe(1);
    await store.update(created.id, { ...INPUT, title: 'Vitamins' });
    expect(changes.version()).toBe(2);
    repo.schedule(created.id, '2026-11-16T10:00:30.000Z', '2026-11-17T08:00:00');
    await store.refresh();
    await store.skipNext(store.reminders()[0]);
    expect(changes.version()).toBe(3);
    await store.remove(created.id);
    expect(changes.version()).toBe(4);
  });

  it('does not notify the calendar after a failure or markSeen (CA-C3-1)', async () => {
    const store = await create();
    const changes = TestBed.inject(CalendarChanges);
    repo.failNext(new DataError('invalid_input', 'title'));
    await expect(store.create(INPUT)).rejects.toBeInstanceOf(DataError);
    await store.markSeen({ kind: 'all' });
    expect(changes.version()).toBe(0);
  });

  it('exposes the failed re-read that follows a failed action', async () => {
    const store = await create();
    const failure = new DataError('invalid_input', 'title');
    const readFailure = new DataError('busy', 'busy');
    vi.spyOn(repo, 'create').mockRejectedValue(failure);
    vi.spyOn(repo, 'list').mockRejectedValue(readFailure);
    await expect(store.create(INPUT)).rejects.toBe(failure);
    expect(store.error()).toBe(readFailure);
  });

  it('loading is true only until the first load, not during background re-reads', async () => {
    const store = await create();
    expect(store.loading()).toBe(false);
    const pending = store.refresh();
    expect(store.loading()).toBe(false);
    await pending;
  });

  it('a stale response never overwrites a more recent one', async () => {
    const gates: Deferred<Reminder[]>[] = [];
    repo.list = () => {
      const gate = deferred<Reminder[]>();
      gates.push(gate);
      return gate.promise;
    };
    const store = await create(); // read 1, pending
    const second = store.refresh(); // read 2, pending
    const fresh = { ...(await repo.create(INPUT)), title: 'fresh' };
    gates[1].resolve([fresh]);
    await second;
    gates[0].resolve([{ ...fresh, title: 'stale' }]);
    await flush();
    expect(store.reminders().map((r) => r.title)).toEqual(['fresh']);
  });

  it('rejects a skipNext refusal without touching error', async () => {
    await repo.create(INPUT);
    const store = await create();
    await expect(store.skipNext(store.reminders()[0])).rejects.toBeInstanceOf(DataError);
    expect(store.error()).toBeNull();
  });

  it('exposes a read error without throwing', async () => {
    repo.failNext(new DataError('unavailable', 'no tauri'));
    const store = await create();
    expect(store.error()?.kind).toBe('unavailable');
    expect(store.reminders()).toEqual([]);
    await store.refresh();
    expect(store.error()).toBeNull();
  });

  describe('skipNext', () => {
    it('adds the next occurrence key to the sorted exceptions', async () => {
      const r = await repo.create({ ...INPUT, exdates: ['2026-12-01T08:00:00'] });
      repo.schedule(r.id, '2026-11-17T07:00:00.000Z', '2026-11-17T08:00:00');
      const store = await create();
      const updated = await store.skipNext(store.reminders()[0]);
      expect(updated.exdates).toEqual(['2026-11-17T08:00:00', '2026-12-01T08:00:00']);
      expect(updated.title).toBe('Pills');
      expect(store.reminders()[0].exdates).toEqual(updated.exdates);
    });

    it('refuses when there is no next occurrence', async () => {
      await repo.create(INPUT);
      const store = await create();
      await expect(store.skipNext(store.reminders()[0])).rejects.toMatchObject({
        kind: 'invalid_input',
      });
    });

    it('sends a full list of 366 exceptions plus the new key to the repository (Rust prunes it)', async () => {
      const r = await repo.create(INPUT);
      repo.schedule(r.id, '2026-11-17T07:00:00.000Z', '2030-01-01T08:00:00');
      const store = await create();
      const exdates = Array.from({ length: MAX_EXDATES }, (_, i) => `opaque-${i}`);
      const full = { ...store.reminders()[0], exdates };
      const spy = vi.spyOn(repo, 'update').mockResolvedValue(store.reminders()[0]);
      await store.skipNext(full);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][1].exdates).toHaveLength(MAX_EXDATES + 1);
    });

    it('propagates an invalid_input from the repository', async () => {
      const r = await repo.create(INPUT);
      repo.schedule(r.id, '2026-11-17T07:00:00.000Z', '2030-01-01T08:00:00');
      const store = await create();
      const failure = new DataError('invalid_input', 'exdates');
      vi.spyOn(repo, 'update').mockRejectedValue(failure);
      await expect(store.skipNext(store.reminders()[0])).rejects.toBe(failure);
    });
  });
});
