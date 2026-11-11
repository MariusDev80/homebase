import { nextOccurrenceAfter, parseDateRule } from './date-rule';
import vectors from './testing/time-vectors.json';
import {
  classifyLocal,
  resolveLocal,
  startOfDay,
  toLocalDateTime,
  normalizeTimeZone,
} from './zoned';

describe('shared time vectors (ADR-003 section 8.6)', () => {
  it('has a known format version', () => {
    expect(vectors.formatVersion).toBe(1);
  });

  it.each(vectors.timeZoneValidity)('timeZoneValidity $id', (v) => {
    expect(normalizeTimeZone(v.value) !== null, v.id).toBe(v.valid);
  });

  it.each(vectors.resolveLocal)('resolveLocal $id', (v) => {
    expect(resolveLocal(v.local, v.timeZone), v.id).toBe(v.expected);
    expect(classifyLocal(v.local, v.timeZone), `${v.id} kind`).toBe(v.kind);
  });

  it.each(vectors.toLocal)('toLocal $id', (v) => {
    expect(toLocalDateTime(v.instant, v.timeZone), v.id).toBe(v.expected);
  });

  it.each(vectors.startOfDay)('startOfDay $id', (v) => {
    expect(startOfDay(v.date, v.timeZone), v.id).toBe(v.expected);
  });

  it.each(vectors.dateNext)('dateNext $id', (v) => {
    const rule = parseDateRule(v.rrule);
    if (rule === null) throw new Error(`${v.id}: rule not recognised`);
    expect(nextOccurrenceAfter(v.anchor, rule, v.after), v.id).toBe(v.expected);
  });
});
