import { TestBed } from '@angular/core/testing';
import type { CalendarEvent } from '../../core/calendar';
import { CalendarChanges } from '../../core/calendar/calendar-changes';
import { F10_COUNT, CALENDAR_FIXTURES, fixture } from './testing/calendar-fixtures';
import { mountCalendar } from './testing/calendar-harness';

const agenda = { view: 'agenda', agendaDays: 14 } as const;
const MORE = `[title="Voir les ${F10_COUNT - 2} autres événements de ce jour"]`;
const detail = (el: HTMLElement) =>
  el.querySelector<HTMLElement>('[data-testid="calendar-event-detail"]');
const text = (el: HTMLElement, id: string) =>
  el.querySelector(`[data-testid="${id}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const result = (events: readonly CalendarEvent[]) => ({
  events: [...events],
  failedSources: [],
  truncated: false,
  unavailable: false,
});
const escape = (el: HTMLElement) =>
  detail(el)!
    .querySelector('button')!
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

/** Notifies the calendar and lets the debounced reload (300 ms) and its render happen. */
async function reload(mounted: Awaited<ReturnType<typeof mountCalendar>>): Promise<void> {
  TestBed.inject(CalendarChanges).notify('todo');
  mounted.fixture.detectChanges();
  await vi.advanceTimersByTimeAsync(300);
  await mounted.settle();
}

const tickFake = () => vi.advanceTimersByTimeAsync(0);

describe('Event sheet after reloads and resizes (review of C3)', () => {
  afterEach(() => vi.useRealTimers());

  it('I1: from a Month event, Escape after a reload focuses the new element of the same id', async () => {
    vi.useFakeTimers();
    const mounted = await mountCalendar({
      tick: tickFake,
      maxEventsPerDay: 50,
      listEvents: () => Promise.resolve(result(CALENDAR_FIXTURES)),
    });
    const { el, settle } = mounted;
    const id = fixture('F1').id;
    const old = el.querySelector<HTMLElement>(`[data-event-id="${id}"]`)!;
    old.focus();
    old.click();
    await settle();
    expect(detail(el)).not.toBeNull();
    await reload(mounted);
    // jsdom may keep the nodes: simulate the remount of FullCalendar (new node, same id).
    old.replaceWith(old.cloneNode(true));
    expect(old.isConnected).toBe(false);
    escape(el);
    await settle();
    const active = document.activeElement as HTMLElement;
    expect(active).not.toBe(old);
    expect(active.isConnected).toBe(true);
    expect(active.dataset['eventId']).toBe(id);
  });

  it('I1: the +N of the Day panel is found again after a reload', async () => {
    vi.useFakeTimers();
    const mounted = await mountCalendar({
      tick: tickFake,
      listEvents: () => Promise.resolve(result(CALENDAR_FIXTURES)),
    });
    const { el, settle } = mounted;
    const old = el.querySelector<HTMLElement>(MORE)!;
    old.focus();
    old.click();
    await settle();
    await reload(mounted);
    // jsdom may keep the nodes: simulate the remount of FullCalendar (new node, same id).
    old.replaceWith(old.cloneNode(true));
    expect(old.isConnected).toBe(false);
    el.querySelector<HTMLElement>('[data-testid="calendar-panel-back"]')!.click();
    await settle();
    const active = document.activeElement as HTMLElement;
    expect(active.classList).toContain('hb-fc-more');
    expect(active.closest('[data-date]')!.getAttribute('data-date')).toBe('2026-11-20');
  });

  it('m1: shrinking the card closes the sheet and the panel, the focus goes to the title', async () => {
    const { el, settle, fixture: f } = await mountCalendar();
    el.querySelector<HTMLElement>(MORE)!.click();
    await settle();
    el.querySelector<HTMLElement>('[data-testid="calendar-day-panel"] li button')!.click();
    await settle();
    expect(detail(el)).not.toBeNull();
    f.componentInstance.onResize(500, 400);
    await settle();
    expect(detail(el)).toBeNull();
    expect(el.querySelector('[data-testid="calendar-day-panel"]')).toBeNull();
    expect(document.activeElement).toBe(el.querySelector('[data-testid="calendar-title"]'));
  });

  it('m2: Escape in a sheet from the panel keeps the panel; the focus falls back to its Back button', async () => {
    vi.useFakeTimers();
    let current: readonly CalendarEvent[] = CALENDAR_FIXTURES;
    const mounted = await mountCalendar({
      tick: tickFake,
      listEvents: () => Promise.resolve(result(current)),
    });
    const { el, settle } = mounted;
    el.querySelector<HTMLElement>(MORE)!.click();
    await settle();
    const first = el.querySelector<HTMLElement>('[data-testid="calendar-day-panel"] li button')!;
    const id = first.dataset['eventId']!;
    first.click();
    await settle();
    current = CALENDAR_FIXTURES.filter((event) => event.id !== id);
    await reload(mounted);
    escape(el);
    await settle();
    expect(detail(el)).toBeNull();
    expect(el.querySelector('[data-testid="calendar-day-panel"]')).not.toBeNull();
    expect(document.activeElement).toBe(el.querySelector('[data-testid="calendar-panel-back"]'));
  });

  it('m3: the open sheet follows its event after a reload; a vanished event keeps its snapshot', async () => {
    vi.useFakeTimers();
    let current: readonly CalendarEvent[] = CALENDAR_FIXTURES;
    const mounted = await mountCalendar({
      tick: tickFake,
      config: agenda,
      listEvents: () => Promise.resolve(result(current)),
    });
    const { el, settle } = mounted;
    el.querySelector<HTMLElement>(`button[data-event-id="${fixture('F4').id}"]`)!.click();
    await settle();
    expect(el.querySelector('[data-testid="calendar-detail-overdue"]')).not.toBeNull();
    current = CALENDAR_FIXTURES.map((event) =>
      event.id === fixture('F4').id ? { ...event, tone: 'neutral' as const } : event,
    );
    await reload(mounted);
    expect(el.querySelector('[data-testid="calendar-detail-overdue"]')).toBeNull();
    current = [];
    await reload(mounted);
    expect(text(el, 'calendar-detail-title')).toBe('F4 Tache en retard');
  });

  it('m7: an unreadable zone of the event shows only the local time', async () => {
    const odd: CalendarEvent = {
      ...fixture('F1'),
      time: { kind: 'timed', start: '2026-11-18T08:00:00.000Z', end: null, timeZone: 'Not/AZone' },
    };
    const { el, settle } = await mountCalendar({ config: agenda, events: [odd] });
    el.querySelector<HTMLElement>(`button[data-event-id="${odd.id}"]`)!.click();
    await settle();
    expect(text(el, 'calendar-detail-time')).toBe('à 09:00');
  });
});
