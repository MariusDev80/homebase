import { dayAfterAlarm, nextAlarm } from './alarm-time';

const PARIS = 'Europe/Paris';

describe('nextAlarm', () => {
  it('rings today when the time is still ahead', () => {
    // 08:00 in Paris (CET), alarm at 09:30.
    const plan = nextAlarm('09:30', '2026-11-16T07:00:00.000Z', PARIS);
    expect(plan).toEqual({
      startLocal: '2026-11-16T09:30:00',
      at: '2026-11-16T08:30:00.000Z',
      day: 'today',
      time: '09:30',
      kind: 'unique',
    });
  });

  it('rings tomorrow when the time has passed, and when it is exactly now', () => {
    expect(nextAlarm('07:00', '2026-11-16T07:00:00.000Z', PARIS)).toMatchObject({
      startLocal: '2026-11-17T07:00:00',
      at: '2026-11-17T06:00:00.000Z',
      day: 'tomorrow',
    });
    expect(nextAlarm('07:00', '2026-11-16T06:00:00.000Z', PARIS)?.day).toBe('tomorrow');
  });

  it('uses the user time zone for the day, not UTC', () => {
    // 23:30 UTC on the 16th is already 00:30 on the 17th in Paris: 00:45 is still today there.
    expect(nextAlarm('00:45', '2026-11-16T23:30:00.000Z', PARIS)).toMatchObject({
      startLocal: '2026-11-17T00:45:00',
      day: 'today',
    });
  });

  it('crosses a year end', () => {
    expect(nextAlarm('07:00', '2026-12-31T12:00:00.000Z', PARIS)?.startLocal).toBe(
      '2027-01-01T07:00:00',
    );
  });

  it('fold (clocks go back on 2026-10-25): first occurrence, flagged', () => {
    // 02:30 happens at 00:30Z (CEST) and again at 01:30Z (CET). Now is 00:30 CEST on the 25th.
    const plan = nextAlarm('02:30', '2026-10-24T22:30:00.000Z', PARIS);
    expect(plan).toEqual({
      startLocal: '2026-10-25T02:30:00',
      at: '2026-10-25T00:30:00.000Z',
      day: 'today',
      time: '02:30',
      kind: 'fold',
    });
  });

  it('fold tomorrow', () => {
    expect(nextAlarm('02:30', '2026-10-24T19:00:00.000Z', PARIS)).toMatchObject({
      startLocal: '2026-10-25T02:30:00',
      at: '2026-10-25T00:30:00.000Z',
      day: 'tomorrow',
      kind: 'fold',
    });
  });

  it('fold: once the first occurrence has passed, the next day is chosen', () => {
    // 00:45Z on 2026-10-25 = 02:45 CEST: the first 02:30 is past.
    expect(nextAlarm('02:30', '2026-10-25T00:45:00.000Z', PARIS)).toMatchObject({
      startLocal: '2026-10-26T02:30:00',
      day: 'tomorrow',
      kind: 'unique',
    });
  });

  it('gap (clocks go forward on 2027-03-28): moved forward, flagged', () => {
    // Now is 00:30 CET on the 28th. 02:30 does not exist; it rings at 03:30 CEST = 01:30Z.
    const plan = nextAlarm('02:30', '2027-03-27T23:30:00.000Z', PARIS);
    expect(plan).toEqual({
      startLocal: '2027-03-28T03:30:00',
      at: '2027-03-28T01:30:00.000Z',
      day: 'today',
      time: '03:30',
      kind: 'gap',
    });
  });

  it('gap tomorrow', () => {
    expect(nextAlarm('02:30', '2027-03-27T20:00:00.000Z', PARIS)).toMatchObject({
      startLocal: '2027-03-28T03:30:00',
      day: 'tomorrow',
      kind: 'gap',
    });
  });

  it('evening in Los Angeles, when the UTC day has already changed', () => {
    // 03:00Z on the 17th is 19:00 PST on the 16th.
    expect(nextAlarm('20:00', '2026-11-17T03:00:00.000Z', 'America/Los_Angeles')).toMatchObject({
      startLocal: '2026-11-16T20:00:00',
      at: '2026-11-17T04:00:00.000Z',
      day: 'today',
    });
    expect(nextAlarm('18:00', '2026-11-17T03:00:00.000Z', 'America/Los_Angeles')).toMatchObject({
      startLocal: '2026-11-17T18:00:00',
      at: '2026-11-18T02:00:00.000Z',
      day: 'tomorrow',
    });
  });

  it('same instant, other zone: other day and local time', () => {
    const now = '2026-11-16T23:30:00.000Z';
    expect(nextAlarm('18:00', now, 'Europe/Paris')?.startLocal).toBe('2026-11-17T18:00:00');
    expect(nextAlarm('18:00', now, 'America/Los_Angeles')?.startLocal).toBe('2026-11-16T18:00:00');
  });

  it('a time chosen right after the jump rings at the shifted time', () => {
    // 03:15 CEST on 2027-03-28, alarm 02:30 (does not exist): 03:30 is still ahead.
    expect(nextAlarm('02:30', '2027-03-28T01:15:00.000Z', PARIS)).toMatchObject({
      startLocal: '2027-03-28T03:30:00',
      day: 'today',
      kind: 'gap',
    });
  });

  it('dayAfterAlarm moves one day further', () => {
    const first = nextAlarm('18:30', '2026-11-16T10:00:00.000Z', PARIS);
    expect(first && dayAfterAlarm(first, '18:30', PARIS)).toMatchObject({
      startLocal: '2026-11-17T18:30:00',
      day: 'tomorrow',
    });
  });

  it('refuses text that is not HH:MM', () => {
    for (const text of ['', '7:00', '24:00', '12:60', '12:30:00', 'abc']) {
      expect(nextAlarm(text, '2026-11-16T07:00:00.000Z', PARIS), text).toBeNull();
    }
  });
});
