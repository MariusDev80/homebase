import Database from 'better-sqlite3';

// ADR-003 section 3.1.3: the normative CHECK fragments, copied verbatim into a temporary STRICT
// table. Every case is an INSERT (a SELECT with malformed JSON throws instead of returning 0).
const FRAGMENTS = {
  instant: (c: string) => `${c} TEXT NOT NULL CHECK (
  ${c} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
  AND strftime('%Y-%m-%dT%H:%M:%fZ', ${c}, '+0 seconds') IS ${c}
  AND ${c} BETWEEN '1900-01-01' AND '2200-01-01')`,
  date: (c: string) => `${c} TEXT NOT NULL CHECK (
  ${c} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  AND date(${c}) IS ${c}
  AND ${c} BETWEEN '1900-01-01' AND '2199-12-31')`,
  local: (c: string) => `${c} TEXT NOT NULL CHECK (
  ${c} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
  AND strftime('%Y-%m-%dT%H:%M:%S', ${c}, '+0 seconds') IS ${c}
  AND ${c} BETWEEN '1900-01-01' AND '2200-01-01')`,
  instantOpt: (c: string) => `${c} TEXT NULL CHECK (${c} IS NULL OR (
  ${c} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
  AND strftime('%Y-%m-%dT%H:%M:%fZ', ${c}, '+0 seconds') IS ${c}
  AND ${c} BETWEEN '1900-01-01' AND '2200-01-01'))`,
  dateOpt: (c: string) => `${c} TEXT NULL CHECK (${c} IS NULL OR (
  ${c} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  AND date(${c}) IS ${c}
  AND ${c} BETWEEN '1900-01-01' AND '2199-12-31'))`,
  localOpt: (c: string) => `${c} TEXT NULL CHECK (${c} IS NULL OR (
  ${c} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
  AND strftime('%Y-%m-%dT%H:%M:%S', ${c}, '+0 seconds') IS ${c}
  AND ${c} BETWEEN '1900-01-01' AND '2200-01-01'))`,
  zoneOpt: `time_zone TEXT NULL CHECK (time_zone IS NULL OR (length(time_zone) BETWEEN 1 AND 64
  AND time_zone GLOB '[A-Za-z]*'
  AND time_zone NOT GLOB '*[^A-Za-z0-9_+/-]*'))`,
  zone: `time_zone TEXT NOT NULL CHECK (length(time_zone) BETWEEN 1 AND 64
  AND time_zone GLOB '[A-Za-z]*'
  AND time_zone NOT GLOB '*[^A-Za-z0-9_+/-]*')`,
  duration: `elapsed_ms INTEGER NOT NULL CHECK (elapsed_ms >= 0)`,
  rrule: `rrule TEXT NULL CHECK (rrule IS NULL OR (length(rrule) BETWEEN 10 AND 256 AND rrule GLOB 'FREQ=*'))`,
  exdates: `exdates TEXT NOT NULL CHECK (json_valid(exdates) AND json_type(exdates) = 'array'
  AND json_array_length(exdates) <= 366 AND length(exdates) <= 8192)`,
};

describe('SQL time CHECK fragments (ADR-003 3.1.3)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`CREATE TEMP TABLE t_required (
      id INTEGER PRIMARY KEY,
      ${FRAGMENTS.instant('happened_at')},
      ${FRAGMENTS.date('due_on')},
      ${FRAGMENTS.local('start_local')},
      ${FRAGMENTS.zone},
      ${FRAGMENTS.duration}
    ) STRICT`);
    db.exec(`CREATE TEMP TABLE t_optional (
      id INTEGER PRIMARY KEY,
      ${FRAGMENTS.instantOpt('done_at')},
      ${FRAGMENTS.dateOpt('start_on')},
      ${FRAGMENTS.localOpt('start_local')},
      ${FRAGMENTS.zoneOpt},
      ${FRAGMENTS.rrule},
      ${FRAGMENTS.exdates},
      CHECK ((start_local IS NOT NULL AND time_zone IS NOT NULL AND start_on IS NULL)
          OR (start_local IS NULL AND time_zone IS NULL AND start_on IS NOT NULL))
    ) STRICT`);
  });
  afterEach(() => db.close());

  const GOOD = {
    happened_at: '2026-10-25T00:30:00.000Z',
    due_on: '2026-11-03',
    start_local: '2026-10-25T02:30:00',
    time_zone: 'Europe/Paris',
    elapsed_ms: 1500000,
  };

  function insertRequired(over: Partial<Record<keyof typeof GOOD, string | number>>): boolean {
    const row = { ...GOOD, ...over };
    try {
      db.prepare(
        'INSERT INTO t_required (happened_at, due_on, start_local, time_zone, elapsed_ms) VALUES (@happened_at, @due_on, @start_local, @time_zone, @elapsed_ms)',
      ).run(row);
      return true;
    } catch (e) {
      expect(String(e)).toMatch(/CHECK constraint failed/);
      return false;
    }
  }

  const OPT_GOOD = {
    done_at: null as string | null,
    start_on: null as string | null,
    start_local: '2026-10-25T02:30:00' as string | null,
    time_zone: 'Europe/Paris' as string | null,
    rrule: null as string | null,
    exdates: '[]',
  };

  function insertOptional(over: Partial<typeof OPT_GOOD>): boolean {
    const row = { ...OPT_GOOD, ...over };
    try {
      db.prepare(
        'INSERT INTO t_optional (done_at, start_on, start_local, time_zone, rrule, exdates) VALUES (@done_at, @start_on, @start_local, @time_zone, @rrule, @exdates)',
      ).run(row);
      return true;
    } catch (e) {
      expect(String(e)).toMatch(/CHECK constraint failed/);
      return false;
    }
  }

  it('accepts a fully valid row', () => {
    expect(insertRequired({})).toBe(true);
  });

  it('instants: valid accepted, ms preserved, malformed refused', () => {
    expect(insertRequired({ happened_at: '2026-10-25T00:30:00.123Z' })).toBe(true);
    const row = db.prepare('SELECT happened_at FROM t_required').get() as { happened_at: string };
    expect(row.happened_at).toBe('2026-10-25T00:30:00.123Z');
    for (const bad of [
      '2026-02-30T00:00:00.000Z',
      '2026-10-20T08:15:00Z',
      '2026-10-25T24:00:00.000Z',
      '2026-12-31T23:59:60.000Z',
      '1899-12-31T23:59:59.999Z',
    ]) {
      expect(insertRequired({ happened_at: bad }), bad).toBe(false);
    }
  });

  it('dates: calendar validity', () => {
    expect(insertRequired({ due_on: '2028-02-29' })).toBe(true);
    for (const bad of ['2026-02-29', '2026-13-01', '2200-01-01', '2026-2-1']) {
      expect(insertRequired({ due_on: bad }), bad).toBe(false);
    }
  });

  it('local date-times: 24:00, 02-30 and :60 refused', () => {
    for (const bad of ['2026-10-25T24:00:00', '2026-02-30T10:00:00', '2026-10-25T10:00:60']) {
      expect(insertRequired({ start_local: bad }), bad).toBe(false);
    }
  });

  it('time zones and durations', () => {
    expect(insertRequired({ time_zone: 'Etc/GMT+5' })).toBe(true);
    for (const bad of ['+02', 'Europe/ Paris', '']) {
      expect(insertRequired({ time_zone: bad }), bad).toBe(false);
    }
    expect(insertRequired({ elapsed_ms: -1 })).toBe(false);
    expect(insertRequired({ elapsed_ms: 0 })).toBe(true);
  });

  it('exdates: valid array accepted, invalid refused', () => {
    expect(insertOptional({ exdates: '["2026-10-25T02:30:00"]' })).toBe(true);
    expect(insertOptional({ exdates: 'x' })).toBe(false);
    expect(insertOptional({ exdates: '{}' })).toBe(false);
    const tooMany = JSON.stringify(Array.from({ length: 367 }, () => 1));
    expect(insertOptional({ exdates: tooMany })).toBe(false);
    const tooLong = JSON.stringify(['x'.repeat(8200)]);
    expect(insertOptional({ exdates: tooLong })).toBe(false);
    const max = JSON.stringify(Array.from({ length: 366 }, () => '2026-10-25T02:30:00'));
    expect(max.length).toBeLessThanOrEqual(8192);
    expect(insertOptional({ exdates: max })).toBe(true);
  });

  it('rrule: optional, shape filtered', () => {
    expect(insertOptional({ rrule: 'FREQ=DAILY;COUNT=3' })).toBe(true);
    expect(insertOptional({ rrule: 'DAILY' })).toBe(false);
    expect(insertOptional({ rrule: 'FREQ=' })).toBe(false);
  });

  it('anchor: both valid forms accepted, mixes refused, NULL accepted in optionals', () => {
    expect(insertOptional({})).toBe(true);
    expect(insertOptional({ start_local: null, time_zone: null, start_on: '2026-10-25' })).toBe(
      true,
    );
    expect(insertOptional({ start_on: '2026-10-25' })).toBe(false);
    expect(insertOptional({ time_zone: null })).toBe(false);
    expect(insertOptional({ start_local: null })).toBe(false);
    expect(insertOptional({ start_local: null, time_zone: null, start_on: null })).toBe(false);
    expect(insertOptional({ done_at: '2026-10-25T00:30:00.000Z' })).toBe(true);
    expect(insertOptional({ done_at: '2026-10-25T24:00:00.000Z' })).toBe(false);
    expect(insertOptional({ start_local: null, time_zone: null, start_on: '2026-02-30' })).toBe(
      false,
    );
  });
});
