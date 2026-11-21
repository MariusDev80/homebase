import { TestBed } from '@angular/core/testing';
import { CalendarAggregator } from '../../core/calendar';
import type { CalendarRange } from '../../core/calendar';
import type { CalendarResult } from './testing/calendar-harness';
import { CalendarLoader } from './calendar-loader';
import { fixture } from './testing/calendar-fixtures';

interface Pending {
  readonly range: CalendarRange;
  readonly resolve: (result: CalendarResult) => void;
  readonly reject: (error: Error) => void;
}

const rangeOf = (day: string): CalendarRange => ({
  from: `2026-11-${day}T00:00:00.000Z`,
  to: `2026-11-${day}T23:59:59.000Z`,
  timeZone: 'UTC',
});
const result = (title: string, extra: Partial<CalendarResult> = {}): CalendarResult => ({
  events: [{ ...fixture('F1'), title }],
  failedSources: [],
  truncated: false,
  unavailable: false,
  ...extra,
});
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function setup() {
  const pending: Pending[] = [];
  TestBed.configureTestingModule({
    providers: [
      CalendarLoader,
      {
        provide: CalendarAggregator,
        useValue: {
          listEvents: (range: CalendarRange) =>
            new Promise<CalendarResult>((resolve, reject) => {
              pending.push({ range, resolve, reject });
            }),
        },
      },
    ],
  });
  return { loader: TestBed.inject(CalendarLoader), pending };
}

describe('CalendarLoader', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is loading and not busy before any request', () => {
    const { loader } = setup();
    expect(loader.loading()).toBe(true);
    expect(loader.busy()).toBe(false);
    expect(loader.error()).toBe(false);
  });

  it('is busy during a request, then publishes the result and clears loading/busy', async () => {
    const { loader, pending } = setup();
    loader.request(rangeOf('18'), 0);
    expect(loader.busy()).toBe(true);
    expect(loader.loading()).toBe(true);
    pending[0].resolve(result('A', { failedSources: ['todo'], truncated: true }));
    await flush();
    expect(loader.busy()).toBe(false);
    expect(loader.loading()).toBe(false);
    expect(loader.events().map((e) => e.title)).toEqual(['A']);
    expect(loader.failedSources()).toEqual(['todo']);
    expect(loader.truncated()).toBe(true);
    expect(loader.loaded()).not.toBeNull();
  });

  it('ignores a stale response that arrives after the latest one (L11)', async () => {
    const { loader, pending } = setup();
    loader.request(rangeOf('18'), 0);
    loader.request(rangeOf('19'), 0);
    pending[1].resolve(result('latest'));
    await flush();
    pending[0].resolve(result('stale'));
    await flush();
    expect(loader.events().map((e) => e.title)).toEqual(['latest']);
    expect(loader.loaded()?.firstOn).toBe('2026-11-19');
  });

  it('ignores a stale response that arrives before the latest one and stays busy', async () => {
    const { loader, pending } = setup();
    loader.request(rangeOf('18'), 0);
    loader.request(rangeOf('19'), 0);
    pending[0].resolve(result('stale'));
    await flush();
    expect(loader.events()).toEqual([]);
    expect(loader.busy()).toBe(true);
    pending[1].resolve(result('latest'));
    await flush();
    expect(loader.events().map((e) => e.title)).toEqual(['latest']);
    expect(loader.busy()).toBe(false);
  });

  it('goes to the error state on rejection, keeping the previous events', async () => {
    const { loader, pending } = setup();
    loader.request(rangeOf('18'), 0);
    pending[0].resolve(result('A'));
    await flush();
    loader.request(rangeOf('19'), 0);
    pending[1].reject(new Error('boom'));
    await flush();
    expect(loader.error()).toBe(true);
    expect(loader.busy()).toBe(false);
    expect(loader.loading()).toBe(false);
    expect(loader.events().map((e) => e.title)).toEqual(['A']);
    loader.request(rangeOf('20'), 0);
    pending[2].resolve(result('B'));
    await flush();
    expect(loader.error()).toBe(false);
  });

  it('ignores the rejection of a stale request', async () => {
    const { loader, pending } = setup();
    loader.request(rangeOf('18'), 0);
    loader.request(rangeOf('19'), 0);
    pending[0].reject(new Error('stale'));
    await flush();
    expect(loader.error()).toBe(false);
    expect(loader.busy()).toBe(true);
  });

  it('defers a delayed request by 300 ms and restarts the delay on a new request', () => {
    vi.useFakeTimers();
    const { loader, pending } = setup();
    loader.request(rangeOf('18'), 300);
    expect(loader.busy()).toBe(true);
    vi.advanceTimersByTime(299);
    expect(pending).toHaveLength(0);
    loader.request(rangeOf('19'), 300);
    vi.advanceTimersByTime(299);
    expect(pending).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(pending).toHaveLength(1);
    expect(pending[0].range).toEqual(rangeOf('19'));
  });

  it('cancels the pending timer and ignores late responses once destroyed', async () => {
    vi.useFakeTimers();
    const { loader, pending } = setup();
    loader.request(rangeOf('18'), 0);
    loader.request(rangeOf('19'), 300);
    TestBed.resetTestingModule();
    vi.advanceTimersByTime(1000);
    expect(pending).toHaveLength(1);
    pending[0].resolve(result('late'));
    await flush();
    expect(loader.events()).toEqual([]);
  });
});
