import { TestBed } from '@angular/core/testing';
import { CLOCK, DataError, SETTINGS_REPOSITORY, type Habit, type HabitInput } from '../../data';
import { HABIT_REPOSITORY } from '../../data/schedule.tokens';
import { FakeHabitRepository } from '../testing/fake-habit.repository';
import { FakeSettingsRepository } from '../testing/fake-settings.repository';
import { ManualClock } from '../time/testing/manual-clock';
import { SYSTEM_TIME_ZONE_READER } from '../time/time-zone';
import { CalendarChanges } from '../calendar/calendar-changes';
import { HabitStore } from './habit.store';

const INPUT: HabitInput = {
  title: 'Meditate',
  schedule: { kind: 'days', days: ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] },
  startOn: '2026-11-01',
  reminder: null,
};

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('HabitStore', () => {
  let clock: ManualClock;
  let repo: FakeHabitRepository;

  /** Lets pending promises settle without moving the fake timers. */
  const flush = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(0);
  };

  async function create(): Promise<HabitStore> {
    TestBed.configureTestingModule({
      providers: [
        { provide: CLOCK, useValue: clock },
        { provide: HABIT_REPOSITORY, useValue: repo },
        { provide: SETTINGS_REPOSITORY, useValue: new FakeSettingsRepository() },
        { provide: SYSTEM_TIME_ZONE_READER, useValue: () => 'Europe/Paris' },
      ],
    });
    const store = TestBed.inject(HabitStore);
    TestBed.tick();
    await flush();
    return store;
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    clock = new ManualClock('2026-11-17T10:00:00.000Z');
    repo = new FakeHabitRepository(clock);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('reads habits and the 400-day window of checks at first use', async () => {
    const habit = await repo.create(INPUT);
    await repo.setCheck(habit.id, '2026-11-16', true);
    repo.calls.list = 0;
    const checksSpy = vi.spyOn(repo, 'checks');
    const store = await create();
    expect(repo.calls.list).toBe(1);
    expect(checksSpy).toHaveBeenCalledWith({ from: '2025-10-14', to: '2026-11-17' });
    expect(store.windowStart()).toBe('2025-10-14');
    expect(store.habits().map((h) => h.id)).toEqual([habit.id]);
    expect([...(store.checks().get(habit.id) ?? [])]).toEqual(['2026-11-16']);
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('re-reads on focus', async () => {
    await create();
    expect(repo.calls.list).toBe(1);
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(repo.calls.list).toBe(2);
  });

  it('re-reads when the local day changes and slides the window', async () => {
    const store = await create();
    expect(repo.calls.list).toBe(1);
    clock.set('2026-11-17T23:00:01.000Z'); // 00:00:01 on the 18th in Paris
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    TestBed.tick();
    await flush();
    expect(repo.calls.list).toBe(2);
    expect(store.windowStart()).toBe('2025-10-15');
  });

  it('re-reads after each action', async () => {
    const store = await create();
    const created = await store.create(INPUT);
    expect(repo.calls.list).toBe(2);
    expect(store.habits().map((h) => h.id)).toEqual([created.id]);
    await store.update(created.id, { ...INPUT, title: 'Read' });
    expect(store.habits()[0].title).toBe('Read');
    await store.setArchived(created.id, true);
    expect(store.habits()[0].archivedAt).not.toBeNull();
    await expect(store.remove(created.id)).resolves.toBe(true);
    expect(store.habits()).toEqual([]);
    expect(repo.calls.list).toBe(5);
  });

  it('rejects a failed action and leaves error for reads', async () => {
    const store = await create();
    const failure = new DataError('invalid_input', 'title');
    repo.failNext(failure);
    await expect(store.create(INPUT)).rejects.toBe(failure);
    expect(store.error()).toBeNull();
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

  it('loading is true only until the first successful load', async () => {
    repo.failNext(new DataError('unavailable', 'no tauri'));
    const store = await create();
    expect(store.loading()).toBe(false);
    expect(store.error()?.kind).toBe('unavailable');
    const pending = store.refresh();
    expect(store.loading()).toBe(true);
    await pending;
    expect(store.error()).toBeNull();
    const again = store.refresh();
    expect(store.loading()).toBe(false);
    await again;
  });

  it('a stale response never overwrites a more recent one', async () => {
    const gates: Deferred<Habit[]>[] = [];
    repo.list = () => {
      const gate = deferred<Habit[]>();
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
    expect(store.habits().map((h) => h.title)).toEqual(['fresh']);
  });

  describe('CalendarChanges (CA-CO3-4)', () => {
    it('notifies once per successful write', async () => {
      const store = await create();
      const changes = TestBed.inject(CalendarChanges);
      const before = changes.version();
      const habit = await store.create(INPUT);
      expect(changes.version()).toBe(before + 1);
      await store.update(habit.id, { ...INPUT, title: 'Read' });
      expect(changes.version()).toBe(before + 2);
      await store.setArchived(habit.id, true);
      expect(changes.version()).toBe(before + 3);
      await store.setCheck(habit.id, '2026-11-17', true);
      expect(changes.version()).toBe(before + 4);
      await store.remove(habit.id);
      expect(changes.version()).toBe(before + 5);
    });

    it('does not notify after a failure nor after a re-read', async () => {
      const store = await create();
      const changes = TestBed.inject(CalendarChanges);
      const habit = await store.create(INPUT);
      const before = changes.version();
      repo.failNext(new DataError('invalid_input', 'title'));
      await expect(store.update(habit.id, INPUT)).rejects.toBeInstanceOf(DataError);
      vi.spyOn(repo, 'setCheck').mockRejectedValueOnce(new DataError('invalid_input', 'dayOn'));
      await expect(store.setCheck(habit.id, '2026-11-17', true)).rejects.toBeInstanceOf(DataError);
      await store.refresh();
      window.dispatchEvent(new Event('focus'));
      await flush();
      expect(changes.version()).toBe(before);
    });
  });

  describe('setCheck', () => {
    it('is optimistic: the check shows before Rust answers', async () => {
      const habit = await repo.create(INPUT);
      const store = await create();
      const gate = deferred<boolean>();
      vi.spyOn(repo, 'setCheck').mockReturnValue(gate.promise);
      const pending = store.setCheck(habit.id, '2026-11-17', true);
      expect(store.checks().get(habit.id)?.has('2026-11-17')).toBe(true);
      gate.resolve(true);
      await expect(pending).resolves.toBe(true);
      expect(store.checks().get(habit.id)?.has('2026-11-17')).toBe(true);
    });

    it('unchecks optimistically', async () => {
      const habit = await repo.create(INPUT);
      await repo.setCheck(habit.id, '2026-11-17', true);
      const store = await create();
      expect(store.checks().get(habit.id)?.has('2026-11-17')).toBe(true);
      await store.setCheck(habit.id, '2026-11-17', false);
      expect(store.checks().get(habit.id)?.has('2026-11-17')).toBe(false);
      expect(repo.checkRows).toEqual([]);
    });

    it('is rolled back and rejects when Rust refuses', async () => {
      const habit = await repo.create(INPUT);
      const store = await create();
      const failure = new DataError('invalid_input', 'dayOn');
      repo.failNext(failure);
      const pending = store.setCheck(habit.id, '2026-11-17', true);
      expect(store.checks().get(habit.id)?.has('2026-11-17')).toBe(true);
      await expect(pending).rejects.toBe(failure);
      expect(store.checks().get(habit.id)?.has('2026-11-17') ?? false).toBe(false);
      expect(store.error()).toBeNull();
    });

    it('a read in flight before the commit does not erase the check', async () => {
      const habit = await repo.create(INPUT);
      const store = await create();
      const gate = deferred<Habit[]>();
      const original = repo.list.bind(repo);
      vi.spyOn(repo, 'list').mockImplementationOnce(() => gate.promise);
      const read = store.refresh(); // blocked on list()
      const rows = await original();
      await store.setCheck(habit.id, '2026-11-17', true); // committed while the read is in flight
      expect(store.checks().get(habit.id)?.has('2026-11-17')).toBe(true);
      gate.resolve(rows); // the read answers with checks read before the commit
      await read;
      await flush();
      expect(store.checks().get(habit.id)?.has('2026-11-17')).toBe(true);
    });

    it('a failure rolls back only its own day', async () => {
      const first = await repo.create(INPUT);
      const second = await repo.create({ ...INPUT, title: 'Read' });
      const store = await create();
      const gate = deferred<boolean>();
      const failure = new DataError('invalid_input', 'dayOn');
      vi.spyOn(repo, 'setCheck').mockRejectedValueOnce(failure).mockReturnValueOnce(gate.promise);
      const failing = store.setCheck(first.id, '2026-11-17', true);
      const slow = store.setCheck(second.id, '2026-11-17', true);
      await expect(failing).rejects.toBe(failure);
      expect(store.checks().get(first.id)?.has('2026-11-17') ?? false).toBe(false);
      expect(store.checks().get(second.id)?.has('2026-11-17')).toBe(true);
      gate.resolve(true);
      await slow;
    });

    it('an older failing check does not undo a newer one of the same day', async () => {
      const habit = await repo.create(INPUT);
      const store = await create();
      const older = deferred<boolean>();
      const newer = deferred<boolean>();
      vi.spyOn(repo, 'setCheck')
        .mockReturnValueOnce(older.promise)
        .mockReturnValueOnce(newer.promise);
      const first = store.setCheck(habit.id, '2026-11-17', true);
      const second = store.setCheck(habit.id, '2026-11-17', true);
      const failure = new DataError('invalid_input', 'dayOn');
      older.reject(failure);
      await expect(first).rejects.toBe(failure);
      expect(store.checks().get(habit.id)?.has('2026-11-17')).toBe(true);
      newer.resolve(true);
      await second;
    });

    it('restores the day locally when the re-read fails too', async () => {
      const habit = await repo.create(INPUT);
      await repo.setCheck(habit.id, '2026-11-16', true);
      const store = await create();
      const readFailure = new DataError('busy', 'busy');
      vi.spyOn(repo, 'setCheck').mockRejectedValue(new DataError('invalid_input', 'dayOn'));
      vi.spyOn(repo, 'list').mockRejectedValue(readFailure);
      await expect(store.setCheck(habit.id, '2026-11-17', true)).rejects.toBeInstanceOf(DataError);
      await expect(store.setCheck(habit.id, '2026-11-16', false)).rejects.toBeInstanceOf(DataError);
      const days = store.checks().get(habit.id);
      expect(days?.has('2026-11-17')).toBe(false);
      expect(days?.has('2026-11-16')).toBe(true);
      expect(store.error()).toBe(readFailure);
    });

    it('keeps the same Set for a habit whose checks did not change', async () => {
      const habit = await repo.create(INPUT);
      await repo.setCheck(habit.id, '2026-11-16', true);
      const store = await create();
      const before = store.checks().get(habit.id);
      await store.refresh();
      expect(store.checks().get(habit.id)).toBe(before);
    });
  });
});
