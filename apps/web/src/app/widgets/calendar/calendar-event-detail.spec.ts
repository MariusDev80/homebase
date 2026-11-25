import { F8_TITLE, F9_TITLE, F10_COUNT, fixture } from './testing/calendar-fixtures';
import { mountCalendar } from './testing/calendar-harness';
import type { CalendarEvent } from '../../core/calendar';

const agenda = { view: 'agenda', agendaDays: 14 } as const;
const detail = (el: HTMLElement) =>
  el.querySelector<HTMLElement>('[data-testid="calendar-event-detail"]');
const text = (el: HTMLElement, id: string) =>
  el.querySelector(`[data-testid="${id}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const row = (el: HTMLElement, id: string) =>
  el.querySelector<HTMLElement>(`button[data-event-id="${id}"]`)!;

async function open(
  key: string,
  options: Parameters<typeof mountCalendar>[0] = {},
  events?: readonly CalendarEvent[],
) {
  const mounted = await mountCalendar({ config: agenda, ...options, events });
  const trigger = row(mounted.el, fixture(key).id);
  trigger.focus();
  trigger.click();
  await mounted.settle();
  return { ...mounted, trigger };
}

describe('Event sheet (CA-C3-3)', () => {
  it('F1 in Santiago shows 05:00 and (09:00 Paris)', async () => {
    const { el } = await open('F1', { zone: 'America/Santiago' });
    expect(detail(el)).not.toBeNull();
    expect(text(el, 'calendar-detail-time')).toBe('à 05:00 (09:00 Paris)');
    expect(text(el, 'calendar-detail-source')).toContain('Rappel');
    expect(text(el, 'calendar-detail-date')).toBe('mercredi 18 novembre 2026');
  });

  it('F1 in Paris has no zone suffix', async () => {
    const { el } = await open('F1');
    expect(text(el, 'calendar-detail-time')).toBe('à 09:00');
  });

  it('F7 shows 15:00 (09:00 Montreal)', async () => {
    const { el } = await open('F7');
    expect(text(el, 'calendar-detail-time')).toBe('à 15:00 (09:00 Montreal)');
  });

  it('F5 shows a range without hour', async () => {
    const { el } = await open('F5');
    expect(text(el, 'calendar-detail-date')).toMatch(/^Du .* au .*$/);
    expect(el.querySelector('[data-testid="calendar-detail-time"]')).toBeNull();
    expect(text(el, 'calendar-detail-source')).toContain('Tâche');
  });

  it('a late task says "En retard"', async () => {
    const { el } = await open('F4');
    expect(text(el, 'calendar-detail-overdue')).toBe('En retard');
  });

  it('a carried-over task says since when it is late', async () => {
    const events = [{ ...fixture('F4'), originalOn: '2026-11-10' } as CalendarEvent];
    const { el } = await open('F4', {}, events);
    expect(text(el, 'calendar-detail-overdue')).toBe('En retard depuis le 10 novembre 2026');
  });

  it('F9 shows its full title, wrapped', async () => {
    const { el } = await open('F9');
    expect(text(el, 'calendar-detail-title')).toBe(F9_TITLE);
    expect(el.querySelector('[data-testid="calendar-detail-title"]')!.classList).toContain(
      'break-words',
    );
  });

  it('renders a hostile title as text, without a recurring mention', async () => {
    const { el } = await open('F8');
    expect(text(el, 'calendar-detail-title')).toBe(F8_TITLE);
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('[data-testid="calendar-detail-recurring"]')).toBeNull();
  });

  it('mentions a recurring reminder', async () => {
    const series: CalendarEvent = { ...fixture('F1'), occurrenceKey: '2026-11-18T09:00:00' };
    const { el, settle } = await mountCalendar({ config: agenda, events: [series] });
    row(el, series.id).click();
    await settle();
    expect(text(el, 'calendar-detail-recurring')).toBe("Occurrence d'un rappel répété");
  });

  it('Escape and Back give the focus back to the Agenda row', async () => {
    const { el, settle, trigger } = await open('F1');
    expect(document.activeElement).toBe(el.querySelector('[data-testid="calendar-detail-back"]'));
    expect(el.querySelector('[data-testid="calendar-area"]')!.hasAttribute('inert')).toBe(true);
    detail(el)!
      .querySelector('button')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(detail(el)).toBeNull();
    expect(document.activeElement).toBe(trigger);

    trigger.click();
    await settle();
    el.querySelector<HTMLElement>('[data-testid="calendar-detail-back"]')!.click();
    await settle();
    expect(detail(el)).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('names the Day panel as a region labelled by its title', async () => {
    const { el, settle } = await mountCalendar();
    el.querySelector<HTMLElement>(
      `[title="Voir les ${F10_COUNT - 2} autres événements de ce jour"]`,
    )!.click();
    await settle();
    const panel = el.querySelector<HTMLElement>('[data-testid="calendar-day-panel"]')!;
    const title = panel.querySelector<HTMLElement>('[data-testid="calendar-panel-title"]')!;
    expect(panel.getAttribute('role')).toBe('region');
    expect(title.id).not.toBe('');
    expect(panel.getAttribute('aria-labelledby')).toBe(title.id);
  });

  it('from the Day panel, Back returns to the panel with the focus on the row', async () => {
    const { el, settle } = await mountCalendar();
    el.querySelector<HTMLElement>(
      `[title="Voir les ${F10_COUNT - 2} autres événements de ce jour"]`,
    )!.click();
    await settle();
    const panel = el.querySelector<HTMLElement>('[data-testid="calendar-day-panel"]')!;
    const first = panel.querySelector<HTMLElement>('li button')!;
    first.focus();
    first.click();
    await settle();
    expect(detail(el)).not.toBeNull();
    expect(panel.hasAttribute('inert')).toBe(true);
    el.querySelector<HTMLElement>('[data-testid="calendar-detail-back"]')!.click();
    await settle();
    expect(detail(el)).toBeNull();
    expect(el.querySelector('[data-testid="calendar-day-panel"]')).not.toBeNull();
    expect(panel.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(first);
  });

  it('from a Month event, Escape gives the focus back to that event', async () => {
    const { el, settle } = await mountCalendar({ maxEventsPerDay: 20 });
    const event = el.querySelector<HTMLElement>('[aria-label^="Rappel : F1 "]')!;
    expect(event).not.toBeNull();
    event.focus();
    event.click();
    await settle();
    expect(detail(el)).not.toBeNull();
    expect(text(el, 'calendar-detail-title')).toBe('F1 Rappel 09:00 Paris');
    detail(el)!
      .querySelector('button')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(detail(el)).toBeNull();
    expect(document.activeElement).toBe(event);
  });
});
