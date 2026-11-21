import { TestBed } from '@angular/core/testing';
import { DataError, type ReminderInput } from '../../data';
import { REMINDER_REPOSITORY } from '../../data/schedule.tokens';
import type { CalendarRange } from '../../core/calendar/calendar-source';
import { FakeReminderRepository } from '../../core/testing/fake-reminder.repository';
import {
  RECURRENCE_ENGINE,
  type ExpandRange,
  type Occurrence,
  type RecurrenceSpec,
} from '../../core/time';
import { FakeRecurrenceEngine } from '../../core/time/testing/fake-recurrence-engine';
import { RemindersCalendarSource } from './reminders.calendar-source';

const RANGE: CalendarRange = {
  from: '2026-11-08T23:00:00.000Z',
  to: '2026-11-22T23:00:00.000Z',
  timeZone: 'Europe/Paris',
};

/** Returns the occurrences scripted for the anchor of the reminder (by start), or fails. */
class ScriptedEngine extends FakeRecurrenceEngine {
  byStart = new Map<string, readonly Occurrence[]>();
  failFor = new Set<string>();
  inFlight = 0;
  peak = 0;

  override async expand(
    spec: RecurrenceSpec,
    range: ExpandRange,
  ): Promise<{ readonly occurrences: readonly Occurrence[]; readonly truncated: boolean }> {
    this.expandCalls.push({ spec, range });
    const start = spec.anchor.kind === 'date-time' ? spec.anchor.startLocal : '';
    this.inFlight++;
    this.peak = Math.max(this.peak, this.inFlight);
    await new Promise((resolve) => setTimeout(resolve));
    this.inFlight--;
    if (this.failFor.has(start)) throw new Error('expansion failed');
    return { occurrences: this.byStart.get(start) ?? [], truncated: false };
  }
}

const input = (over: Partial<ReminderInput> = {}): ReminderInput => ({
  title: 'Call mum',
  startLocal: '2026-11-10T09:00:00',
  timeZone: 'Europe/Paris',
  rrule: null,
  exdates: [],
  enabled: true,
  ...over,
});

const occurrence = (key: string, start: string): Occurrence => ({
  kind: 'date-time',
  key,
  start,
  nominalLocal: key,
  timeZone: 'Europe/Paris',
});

describe('RemindersCalendarSource', () => {
  let repo: FakeReminderRepository;
  let engine: ScriptedEngine;
  let source: RemindersCalendarSource;

  beforeEach(() => {
    repo = new FakeReminderRepository();
    engine = new ScriptedEngine();
    TestBed.configureTestingModule({
      providers: [
        { provide: REMINDER_REPOSITORY, useValue: repo },
        { provide: RECURRENCE_ENGINE, useValue: engine },
      ],
    });
    source = TestBed.inject(RemindersCalendarSource);
  });
  afterEach(() => vi.restoreAllMocks());

  it('emits one timed accent event for a one-off reminder, with a null occurrence key', async () => {
    const reminder = await repo.create(input());
    engine.byStart.set('2026-11-10T09:00:00', [
      occurrence('2026-11-10T09:00:00', '2026-11-10T08:00:00.000Z'),
    ]);
    const events = await source.listEvents(RANGE);
    expect(events).toEqual([
      {
        id: `reminders:${reminder.id}:`,
        sourceType: 'reminders',
        sourceId: reminder.id,
        occurrenceKey: null,
        title: 'Call mum',
        time: {
          kind: 'timed',
          start: '2026-11-10T08:00:00.000Z',
          end: null,
          timeZone: 'Europe/Paris',
        },
        tone: 'accent',
      },
    ]);
  });

  it('passes the anchor, the exceptions and the range to the engine', async () => {
    await repo.create(
      input({
        rrule: 'FREQ=DAILY',
        exdates: ['2026-11-11T09:00:00'],
        timeZone: 'America/Montreal',
        startLocal: '2026-11-10T03:00:00',
      }),
    );
    await source.listEvents(RANGE);
    expect(engine.expandCalls).toEqual([
      {
        spec: {
          anchor: {
            kind: 'date-time',
            startLocal: '2026-11-10T03:00:00',
            timeZone: 'America/Montreal',
          },
          rrule: 'FREQ=DAILY',
          exdates: ['2026-11-11T09:00:00'],
        },
        range: { from: RANGE.from, to: RANGE.to, timeZone: 'Europe/Paris', limit: 500 },
      },
    ]);
  });

  it('uses the occurrence key and the reminder zone for a recurring reminder', async () => {
    const reminder = await repo.create(
      input({
        rrule: 'FREQ=DAILY',
        timeZone: 'America/Montreal',
        startLocal: '2026-11-10T03:00:00',
      }),
    );
    engine.byStart.set('2026-11-10T03:00:00', [
      occurrence('2026-11-10T03:00:00', '2026-11-10T08:00:00.000Z'),
      occurrence('2026-11-11T03:00:00', '2026-11-11T08:00:00.000Z'),
    ]);
    const events = await source.listEvents(RANGE);
    expect(events.map((e) => e.id)).toEqual([
      `reminders:${reminder.id}:2026-11-10T03:00:00`,
      `reminders:${reminder.id}:2026-11-11T03:00:00`,
    ]);
    expect(events.map((e) => e.occurrenceKey)).toEqual([
      '2026-11-10T03:00:00',
      '2026-11-11T03:00:00',
    ]);
    expect(
      events.every((e) => e.time.kind === 'timed' && e.time.timeZone === 'America/Montreal'),
    ).toBe(true);
  });

  it('excludes disabled and invalid reminders but includes a finished one', async () => {
    await repo.create(
      input({ title: 'disabled', enabled: false, startLocal: '2026-11-11T09:00:00' }),
    );
    const invalid = await repo.create(
      input({ title: 'invalid', startLocal: '2026-11-12T09:00:00' }),
    );
    repo.items = repo.items.map((r) => (r.id === invalid.id ? { ...r, status: 'invalid' } : r));
    const finished = await repo.create(
      input({ title: 'finished', startLocal: '2026-11-13T09:00:00' }),
    );
    expect(repo.items.find((r) => r.id === finished.id)?.status).toBe('finished');
    for (const start of ['2026-11-11T09:00:00', '2026-11-12T09:00:00', '2026-11-13T09:00:00']) {
      engine.byStart.set(start, [occurrence(start, '2026-11-12T08:00:00.000Z')]);
    }
    const events = await source.listEvents(RANGE);
    expect(events.map((e) => e.title)).toEqual(['finished']);
    expect(engine.expandCalls).toHaveLength(1);
  });

  it('skips only the reminder whose expansion fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const brokenId = (
      await repo.create(input({ title: 'broken', startLocal: '2026-11-10T09:00:00' }))
    ).id;
    const fine = await repo.create(input({ title: 'fine', startLocal: '2026-11-10T10:00:00' }));
    engine.failFor.add('2026-11-10T09:00:00');
    engine.byStart.set('2026-11-10T10:00:00', [
      occurrence('2026-11-10T10:00:00', '2026-11-10T09:00:00.000Z'),
    ]);
    const events = await source.listEvents(RANGE);
    expect(events.map((e) => e.sourceId)).toEqual([fine.id]);
    const log = warn.mock.calls.flat().join(' ');
    expect(log).toContain(brokenId);
    expect(log).not.toContain('broken');
  });

  it('does not expand a one-off reminder more than 2 days outside the range dates', async () => {
    // Range dates: 2026-11-09 .. 2026-11-22; the margin is 2026-11-07 .. 2026-11-24.
    const starts = [
      ['2026-11-06T23:59:00', false],
      ['2026-11-07T00:00:00', true],
      ['2026-11-24T23:59:00', true],
      ['2026-11-25T00:00:00', false],
    ] as const;
    for (const [startLocal] of starts) await repo.create(input({ startLocal }));
    await source.listEvents(RANGE);
    const expanded = engine.expandCalls.map((c) =>
      c.spec.anchor.kind === 'date-time' ? c.spec.anchor.startLocal : '',
    );
    expect(expanded.sort()).toEqual(
      starts
        .filter(([, near]) => near)
        .map(([s]) => s)
        .sort(),
    );
  });

  it('always expands a recurring reminder, whatever its start date', async () => {
    await repo.create(input({ rrule: 'FREQ=DAILY', startLocal: '2020-01-01T09:00:00' }));
    await source.listEvents(RANGE);
    expect(engine.expandCalls).toHaveLength(1);
  });

  it('rejects when the repository list rejects', async () => {
    repo.failNext(new DataError('unavailable', 'no tauri'));
    await expect(source.listEvents(RANGE)).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('expands at most 8 reminders at a time', async () => {
    for (let i = 0; i < 20; i++) {
      await repo.create(
        input({ title: `r${i}`, startLocal: `2026-11-10T09:${String(i).padStart(2, '0')}:00` }),
      );
    }
    await source.listEvents(RANGE);
    expect(engine.expandCalls).toHaveLength(20);
    expect(engine.peak).toBe(8);
  });

  it('ignores date occurrences', async () => {
    await repo.create(input());
    engine.byStart.set('2026-11-10T09:00:00', [
      { kind: 'date', key: '2026-11-10', date: '2026-11-10' },
    ]);
    expect(await source.listEvents(RANGE)).toEqual([]);
  });
});
