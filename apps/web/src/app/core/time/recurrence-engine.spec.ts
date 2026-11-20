import { TestBed } from '@angular/core/testing';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { DataError } from '../../data';
import { RECURRENCE_ENGINE, type RecurrenceSpec } from './recurrence-engine';
import { TimeError } from './time-error';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: vi.fn(), invoke: vi.fn() }));

const spec: RecurrenceSpec = {
  anchor: { kind: 'date-time', startLocal: '2027-03-27T02:30:00', timeZone: 'Europe/Paris' },
  rrule: 'FREQ=DAILY;COUNT=3',
  exdates: [],
};
const range = {
  from: '2027-03-01T00:00:00.000Z',
  to: '2027-04-01T00:00:00.000Z',
  timeZone: 'Europe/Paris',
};

describe('RECURRENCE_ENGINE', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(isTauri).mockReset();
    delete (globalThis as Record<string, unknown>)['__TAURI_INTERNALS__'];
  });

  it('rejects with DataError unavailable outside Tauri, without invoking', async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    const engine = TestBed.inject(RECURRENCE_ENGINE);
    await expect(engine.validate(spec)).rejects.toMatchObject({
      constructor: DataError,
      kind: 'unavailable',
    });
    await expect(engine.expand(spec, range)).rejects.toMatchObject({ kind: 'unavailable' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('invokes time_validate and time_expand inside Tauri', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invoke).mockResolvedValue({ rrule: 'FREQ=DAILY;COUNT=3', exdates: [] });
    const engine = TestBed.inject(RECURRENCE_ENGINE);
    await expect(engine.validate(spec)).resolves.toEqual({
      rrule: 'FREQ=DAILY;COUNT=3',
      exdates: [],
    });
    expect(invoke).toHaveBeenCalledWith('time_validate', { spec });
    vi.mocked(invoke).mockResolvedValue({ occurrences: [], truncated: false });
    await engine.expand(spec, { ...range, limit: 10 });
    expect(invoke).toHaveBeenCalledWith('time_expand', {
      spec,
      range: { ...range, limit: 10 },
    });
  });

  it('translates a rule error', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invoke).mockRejectedValue({
      kind: 'invalid_rule',
      code: 'count_and_until',
      part: null,
    });
    const error = await TestBed.inject(RECURRENCE_ENGINE)
      .validate(spec)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TimeError);
    expect(error).toMatchObject({ code: 'invalid_rule', detail: { rule: 'count_and_until' } });
  });

  it('keeps the offending part of a rule error', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invoke).mockRejectedValue({
      kind: 'invalid_rule',
      code: 'invalid_value',
      part: 'INTERVAL',
    });
    await expect(TestBed.inject(RECURRENCE_ENGINE).validate(spec)).rejects.toMatchObject({
      code: 'invalid_rule',
      detail: { rule: 'invalid_value', part: 'INTERVAL' },
    });
  });

  it('translates the other kinds', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invoke).mockRejectedValue({ kind: 'invalid_range' });
    await expect(TestBed.inject(RECURRENCE_ENGINE).expand(spec, range)).rejects.toMatchObject({
      constructor: TimeError,
      code: 'invalid_range',
    });
    vi.mocked(invoke).mockRejectedValue({ kind: 'unknown_time_zone', value: 'Mars/Base' });
    await expect(TestBed.inject(RECURRENCE_ENGINE).expand(spec, range)).rejects.toMatchObject({
      code: 'unknown_time_zone',
      detail: { value: 'Mars/Base' },
    });
  });

  it('wraps an unexpected failure in DataError', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invoke).mockRejectedValue('boom');
    await expect(TestBed.inject(RECURRENCE_ENGINE).validate(spec)).rejects.toMatchObject({
      constructor: DataError,
      kind: 'unknown',
    });
  });
});
