import { navigate, viewTitle, visibleDays, visibleRange } from './calendar-view';

const format = (date: string, style: string) => `${style}:${date}`;

describe('calendar-view', () => {
  it('shows the 6 weeks of November 2026', () => {
    expect(visibleDays('month', '2026-11-18', 14)).toEqual({
      firstOn: '2026-10-26',
      lastOn: '2026-12-06',
    });
  });

  it('shows N days from the anchor in the Agenda', () => {
    expect(visibleDays('agenda', '2026-11-18', 14)).toEqual({
      firstOn: '2026-11-18',
      lastOn: '2026-12-01',
    });
    expect(visibleDays('agenda', '2026-11-18', 7).lastOn).toBe('2026-11-24');
  });

  it('turns days into a range in the display zone', () => {
    expect(visibleRange({ firstOn: '2026-10-26', lastOn: '2026-12-06' }, 'Europe/Paris')).toEqual({
      from: '2026-10-25T23:00:00.000Z',
      to: '2026-12-06T23:00:00.000Z',
      timeZone: 'Europe/Paris',
    });
  });

  it('navigates by month or by block of days', () => {
    expect(navigate('month', '2026-11-18', 14, 1)).toBe('2026-12-01');
    expect(navigate('month', '2026-01-31', 14, -1)).toBe('2025-12-01');
    expect(navigate('agenda', '2026-11-18', 14, 1)).toBe('2026-12-02');
    expect(navigate('agenda', '2026-11-18', 7, -1)).toBe('2026-11-11');
  });

  it('builds the titles', () => {
    expect(viewTitle('month', '2026-11-18', 14, format)).toBe('month-year:2026-11-01');
    expect(viewTitle('agenda', '2026-11-18', 14, format)).toBe(
      'day-month:2026-11-18 – day-month:2026-12-01',
    );
  });
});
