import { TestBed } from '@angular/core/testing';
import { CLOCK, DataError, type TimeSession } from '../../data';
import { TIME_SESSION_REPOSITORY } from '../../data/schedule.tokens';
import { FakeTimeSessionRepository } from '../testing/fake-time-session.repository';
import { ManualClock } from '../time/testing/manual-clock';
import { HISTORY_PAGE_SIZE, TimeSessionStore } from './time-session.store';

describe('TimeSessionStore', () => {
  let clock: ManualClock;
  let repo: FakeTimeSessionRepository;

  const flush = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(0);
  };

  async function create(): Promise<TimeSessionStore> {
    TestBed.configureTestingModule({
      providers: [
        { provide: CLOCK, useValue: clock },
        { provide: TIME_SESSION_REPOSITORY, useValue: repo },
      ],
    });
    const store = TestBed.inject(TimeSessionStore);
    await flush();
    return store;
  }

  /** Moves the clock and the fake timers together. */
  async function elapse(ms: number): Promise<void> {
    clock.advance(ms);
    await vi.advanceTimersByTimeAsync(ms);
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    clock = new ManualClock('2026-11-16T10:00:00.000Z');
    repo = new FakeTimeSessionRepository(clock);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('reads running sessions and history at first use', async () => {
    await repo.start({ kind: 'stopwatch', label: 'Work', durationMs: null });
    const store = await create();
    expect(repo.calls.listRunning).toBe(1);
    expect(store.running()).toHaveLength(1);
    expect(store.recent()).toEqual([]);
    expect(store.hasMoreHistory()).toBe(false);
  });

  it('start, then re-reads; the countdown ends and is re-read 1 s after endsAt', async () => {
    const store = await create();
    await store.start({ kind: 'countdown', label: 'Tea', durationMs: 5000 });
    expect(store.running()).toHaveLength(1);
    expect(repo.calls.listRunning).toBe(2);
    await elapse(5999);
    expect(repo.calls.listRunning).toBe(2);
    await elapse(1);
    expect(repo.calls.listRunning).toBe(3);
    expect(store.running()).toEqual([]);
    expect(store.recent()[0].endReason).toBe('completed');
  });

  it('stop, rename and remove re-read after each action', async () => {
    const store = await create();
    const session = await store.start({ kind: 'stopwatch', label: 'A', durationMs: null });
    await store.rename(session.id, 'B');
    expect(store.running()[0].label).toBe('B');
    await store.stop(session.id);
    expect(store.running()).toEqual([]);
    expect(store.recent()).toHaveLength(1);
    await expect(store.remove(session.id)).resolves.toBe(true);
    expect(store.recent()).toEqual([]);
    expect(repo.calls.listRunning).toBe(5);
  });

  it('re-reads on focus', async () => {
    await create();
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(repo.calls.listRunning).toBe(2);
  });

  it('rejects a failed action and leaves error for reads', async () => {
    const store = await create();
    const failure = new DataError('forbidden', 'limit');
    repo.failNext(failure);
    await expect(store.start({ kind: 'stopwatch', label: '', durationMs: null })).rejects.toBe(
      failure,
    );
    expect(store.error()).toBeNull();
  });

  it('exposes the failed re-read that follows a failed action', async () => {
    const store = await create();
    const failure = new DataError('forbidden', 'limit');
    const readFailure = new DataError('busy', 'busy');
    vi.spyOn(repo, 'start').mockRejectedValue(failure);
    vi.spyOn(repo, 'listRunning').mockRejectedValue(readFailure);
    await expect(store.start({ kind: 'stopwatch', label: '', durationMs: null })).rejects.toBe(
      failure,
    );
    expect(store.error()).toBe(readFailure);
  });

  it('exposes a read error without throwing', async () => {
    repo.failNext(new DataError('unavailable', 'no tauri'));
    const store = await create();
    expect(store.error()?.kind).toBe('unavailable');
  });

  it('a stale response never overwrites a more recent one', async () => {
    const gates: { resolve(value: TimeSession[]): void }[] = [];
    repo.listRunning = () =>
      new Promise<TimeSession[]>((resolve) => {
        gates.push({ resolve });
      });
    const store = await create(); // read 1, pending
    const second = store.refresh(); // read 2, pending
    const fresh = await repo.start({ kind: 'stopwatch', label: 'fresh', durationMs: null });
    gates[1].resolve([fresh]);
    await second;
    gates[0].resolve([{ ...fresh, label: 'stale' }]);
    await flush();
    expect(store.running().map((s) => s.label)).toEqual(['fresh']);
  });

  it('loading is true only until the first load', async () => {
    const store = await create();
    expect(store.loading()).toBe(false);
    const pending = store.refresh();
    expect(store.loading()).toBe(false);
    await pending;
  });

  describe('history paging', () => {
    async function seedHistory(count: number): Promise<void> {
      for (let i = 0; i < count; i++) {
        const s = await repo.start({ kind: 'stopwatch', label: `s${i}`, durationMs: null });
        clock.advance(1000);
        await repo.stop(s.id);
      }
    }

    it('loads one page of 100, then the rest on demand', async () => {
      await seedHistory(HISTORY_PAGE_SIZE + 5);
      const store = await create();
      expect(store.recent()).toHaveLength(HISTORY_PAGE_SIZE);
      expect(store.hasMoreHistory()).toBe(true);
      await store.loadMoreHistory();
      expect(store.recent()).toHaveLength(HISTORY_PAGE_SIZE + 5);
      expect(store.hasMoreHistory()).toBe(false);
      expect(new Set(store.recent().map((s) => s.id)).size).toBe(HISTORY_PAGE_SIZE + 5);
      expect(store.recent()[0].label).toBe(`s${HISTORY_PAGE_SIZE + 4}`);
    });

    it('reports a failed page in historyError, not in the global error', async () => {
      await seedHistory(HISTORY_PAGE_SIZE + 5);
      const store = await create();
      const failure = new DataError('busy', 'busy');
      repo.failNext(failure);
      await store.loadMoreHistory();
      expect(store.historyError()).toBe(failure);
      expect(store.error()).toBeNull();
      expect(store.recent()).toHaveLength(HISTORY_PAGE_SIZE);
      await store.loadMoreHistory();
      expect(store.historyError()).toBeNull();
      expect(store.recent()).toHaveLength(HISTORY_PAGE_SIZE + 5);
    });

    it('does nothing when there is no more history', async () => {
      await seedHistory(2);
      const store = await create();
      expect(store.hasMoreHistory()).toBe(false);
      await store.loadMoreHistory();
      expect(repo.calls.history).toBe(1);
    });
  });
});
