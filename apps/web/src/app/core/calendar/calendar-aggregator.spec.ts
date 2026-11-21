import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DataError } from '../../data';
import { fixtureDefinition } from '../testing/fixture-definitions';
import { addDays, startOfDay } from '../time';
import { provideWidget } from '../widgets/widget-registry';
import { MAX_CALENDAR_EVENTS, CalendarAggregator } from './calendar-aggregator';
import type {
  CalendarEvent,
  CalendarEventTime,
  CalendarRange,
  CalendarSource,
  CalendarTone,
} from './calendar-source';

const RANGE: CalendarRange = {
  from: startOfDay('2026-11-09', 'Europe/Paris'), // 2026-11-08T23:00:00.000Z
  to: startOfDay(addDays('2026-11-22', 1), 'Europe/Paris'), // 2026-11-22T23:00:00.000Z
  timeZone: 'Europe/Paris',
};

class ScriptedSource implements CalendarSource {
  result: () => Promise<readonly CalendarEvent[]> = () => Promise.resolve([]);
  calls = 0;
  listEvents(): Promise<readonly CalendarEvent[]> {
    this.calls++;
    return this.result();
  }
}
class AlphaSource extends ScriptedSource {}
class BetaSource extends ScriptedSource {}

function event(
  sourceType: string,
  sourceId: string,
  time: CalendarEventTime,
  over: Partial<CalendarEvent> = {},
): CalendarEvent {
  const occurrenceKey = over.occurrenceKey ?? null;
  return {
    id: `${sourceType}:${sourceId}:${occurrenceKey ?? ''}`,
    sourceType,
    sourceId,
    occurrenceKey,
    title: `Title ${sourceId}`,
    time,
    tone: 'neutral',
    ...over,
  };
}

const timed = (start: string): CalendarEventTime => ({
  kind: 'timed',
  start,
  end: null,
  timeZone: 'Europe/Paris',
});
const allDay = (startOn: string, lastOn = startOn): CalendarEventTime => ({
  kind: 'all-day',
  startOn,
  lastOn,
});

function setup(options: { alphaLoad?: () => Promise<Type<CalendarSource>> } = {}) {
  const alpha = new AlphaSource();
  const beta = new BetaSource();
  const loadAlpha = vi.fn(options.alphaLoad ?? (() => Promise.resolve(AlphaSource)));
  const loadBeta = vi.fn(() => Promise.resolve(BetaSource));
  TestBed.configureTestingModule({
    providers: [
      provideWidget(fixtureDefinition({ type: 'alpha', loadCalendarSource: loadAlpha })),
      provideWidget(fixtureDefinition({ type: 'beta', loadCalendarSource: loadBeta })),
      provideWidget(fixtureDefinition({ type: 'plain' })),
      { provide: AlphaSource, useValue: alpha },
      { provide: BetaSource, useValue: beta },
    ],
  });
  return { alpha, beta, loadAlpha, loadBeta, aggregator: TestBed.inject(CalendarAggregator) };
}

describe('CalendarAggregator', () => {
  afterEach(() => vi.restoreAllMocks());

  it('merges the sources, drops duplicates (first kept) and sorts', async () => {
    const { alpha, beta, aggregator } = setup();
    alpha.result = () =>
      Promise.resolve([
        event('alpha', 'late', timed('2026-11-12T10:00:00.000Z')),
        event('alpha', 'dayB', allDay('2026-11-15')),
        event('alpha', 'early', timed('2026-11-12T08:00:00.000Z')),
      ]);
    const first = event('beta', 'x', timed('2026-11-12T09:00:00.000Z'));
    const second = { ...first, title: 'second copy', time: timed('2026-11-13T09:00:00.000Z') };
    beta.result = () =>
      Promise.resolve([first, event('beta', 'dayA', allDay('2026-11-10')), second]);
    const result = await aggregator.listEvents(RANGE);
    expect(result.events.map((e) => e.id)).toEqual([
      'beta:dayA:',
      'alpha:dayB:',
      'alpha:early:',
      'beta:x:',
      'alpha:late:',
    ]);
    expect(result.events.find((e) => e.id === 'beta:x:')?.title).toBe('Title x');
    expect(result).toMatchObject({ failedSources: [], truncated: false, unavailable: false });
  });

  it('breaks ties by source order in the registry, then by the order of the source', async () => {
    const { alpha, beta, aggregator } = setup();
    alpha.result = () =>
      Promise.resolve([
        event('alpha', 'b', timed('2026-11-12T08:00:00.000Z')),
        event('alpha', 'a', timed('2026-11-12T08:00:00.000Z')),
        event('alpha', 'd', allDay('2026-11-12')),
        event('alpha', 'c', allDay('2026-11-12')),
      ]);
    beta.result = () =>
      Promise.resolve([
        event('beta', 'z', timed('2026-11-12T08:00:00.000Z')),
        event('beta', 'y', allDay('2026-11-12')),
      ]);
    const { events } = await aggregator.listEvents(RANGE);
    expect(events.map((e) => e.sourceId)).toEqual(['d', 'c', 'y', 'b', 'a', 'z']);
  });

  it('keeps the order of a source for the all-day events of one day (listDue sort_order)', async () => {
    const { alpha, aggregator } = setup();
    // Ids are deliberately not sorted: the order of the list wins.
    const ids = ['t9', 't1', 't5', 't3'];
    alpha.result = () => Promise.resolve(ids.map((id) => event('alpha', id, allDay('2026-11-12'))));
    const { events } = await aggregator.listEvents(RANGE);
    expect(events.map((e) => e.sourceId)).toEqual(ids);
  });

  it('only loads the definitions that declare a calendar source', async () => {
    const { loadAlpha, loadBeta, aggregator } = setup();
    await aggregator.listEvents(RANGE);
    expect(loadAlpha).toHaveBeenCalledTimes(1);
    expect(loadBeta).toHaveBeenCalledTimes(1);
  });

  it('keeps the other sources when one fails and reports it', async () => {
    const { alpha, beta, aggregator } = setup();
    alpha.result = () => Promise.reject(new DataError('unknown', 'boom'));
    beta.result = () => Promise.resolve([event('beta', 'ok', allDay('2026-11-12'))]);
    const result = await aggregator.listEvents(RANGE);
    expect(result.events.map((e) => e.id)).toEqual(['beta:ok:']);
    expect(result.failedSources).toEqual(['alpha']);
    expect(result.unavailable).toBe(false);
  });

  it('sets unavailable only when every failure is DataError(unavailable)', async () => {
    const { alpha, beta, aggregator } = setup();
    alpha.result = () => Promise.reject(new DataError('unavailable', 'no tauri'));
    beta.result = () => Promise.reject(new DataError('unavailable', 'no tauri'));
    expect(await aggregator.listEvents(RANGE)).toMatchObject({
      failedSources: ['alpha', 'beta'],
      unavailable: true,
    });
    beta.result = () => Promise.reject(new Error('other'));
    expect(await aggregator.listEvents(RANGE)).toMatchObject({
      failedSources: ['alpha', 'beta'],
      unavailable: false,
    });
    alpha.result = () => Promise.resolve([]);
    beta.result = () => Promise.resolve([]);
    expect(await aggregator.listEvents(RANGE)).toMatchObject({
      failedSources: [],
      unavailable: false,
    });
  });

  describe('integrity', () => {
    it('drops invalid events and logs identifiers only in development', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { alpha, aggregator } = setup();
      const good = event('alpha', 'good', timed('2026-11-12T08:00:00.000Z'));
      const bad: CalendarEvent[] = [
        event('beta', 'wrongType', allDay('2026-11-12')),
        { ...event('alpha', 'badId', allDay('2026-11-12')), id: 'alpha:other:' },
        { ...event('alpha', 'badKey', allDay('2026-11-12')), id: 'alpha:badKey:2026' },
        event('alpha', 'badInstant', timed('2026-11-12 08:00')),
        event('alpha', 'badZone', {
          kind: 'timed',
          start: '2026-11-12T08:00:00.000Z',
          end: null,
          timeZone: 'Mars/Olympus',
        }),
        event('alpha', 'endBeforeStart', {
          kind: 'timed',
          start: '2026-11-12T08:00:00.000Z',
          end: '2026-11-12T07:00:00.000Z',
          timeZone: 'Europe/Paris',
        }),
        event('alpha', 'badDay', allDay('2026-02-30')),
        event('alpha', 'reversed', allDay('2026-11-14', '2026-11-13')),
        event('alpha', 'timedAtTo', timed(RANGE.to)),
        event('alpha', 'timedBefore', timed('2026-11-08T22:59:59.999Z')),
        event('alpha', 'dayBefore', allDay('2026-11-01', '2026-11-08')),
        event('alpha', 'dayAfter', allDay('2026-11-23', '2026-11-25')),
        event('alpha', 'tone', allDay('2026-11-12'), { tone: 'pink' as unknown as CalendarTone }),
      ];
      alpha.result = () => Promise.resolve([...bad, good]);
      const { events } = await aggregator.listEvents(RANGE);
      expect(events.map((e) => e.id)).toEqual(['alpha:good:']);
      expect(warn).toHaveBeenCalledTimes(bad.length);
      expect(warn.mock.calls.flat().join(' ')).not.toContain('Title');
    });

    it('keeps the boundaries: start == from, all-day overlapping the range', async () => {
      const { alpha, aggregator } = setup();
      alpha.result = () =>
        Promise.resolve([
          event('alpha', 'atFrom', timed(RANGE.from)),
          event('alpha', 'justBeforeTo', timed('2026-11-22T22:59:59.999Z')),
          event('alpha', 'entering', allDay('2026-11-05', '2026-11-09')),
          event('alpha', 'leaving', allDay('2026-11-22', '2026-11-30')),
          event('alpha', 'withKey', timed('2026-11-12T08:00:00.000Z'), {
            occurrenceKey: '2026-11-12T09:00:00',
          }),
        ]);
      const result = await aggregator.listEvents(RANGE);
      expect(result.events).toHaveLength(5);
    });
  });

  it('cuts at 2000 events after the sort and reports truncated', async () => {
    const { alpha, aggregator } = setup();
    const many = (count: number) =>
      Array.from({ length: count }, (_, i) =>
        event('alpha', String(i).padStart(5, '0'), allDay('2026-11-12')),
      );
    alpha.result = () => Promise.resolve(many(MAX_CALENDAR_EVENTS));
    expect(await aggregator.listEvents(RANGE)).toMatchObject({ truncated: false });
    alpha.result = () => Promise.resolve(many(MAX_CALENDAR_EVENTS + 1).reverse());
    const result = await aggregator.listEvents(RANGE);
    expect(result.truncated).toBe(true);
    expect(result.events).toHaveLength(MAX_CALENDAR_EVENTS);
    expect(result.events[0].sourceId).toBe('02000'); // source order is kept (PV0)
    expect(result.events[MAX_CALENDAR_EVENTS - 1].sourceId).toBe('00001');
  });

  it('loads each source once, and loads it again after a failed load', async () => {
    let attempts = 0;
    const { alpha, loadAlpha, aggregator } = setup({
      alphaLoad: () =>
        ++attempts === 1 ? Promise.reject(new Error('chunk')) : Promise.resolve(AlphaSource),
    });
    const first = await aggregator.listEvents(RANGE);
    expect(first.failedSources).toEqual(['alpha']);
    await aggregator.listEvents(RANGE);
    await aggregator.listEvents(RANGE);
    expect(loadAlpha).toHaveBeenCalledTimes(2);
    expect(alpha.calls).toBe(2);
  });

  it('shares one source call between concurrent requests for the same range', async () => {
    const { alpha, loadAlpha, aggregator } = setup();
    alpha.result = () => Promise.resolve([event('alpha', 'a', allDay('2026-11-12'))]);
    const [first, second] = await Promise.all([
      aggregator.listEvents(RANGE),
      aggregator.listEvents({ ...RANGE }),
    ]);
    expect(alpha.calls).toBe(1);
    expect(loadAlpha).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    // The shared request is forgotten once settled.
    await aggregator.listEvents(RANGE);
    expect(alpha.calls).toBe(2);
    expect(loadAlpha).toHaveBeenCalledTimes(1);
  });

  it('forgets a shared request that was rejected by the source', async () => {
    const { alpha, aggregator } = setup();
    alpha.result = () => Promise.reject(new Error('boom'));
    await Promise.all([aggregator.listEvents(RANGE), aggregator.listEvents(RANGE)]);
    await aggregator.listEvents(RANGE);
    expect(alpha.calls).toBe(2);
  });

  it('loads a source once for concurrent requests on different ranges', async () => {
    const { alpha, loadAlpha, aggregator } = setup();
    const other = { ...RANGE, to: startOfDay('2026-11-30', RANGE.timeZone) };
    await Promise.all([aggregator.listEvents(RANGE), aggregator.listEvents(other)]);
    expect(loadAlpha).toHaveBeenCalledTimes(1);
    expect(alpha.calls).toBe(2);
  });

  it('reports a failed load to both concurrent callers, then loads again', async () => {
    let attempts = 0;
    const { loadAlpha, aggregator } = setup({
      alphaLoad: () =>
        ++attempts === 1 ? Promise.reject(new Error('chunk')) : Promise.resolve(AlphaSource),
    });
    const [first, second] = await Promise.all([
      aggregator.listEvents(RANGE),
      aggregator.listEvents(RANGE),
    ]);
    expect(first.failedSources).toEqual(['alpha']);
    expect(second.failedSources).toEqual(['alpha']);
    expect(loadAlpha).toHaveBeenCalledTimes(1);
    expect((await aggregator.listEvents(RANGE)).failedSources).toEqual([]);
    expect(loadAlpha).toHaveBeenCalledTimes(2);
  });

  it('keeps one source and flags unavailable when the only failure is unavailable', async () => {
    // ADR rule: unavailable = at least one source failed AND every failure is `unavailable`,
    // whatever the sources that succeeded.
    const { alpha, beta, aggregator } = setup();
    alpha.result = () => Promise.resolve([event('alpha', 'ok', allDay('2026-11-12'))]);
    beta.result = () => Promise.reject(new DataError('unavailable', 'no tauri'));
    const result = await aggregator.listEvents(RANGE);
    expect(result.events.map((e) => e.id)).toEqual(['alpha:ok:']);
    expect(result.failedSources).toEqual(['beta']);
    expect(result.unavailable).toBe(true);
  });

  it('cuts a mix of all-day and timed events at 2000, all-day first', async () => {
    const { alpha, aggregator } = setup();
    const pad = (n: number, size: number) => String(n).padStart(size, '0');
    alpha.result = () =>
      Promise.resolve([
        ...Array.from({ length: 1500 }, (_, i) =>
          event(
            'alpha',
            `t${pad(i, 4)}`,
            timed(`2026-11-12T00:${pad(Math.floor(i / 60), 2)}:${pad(i % 60, 2)}.000Z`),
          ),
        ),
        ...Array.from({ length: 1000 }, (_, i) =>
          event('alpha', `d${pad(i, 4)}`, allDay('2026-11-12')),
        ),
      ]);
    const result = await aggregator.listEvents(RANGE);
    expect(result.truncated).toBe(true);
    expect(result.events).toHaveLength(MAX_CALENDAR_EVENTS);
    const kinds = result.events.map((e) => e.time.kind);
    expect(kinds.filter((k) => k === 'all-day')).toHaveLength(1000);
    expect(kinds.slice(0, 1000).every((k) => k === 'all-day')).toBe(true);
    expect(result.events[1000].sourceId).toBe('t0000');
  });

  it('drops malformed events without throwing and flags a non-array result as failed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { alpha, beta, aggregator } = setup();
    const good = event('alpha', 'good', allDay('2026-11-12'));
    const noTime = { ...event('alpha', 'noTime', allDay('2026-11-12')), time: null };
    alpha.result = () =>
      Promise.resolve([noTime, null, good] as unknown as readonly CalendarEvent[]);
    beta.result = () => Promise.resolve({ not: 'an array' } as unknown as readonly CalendarEvent[]);
    const result = await aggregator.listEvents(RANGE);
    expect(result.events.map((e) => e.id)).toEqual(['alpha:good:']);
    expect(result.failedSources).toEqual(['beta']);
    expect(result.unavailable).toBe(false);
  });

  it('refuses an invalid range before calling any source', async () => {
    const { alpha, aggregator } = setup();
    const tooLong = { ...RANGE, to: startOfDay('2027-02-01', RANGE.timeZone) };
    await expect(aggregator.listEvents(tooLong)).rejects.toMatchObject({ kind: 'invalid_input' });
    await expect(aggregator.listEvents({ ...RANGE, to: RANGE.from })).rejects.toBeInstanceOf(
      DataError,
    );
    expect(alpha.calls).toBe(0);
  });
});
