import { ApplicationInitStatus } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import type { CalendarEvent, CalendarEventStatus } from '../../core/calendar';
import { provideAppI18n } from '../../core/i18n';
import { FakeSettingsRepository } from '../../core/testing/fake-settings.repository';
import { SYSTEM_TIME_ZONE_READER, TimeDisplay, UserTimeZone } from '../../core/time';
import { ManualClock } from '../../core/time/testing/manual-clock';
import { CLOCK, SETTINGS_REPOSITORY } from '../../data';
import { eventName, recurringKey } from './calendar-label';
import { buildMonthOptions, toEventInputs } from './calendar-month-options';
import { fixture, OCCURRENCE_FIXTURES, occurrenceFixture } from './testing/calendar-fixtures';
import { mountCalendar } from './testing/calendar-harness';

const agenda = { view: 'agenda', agendaDays: 14 } as const;
const text = (el: HTMLElement, id: string) =>
  el.querySelector(`[data-testid="${id}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const row = (el: HTMLElement, id: string) =>
  el.querySelector<HTMLElement>(`button[data-event-id="${id}"]`)!;

async function nameOf(event: CalendarEvent): Promise<string> {
  TestBed.configureTestingModule({
    providers: [
      provideAppI18n(),
      { provide: CLOCK, useValue: new ManualClock('2026-11-18T10:00:00.000Z') },
      { provide: SETTINGS_REPOSITORY, useValue: new FakeSettingsRepository() },
      { provide: SYSTEM_TIME_ZONE_READER, useValue: () => 'Europe/Paris' },
    ],
  });
  await TestBed.inject(ApplicationInitStatus).donePromise;
  await TestBed.inject(UserTimeZone).setPreference('Europe/Paris');
  const transloco = TestBed.inject(TranslocoService);
  return eventName(event, TestBed.inject(TimeDisplay), 'Europe/Paris', (k, p) =>
    transloco.translate(k, p),
  );
}

describe('eventName reads the status, never the tone (CA-CO1-3)', () => {
  it.each<[CalendarEventStatus, string]>([
    ['overdue', 'en retard'],
    ['projected', 'répétition prévue'],
    ['done', 'fait'],
    ['planned', 'à faire'],
  ])('suffixes %s with ", %s"', async (status, label) => {
    const name = await nameOf({ ...fixture('F8'), status });
    expect(name.endsWith(`, toute la journée, ${label}`)).toBe(true);
  });

  it('does not say "en retard" for a danger tone without a status', async () => {
    const name = await nameOf({ ...fixture('F8'), tone: 'danger' });
    expect(name).not.toContain('en retard');
    expect(name.endsWith('toute la journée')).toBe(true);
  });

  it('names a habit as in the spec examples', async () => {
    expect(await nameOf(occurrenceFixture('F14'))).toBe(
      'Habitude : F14 Habitude a faire, vendredi 20 novembre 2026, toute la journée, à faire',
    );
    TestBed.resetTestingModule();
    expect(await nameOf(occurrenceFixture('F13'))).toBe(
      'Habitude : F13 Habitude faite, mercredi 18 novembre 2026, toute la journée, fait',
    );
    TestBed.resetTestingModule();
    expect(await nameOf(occurrenceFixture('F12'))).toMatch(
      /, toute la journée, répétition prévue$/,
    );
  });
});

describe('Agenda rendering of the statuses (CA-CO1-4, CA-CO1-8, CA-CO1-9)', () => {
  const all = [fixture('F4'), ...OCCURRENCE_FIXTURES];

  it('shows the overdue icon and wording for F4', async () => {
    const { el } = await mountCalendar({ config: agenda, events: all });
    const item = row(el, fixture('F4').id);
    expect(item.querySelector('.pi-exclamation-circle.text-danger')).not.toBeNull();
    expect(item.querySelector('.sr-only')!.textContent).toBe('en retard');
  });

  it('mutes the title of a projection (F12) and ticks a done habit (F13)', async () => {
    const { el } = await mountCalendar({ config: agenda, events: all });
    const projected = row(el, occurrenceFixture('F12').id);
    const title = projected.querySelector('[data-testid="calendar-row-title"]')!;
    expect(title.classList).toContain('text-fg-muted');
    expect(title.classList).not.toContain('text-fg');
    expect(projected.querySelector('.pi-check')).toBeNull();
    const done = row(el, occurrenceFixture('F13').id);
    expect(done.querySelector('.pi-check.text-success')).not.toBeNull();
    expect(done.querySelector('[data-testid="calendar-row-title"]')!.classList).toContain(
      'text-fg',
    );
    const planned = row(el, occurrenceFixture('F14').id);
    expect(planned.querySelector('.pi-check')).toBeNull();
  });

  it('orders the 20th as in K18: F14, F16, F15 (08:00), F17 (09:00)', async () => {
    const { el } = await mountCalendar({ config: agenda, events: all });
    const day = el.querySelector('section[data-day="2026-11-20"]')!;
    const ids = [...day.querySelectorAll('button[data-event-id]')].map((b) =>
      b.getAttribute('data-event-id'),
    );
    expect(ids).toEqual([
      'habits:F14:2026-11-20',
      'todo:F16:',
      'habits:F15:2026-11-20',
      'reminders:F17:',
    ]);
  });

  it('labels all-day rows "Toute la journée" on one line, and keeps HH:MM for timed ones', async () => {
    const { el } = await mountCalendar({ config: agenda, events: all });
    const day = el.querySelector('section[data-day="2026-11-20"]')!;
    const cells = [...day.querySelectorAll('[data-testid="calendar-row-time"]')];
    expect(cells.map((c) => c.textContent!.trim())).toEqual([
      'Toute la journée',
      'Toute la journée',
      '08:00',
      '09:00',
    ]);
    for (const cell of cells) {
      const label = cell.textContent!.trim();
      if (label === 'Toute la journée') {
        expect(cell.classList).toContain('w-28');
        expect(cell.classList).toContain('whitespace-nowrap');
      } else {
        expect(label).toMatch(/^\d{2}:\d{2}$/);
      }
    }
  });

  it('stacks the hour above the title under 20rem', async () => {
    const { el } = await mountCalendar({ config: agenda, events: all });
    const button = row(el, occurrenceFixture('F14').id);
    for (const cls of ['@max-[20rem]:flex-col', '@max-[20rem]:items-start', '@max-[20rem]:gap-0']) {
      expect(button.classList).toContain(cls);
    }
    expect(button.className).not.toContain('14rem');
  });

  it('gives every day header the box-subheader class with the subtle background', async () => {
    const { el } = await mountCalendar({ config: agenda, events: all });
    const headers = el.querySelectorAll('[data-testid="calendar-day-header"]');
    expect(headers.length).toBeGreaterThan(0);
    for (const header of headers) {
      for (const cls of ['box-subheader', 'bg-canvas-subtle', 'border-default']) {
        expect(header.classList).toContain(cls);
      }
    }
  });

  it('shows today in text-fg with an accent border (contrast fallback)', async () => {
    const { el } = await mountCalendar({ config: agenda, events: all });
    const header = el.querySelector('section[data-day="2026-11-18"] h3')!;
    expect(header.classList).toContain('text-fg');
    expect(header.classList).not.toContain('text-accent');
    const pill = header.querySelector('[data-testid="calendar-day-pill"]')!;
    expect(pill.classList).toContain('border-accent');
    expect(pill.classList).toContain('text-fg');
    expect(pill.classList).not.toContain('text-accent');
  });
});

describe('Event sheet (CA-CO1-5)', () => {
  async function open(event: CalendarEvent) {
    const mounted = await mountCalendar({ config: agenda, events: [event] });
    row(mounted.el, event.id).click();
    await mounted.settle();
    return mounted.el;
  }

  it('says the repetition is planned for a projection', async () => {
    const el = await open(occurrenceFixture('F12'));
    expect(text(el, 'calendar-detail-status')).toBe(
      "Répétition prévue : elle deviendra l'échéance quand la précédente sera cochée.",
    );
    expect(el.querySelector('[data-testid="calendar-detail-recurring"]')).toBeNull();
    expect(el.querySelector('[data-testid="calendar-detail-overdue"]')).toBeNull();
  });

  it('says "Fait" for a done habit and "À faire" for a planned one, with no repeated line', async () => {
    const done = await open(occurrenceFixture('F13'));
    expect(text(done, 'calendar-detail-status')).toBe('Fait');
    expect(done.querySelector('[data-testid="calendar-detail-status"] .pi-check')).not.toBeNull();
    expect(done.querySelector('[data-testid="calendar-detail-recurring"]')).toBeNull();
    TestBed.resetTestingModule();
    const planned = await open(occurrenceFixture('F14'));
    expect(text(planned, 'calendar-detail-status')).toBe('À faire');
    expect(planned.querySelector('[data-testid="calendar-detail-recurring"]')).toBeNull();
  });

  it('says "à 08:00" for a habit at a time', async () => {
    const el = await open(occurrenceFixture('F15'));
    expect(text(el, 'calendar-detail-time')).toBe('à 08:00');
    expect(el.querySelector('[data-testid="calendar-detail-recurring"]')).toBeNull();
  });

  it('keeps the overdue line for F4', async () => {
    const el = await open(fixture('F4'));
    expect(text(el, 'calendar-detail-overdue')).toBe('En retard');
  });

  it('names the repeated line of a reminder and of a repeating todo', async () => {
    const reminder: CalendarEvent = { ...fixture('F1'), occurrenceKey: '2026-11-18T09:00:00' };
    expect(recurringKey(reminder)).toBe('recurring');
    const todo: CalendarEvent = {
      ...fixture('F8'),
      id: 'todo:F8:2026-11-19',
      occurrenceKey: '2026-11-19',
    };
    expect(recurringKey(todo)).toBe('recurringTodo');
    expect(recurringKey({ ...todo, status: 'overdue' })).toBe('recurringTodo');
    expect(recurringKey({ ...todo, status: 'projected' })).toBeNull();
    expect(recurringKey(occurrenceFixture('F13'))).toBeNull();
    expect(recurringKey(fixture('F8'))).toBeNull();
    TestBed.resetTestingModule();
    const el = await open(todo);
    expect(text(el, 'calendar-detail-recurring')).toBe("Échéance d'une tâche répétée");
  });
});

describe('Month order and projections (CA-CO1-6)', () => {
  it('gives rank = index and border-dashed to a projection only', () => {
    const events = [fixture('F4'), occurrenceFixture('F12'), occurrenceFixture('F13')];
    const inputs = toEventInputs(events);
    expect(inputs.map((i) => i['rank'])).toEqual([0, 1, 2]);
    expect(String(inputs[1].className)).toContain('border-dashed');
    expect(String(inputs[0].className)).not.toContain('border-dashed');
    expect(String(inputs[2].className)).not.toContain('border-dashed');
  });

  it('orders the cells by rank, strictly', () => {
    const options = buildMonthOptions({
      monthStart: '2026-11-01',
      timeZone: 'Europe/Paris',
      nowIso: '2026-11-18T10:00:00.000Z',
      maxEventsPerDay: true,
      events: [],
      moreHint: () => '',
      onMoreLink: () => undefined,
      onEventClick: () => undefined,
      eventName: () => null,
    });
    expect(options.eventOrder).toBe('rank');
    expect(options.eventOrderStrict).toBe(true);
  });

  const monthIds = (el: HTMLElement, day: string) =>
    [...el.querySelectorAll(`[data-date="${day}"] [data-event-id]`)].map((n) =>
      n.getAttribute('data-event-id'),
    );

  it('renders the 20th as F14, F16, F15, F17 in the Month cell', async () => {
    const { el } = await mountCalendar({
      maxEventsPerDay: true,
      events: OCCURRENCE_FIXTURES,
    });
    expect(monthIds(el, '2026-11-20')).toEqual([
      'habits:F14:2026-11-20',
      'todo:F16:',
      'habits:F15:2026-11-20',
      'reminders:F17:',
    ]);
  });

  it('keeps the aggregation order of two all-day events against the alphabetical order', async () => {
    const zed: CalendarEvent = {
      ...fixture('F8'),
      id: 'todo:zed:',
      sourceId: 'zed',
      title: 'Zed first',
    };
    const alpha: CalendarEvent = {
      ...fixture('F8'),
      id: 'todo:alpha:',
      sourceId: 'alpha',
      title: 'Alpha second',
    };
    const { el } = await mountCalendar({ maxEventsPerDay: true, events: [zed, alpha] });
    expect(monthIds(el, '2026-11-19')).toEqual(['todo:zed:', 'todo:alpha:']);
  });

  it('marks a projected task with border-dashed in the rendered Month', async () => {
    const { el } = await mountCalendar({ maxEventsPerDay: true, events: OCCURRENCE_FIXTURES });
    const projected = el.querySelector('[data-event-id="todo:F12:2026-11-25"]')!;
    expect(projected.classList).toContain('border-dashed');
  });
});
