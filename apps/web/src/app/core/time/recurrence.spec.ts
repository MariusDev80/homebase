import {
  formatRecurrenceRule,
  parseRecurrenceRule,
  type AnchorKind,
  type RecurrenceRule,
} from './recurrence';
import vectors from './testing/time-vectors.json';

describe('recurrence codec (shared ruleCodec vectors)', () => {
  it.each(vectors.ruleCodec)('$id', (v) => {
    const result = parseRecurrenceRule(v.input, v.anchorKind as AnchorKind);
    if ('error' in v) {
      expect(result.ok ? 'ok' : result.code, v.id).toBe(v.error);
      if ('part' in v) {
        expect(result.ok ? null : result.part, `${v.id} part`).toBe(v.part);
      }
      return;
    }
    expect(result.ok, v.id).toBe(true);
    if (!result.ok) return;
    expect(result.canonical).toBe(v.canonical);
    // Round trip on the canonical text.
    const again = parseRecurrenceRule(v.canonical, v.anchorKind as AnchorKind);
    expect(again).toEqual(result);
    expect(formatRecurrenceRule(result.rule)).toBe(v.canonical);
  });

  it('reports the offending part', () => {
    expect(parseRecurrenceRule('FREQ=DAILY;INTERVAL=0', 'date-time')).toEqual({
      ok: false,
      code: 'invalid_value',
      part: 'INTERVAL',
    });
    expect(parseRecurrenceRule('FREQ=DAILY;COUNT=2;UNTIL=20261231', 'date')).toEqual({
      ok: false,
      code: 'count_and_until',
      part: null,
    });
  });

  it('builds the structured rule', () => {
    const result = parseRecurrenceRule('FREQ=MONTHLY;INTERVAL=2;BYDAY=-1FR;COUNT=3', 'date-time');
    expect(result.ok && result.rule).toEqual({
      freq: 'MONTHLY',
      interval: 2,
      byDay: [],
      byNthWeekday: { n: -1, weekday: 'FR' },
      byMonthDay: null,
      end: { kind: 'count', count: 3 },
    } satisfies RecurrenceRule);
  });

  it('accepts parts in any order and emits the canonical order', () => {
    const result = parseRecurrenceRule('FREQ=DAILY;COUNT=3;INTERVAL=2', 'date-time');
    expect(result.ok && result.canonical).toBe('FREQ=DAILY;INTERVAL=2;COUNT=3');
  });
});
