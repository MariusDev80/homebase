import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { F10_COUNT, F8_TITLE, fixture } from './testing/calendar-fixtures';
import { CalendarMonthComponent } from './calendar-month.component';
import { mountCalendar } from './testing/calendar-harness';

const MORE_HINT = (count: number) => `Voir les ${count} autres événements de ce jour`;
const panel = (el: HTMLElement) =>
  el.querySelector<HTMLElement>('[data-testid="calendar-day-panel"]');
const moreLink = (el: HTMLElement, count: number) =>
  el.querySelector<HTMLElement>(`[title="${MORE_HINT(count)}"]`);

describe('Month view (defect 2: the +N opens our Day panel)', () => {
  it('opens the panel of the 20th with the 12 events, inside the card, with no popover', async () => {
    const { el, settle } = await mountCalendar();
    const link = moreLink(el, F10_COUNT - 2);
    expect(link).not.toBeNull();
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    link!.dispatchEvent(click);
    await settle();
    expect(click.defaultPrevented).toBe(true);
    const p = panel(el)!;
    expect(p).not.toBeNull();
    expect(p.querySelector('[data-testid="calendar-panel-title"]')!.textContent).toContain(
      '20 novembre 2026',
    );
    expect(p.querySelectorAll('li')).toHaveLength(F10_COUNT);
    expect(p.classList.contains('overflow-y-auto')).toBe(true);
    expect(el.contains(p)).toBe(true);
    expect(document.querySelector('.hb-fc-popover')).toBeNull();
    expect(el.querySelector('[data-testid="calendar-area"]')!.hasAttribute('inert')).toBe(true);
  });

  it('gives the focus back to the +N on Escape, and reaches the rows with the keyboard', async () => {
    const { el, settle } = await mountCalendar();
    const link = moreLink(el, F10_COUNT - 2)!;
    link.focus();
    link.click();
    await settle();
    const rows = panel(el)!.querySelectorAll<HTMLButtonElement>('li button');
    expect(rows).toHaveLength(F10_COUNT);
    expect(document.activeElement).toBe(
      panel(el)!.querySelector('[data-testid="calendar-panel-back"]'),
    );
    rows[F10_COUNT - 1].focus();
    rows[F10_COUNT - 1].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await settle();
    expect(panel(el)).toBeNull();
    expect(el.querySelector('[data-testid="calendar-area"]')!.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(link);
  });

  it('opens the panel with Enter and Space on the +N, without any popover', async () => {
    for (const key of ['Enter', ' ']) {
      const { el, settle, fixture: f } = await mountCalendar();
      const link = moreLink(el, F10_COUNT - 2)!;
      const keydown = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      link.dispatchEvent(keydown);
      await settle();
      expect(keydown.defaultPrevented).toBe(true);
      expect(panel(el)).not.toBeNull();
      expect(document.querySelector('.hb-fc-popover')).toBeNull();
      f.destroy();
      TestBed.resetTestingModule();
    }
  });

  it('closes with Back', async () => {
    const { el, settle } = await mountCalendar();
    moreLink(el, F10_COUNT - 2)!.click();
    await settle();
    panel(el)!.querySelector<HTMLElement>('[data-testid="calendar-panel-back"]')!.click();
    await settle();
    expect(panel(el)).toBeNull();
  });

  it('opens the panel of the 17th in Santiago (day read by formatIso)', async () => {
    const extra = ['a', 'b'].map((key, i) => ({
      ...fixture('F1'),
      id: `reminders:X${key}:`,
      sourceId: `X${key}`,
      title: `X ${key}`,
      time: {
        kind: 'timed' as const,
        start: `2026-11-17T1${i}:00:00.000Z`,
        end: null,
        timeZone: 'Europe/Paris',
      },
    }));
    const { el, settle } = await mountCalendar({
      zone: 'America/Santiago',
      events: [fixture('F3'), ...extra],
    });
    const link = moreLink(el, 1);
    expect(link).not.toBeNull();
    link!.click();
    await settle();
    expect(panel(el)!.querySelector('[data-testid="calendar-panel-title"]')!.textContent).toContain(
      '17 novembre 2026',
    );
    expect(panel(el)!.querySelectorAll('li')).toHaveLength(3);
  });
});

describe('Month "+N" capture', () => {
  const monthOf = (f: ComponentFixture<unknown>) =>
    f.debugElement.query(By.directive(CalendarMonthComponent))
      .componentInstance as CalendarMonthComponent;

  it('emits dayOpened exactly once per click, Enter and Space', async () => {
    const { el, fixture: f, settle } = await mountCalendar();
    const opened: unknown[] = [];
    monthOf(f).dayOpened.subscribe((value) => opened.push(value));
    const link = moreLink(el, F10_COUNT - 2)!;
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(opened).toHaveLength(1);
    for (const key of ['Enter', ' ']) {
      link.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    }
    expect(opened).toHaveLength(3);
    await settle();
  });

  it('emits nothing after destroy when the old host is clicked', async () => {
    const { el, fixture: f, settle } = await mountCalendar();
    const opened: unknown[] = [];
    monthOf(f).dayOpened.subscribe((value) => opened.push(value));
    const link = moreLink(el, F10_COUNT - 2)!;
    f.destroy();
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await settle();
    expect(opened).toHaveLength(0);
  });
});

describe('Month rendering', () => {
  it('shows 23:30 and 02:00 on the 18th in Paris, F2 not on the 19th, French headers', async () => {
    const { el } = await mountCalendar({ maxEventsPerDay: 20 });
    const text = el.querySelector('[data-testid="calendar-month-host"]')!.textContent!;
    expect(text).toMatch(/23:30\s*F2/);
    expect(text).toMatch(/02:00\s*F3/);
    expect(text.match(/F2 Rappel/g)).toHaveLength(1);
    expect(text).toContain(F8_TITLE);
    expect(el.querySelector('img')).toBeNull();
    const header =
      el.querySelector('[role="columnheader"] [aria-hidden="true"]')?.textContent ?? '';
    expect(header.trim().toLowerCase().startsWith('lun.')).toBe(true);
  });

  it('moves "today" with the clock (P1)', async () => {
    const { el, clock, settle } = await mountCalendar({ maxEventsPerDay: 20 });
    const today = () =>
      [...el.querySelectorAll('[role="cell"].bg-accent-subtle')]
        .map((c) => c.getAttribute('data-date'))
        .join(',');
    const before = today();
    expect(before).toBe('2026-11-18');
    clock.set('2026-11-19T10:00:00.000Z');
    window.dispatchEvent(new Event('focus'));
    await settle();
    expect(today()).toBe('2026-11-19');
  });
});

describe('Size and failures', () => {
  it('forces the Agenda under the threshold without rewriting the config (CA-C2-8)', async () => {
    const { fixture: f, el, config, settle } = await mountCalendar();
    expect(el.querySelector('[data-testid="calendar-month-host"]')).not.toBeNull();
    f.componentInstance.onResize(500, 400);
    await settle();
    expect(el.querySelector('[data-testid="calendar-view-month"]')).toBeNull();
    expect(el.querySelector('[data-testid="calendar-month-host"]')).toBeNull();
    expect(el.querySelector('[data-testid="calendar-agenda"]')).not.toBeNull();
    expect(config().view).toBe('month');
    f.componentInstance.onResize(700, 400);
    await settle();
    expect(el.querySelector('[data-testid="calendar-view-month"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="calendar-month-host"]')).not.toBeNull();
    expect(config().view).toBe('month');
  });

  it('shows monthFailed and a button to the Agenda when the stylesheet fails (CA-C2-9)', async () => {
    const { el, settle } = await mountCalendar({ styles: () => Promise.reject(new Error('x')) });
    expect(el.querySelector('[data-testid="calendar-month-failed"]')!.textContent).toContain(
      "La vue Mois n'a pas pu s'afficher.",
    );
    el.querySelector<HTMLElement>('[data-testid="calendar-show-agenda"]')!.click();
    await settle();
    expect(el.querySelector('[data-testid="calendar-agenda"]')).not.toBeNull();
  });
});
