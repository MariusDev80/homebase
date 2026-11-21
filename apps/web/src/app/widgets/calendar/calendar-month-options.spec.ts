import { buildMonthOptions, toEventInputs } from './calendar-month-options';
import { CALENDAR_FIXTURES, fixture } from './testing/calendar-fixtures';

const params = {
  monthStart: '2026-11-01',
  timeZone: 'Europe/Paris',
  nowIso: '2026-11-18T10:00:00.000Z',
  maxEventsPerDay: true as const,
  events: CALENDAR_FIXTURES,
  moreHint: (count: number) => `hint ${count}`,
  onMoreLink: () => undefined,
  onEventClick: () => undefined,
  eventName: () => null,
};

describe('toEventInputs', () => {
  it('has no end for a timed event, an exclusive end for all-day, and never a url', () => {
    const inputs = toEventInputs(CALENDAR_FIXTURES);
    for (const input of inputs) expect('url' in input).toBe(false);
    const f1 = toEventInputs([fixture('F1')])[0];
    expect('end' in f1).toBe(false);
    expect(f1).toMatchObject({ start: '2026-11-18T08:00:00.000Z', allDay: false });
    expect(toEventInputs([fixture('F5')])[0]).toMatchObject({
      start: '2026-11-23',
      end: '2026-11-26',
      allDay: true,
    });
  });
});

describe('buildMonthOptions', () => {
  const options = buildMonthOptions(params);

  it('has the exact values of the spec', () => {
    expect(options).toMatchObject({
      headerToolbar: false,
      defaultTimedEventDuration: { minutes: 0 },
      eventTimeFormat: { hour: '2-digit', minute: '2-digit', meridiem: false },
      firstDay: 1,
      fixedWeekCount: true,
      height: '100%',
      eventInteractive: true,
      timeZone: 'Europe/Paris',
      now: '2026-11-18T10:00:00.000Z',
      initialDate: '2026-11-01',
      navLinks: false,
    });
  });

  it('has a moreLinkClick that returns nothing, and no eventContent', () => {
    expect(typeof options.moreLinkClick).toBe('function');
    const handler = options.moreLinkClick as (info: unknown) => unknown;
    expect(handler({})).toBeUndefined();
    expect('eventContent' in options).toBe(false);
  });
});
