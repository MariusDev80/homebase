import type { CalendarRange } from '../../core/calendar';
import { mountCalendar } from './testing/calendar-harness';
import type { CalendarResult } from './testing/calendar-harness';

const SOURCES = ['reminders', 'todo', 'habits'] as const;
const base = { view: 'agenda', agendaDays: 7, hiddenSources: [] as string[] } as const;
const empty: CalendarResult = {
  events: [],
  failedSources: [],
  truncated: false,
  unavailable: false,
};

const button = (el: HTMLElement) =>
  el.querySelector<HTMLButtonElement>('[data-testid="calendar-sources"]')!;
const toggle = (el: HTMLElement, type: string) =>
  el.querySelector<HTMLInputElement>(`input[data-source="${type}"]`)!;

describe('CalendarComponent sources filter (CA-CO4-3)', () => {
  it('loads with the hidden sources of the configuration', async () => {
    const calls: (readonly string[] | undefined)[] = [];
    await mountCalendar({
      config: { ...base, hiddenSources: ['habits'] },
      sourceTypes: SOURCES,
      listEvents: (_range: CalendarRange, options) => {
        calls.push(options?.exclude);
        return Promise.resolve(empty);
      },
    });
    expect(calls[0]).toEqual(['habits']);
  });

  it('unchecking "Habitudes" reloads with exclude and saves the configuration', async () => {
    const calls: (readonly string[] | undefined)[] = [];
    const { el, settle, config } = await mountCalendar({
      config: base,
      sourceTypes: SOURCES,
      listEvents: (_range, options) => {
        calls.push(options?.exclude);
        return Promise.resolve(empty);
      },
    });
    button(el).click();
    await settle();
    toggle(el, 'habits').click();
    await settle();
    expect(calls.at(-1)).toEqual(['habits']);
    expect(config()).toEqual({ ...base, hiddenSources: ['habits'] });
    expect(button(el).getAttribute('aria-label')).toBe('Sources affichées (filtre actif)');
    expect(button(el).classList.contains('text-accent')).toBe(true);
  });

  it('checking it again removes it from the configuration', async () => {
    const { el, settle, config } = await mountCalendar({
      config: { ...base, hiddenSources: ['habits'] },
      sourceTypes: SOURCES,
    });
    button(el).click();
    await settle();
    expect(toggle(el, 'habits').checked).toBe(false);
    toggle(el, 'habits').click();
    await settle();
    expect(config().hiddenSources).toEqual([]);
    expect(button(el).getAttribute('aria-label')).toBe('Sources affichées');
    expect(button(el).classList.contains('text-accent')).toBe(false);
  });

  it('keeps the choice and says so when the save fails', async () => {
    const calls: (readonly string[] | undefined)[] = [];
    const { el, settle } = await mountCalendar({
      config: base,
      sourceTypes: SOURCES,
      updateConfig: () => Promise.reject(new Error('disk')),
      listEvents: (_range, options) => {
        calls.push(options?.exclude);
        return Promise.resolve(empty);
      },
    });
    button(el).click();
    await settle();
    toggle(el, 'todo').click();
    await settle();
    expect(el.querySelector('[data-testid="calendar-status"]')!.textContent).toContain(
      "Le choix n'a pas pu être enregistré.",
    );
    expect(calls.at(-1)).toEqual(['todo']);
    expect(toggle(el, 'todo').checked).toBe(false);
  });

  it('keeps the hidden sources when the view is saved', async () => {
    const { el, settle, config } = await mountCalendar({
      config: { ...base, view: 'month', hiddenSources: ['todo'] },
      sourceTypes: SOURCES,
    });
    el.querySelector<HTMLElement>('[data-testid="calendar-view-agenda"]')!.click();
    await settle();
    expect(config()).toEqual({ view: 'agenda', agendaDays: 7, hiddenSources: ['todo'] });
  });

  it('shows allHidden instead of the empty state when everything is hidden', async () => {
    const { el, settle } = await mountCalendar({
      config: { ...base, hiddenSources: ['reminders', 'todo'] },
      sourceTypes: SOURCES,
      events: [],
    });
    expect(el.querySelector('[data-testid="calendar-all-hidden"]')).toBeNull();
    button(el).click();
    await settle();
    toggle(el, 'habits').click();
    await settle();
    expect(el.querySelector('[data-testid="calendar-all-hidden"]')!.textContent).toContain(
      'Toutes les sources sont masquées.',
    );
    expect(el.querySelector('[data-testid="calendar-empty"]')).toBeNull();
  });
});

describe('CalendarComponent sources filter (review)', () => {
  it('ignores a hidden type that is no longer registered', async () => {
    const { el } = await mountCalendar({
      config: { ...base, hiddenSources: ['gone'] },
      sourceTypes: SOURCES,
    });
    expect(button(el).getAttribute('aria-label')).toBe('Sources affichées');
    expect(button(el).classList.contains('text-accent')).toBe(false);
  });

  it('writes the hidden sources without duplicates', async () => {
    const { el, settle, config } = await mountCalendar({
      config: { ...base, hiddenSources: ['habits', 'habits'] },
      sourceTypes: SOURCES,
    });
    button(el).click();
    await settle();
    toggle(el, 'todo').click();
    await settle();
    expect(config().hiddenSources).toEqual(['habits', 'todo']);
  });

  it('toggles the panel with the filter button and links it with aria-controls', async () => {
    const { el, settle } = await mountCalendar({ config: base, sourceTypes: SOURCES });
    document.body.appendChild(el);
    button(el).click();
    await settle();
    const panel = el.querySelector('[data-testid="calendar-sources-panel"]')!;
    expect(button(el).getAttribute('aria-controls')).toBe(panel.id);
    expect(toggle(el, 'todo').getAttribute('role')).toBe('switch');
    button(el).click();
    await settle();
    expect(el.querySelector('[data-testid="calendar-sources-panel"]')).toBeNull();
    expect(document.activeElement).toBe(button(el));
    el.remove();
  });
});

describe('CalendarSourcesPanelComponent (CA-CO4-4)', () => {
  it('makes the calendar area inert and flags the button as expanded', async () => {
    const { el, settle } = await mountCalendar({ config: base, sourceTypes: SOURCES });
    expect(button(el).getAttribute('aria-expanded')).toBe('false');
    button(el).click();
    await settle();
    expect(button(el).getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelector('[data-testid="calendar-area"]')!.hasAttribute('inert')).toBe(true);
    expect(el.querySelector('[data-testid="calendar-sources-title"]')!.textContent).toContain(
      'Sources affichées',
    );
  });

  it('names the panel as a region labelled by its title', async () => {
    const { el, settle } = await mountCalendar({ config: base, sourceTypes: SOURCES });
    button(el).click();
    await settle();
    const panel = el.querySelector('[data-testid="calendar-sources-panel"]')!;
    const title = el.querySelector('[data-testid="calendar-sources-title"]')!;
    expect(panel.getAttribute('role')).toBe('region');
    expect(title.id).not.toBe('');
    expect(panel.getAttribute('aria-labelledby')).toBe(title.id);
  });

  it('gives every switch an accessible name, visible by default', async () => {
    const { el, settle } = await mountCalendar({ config: base, sourceTypes: SOURCES });
    button(el).click();
    await settle();
    const names = SOURCES.map((type) => toggle(el, type).closest('label')!.textContent!.trim());
    expect(names).toEqual(['Rappels', 'Tâches', 'Habitudes']);
    expect(SOURCES.every((type) => toggle(el, type).checked)).toBe(true);
  });

  it('closes on Escape and gives the focus back to the filter button', async () => {
    const { el, settle } = await mountCalendar({ config: base, sourceTypes: SOURCES });
    document.body.appendChild(el);
    button(el).click();
    await settle();
    const outer = vi.fn();
    document.body.addEventListener('keydown', outer);
    el.querySelector('[data-testid="calendar-sources-panel"]')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    document.body.removeEventListener('keydown', outer);
    expect(outer).not.toHaveBeenCalled();
    await settle();
    expect(el.querySelector('[data-testid="calendar-sources-panel"]')).toBeNull();
    expect(el.querySelector('[data-testid="calendar-area"]')!.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(button(el));
    el.remove();
  });

  it('closes on "Retour" and gives the focus back to the filter button', async () => {
    const { el, settle } = await mountCalendar({ config: base, sourceTypes: SOURCES });
    document.body.appendChild(el);
    button(el).click();
    await settle();
    el.querySelector<HTMLElement>('[data-testid="calendar-sources-back"]')!.click();
    await settle();
    expect(el.querySelector('[data-testid="calendar-sources-panel"]')).toBeNull();
    expect(document.activeElement).toBe(button(el));
    el.remove();
  });
});
