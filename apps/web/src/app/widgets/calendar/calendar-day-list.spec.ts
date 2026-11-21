import { ApplicationInitStatus } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CalendarEvent } from '../../core/calendar';
import { provideAppI18n } from '../../core/i18n';
import { FakeSettingsRepository } from '../../core/testing/fake-settings.repository';
import { SYSTEM_TIME_ZONE_READER, UserTimeZone } from '../../core/time';
import { ManualClock } from '../../core/time/testing/manual-clock';
import { CLOCK, SETTINGS_REPOSITORY } from '../../data';
import { CalendarDayListComponent } from './calendar-day-list.component';
import { CALENDAR_FIXTURES, F10_COUNT, F8_TITLE } from './testing/calendar-fixtures';

async function mount(
  zone: string,
  firstOn = '2026-11-18',
  lastOn = '2026-11-24',
  events: readonly CalendarEvent[] = CALENDAR_FIXTURES,
) {
  TestBed.configureTestingModule({
    providers: [
      provideAppI18n(),
      { provide: CLOCK, useValue: new ManualClock('2026-11-18T10:00:00.000Z') },
      { provide: SETTINGS_REPOSITORY, useValue: new FakeSettingsRepository() },
      { provide: SYSTEM_TIME_ZONE_READER, useValue: () => zone },
    ],
  });
  await TestBed.inject(ApplicationInitStatus).donePromise;
  await TestBed.inject(UserTimeZone).setPreference(zone);
  const fixture = TestBed.createComponent(CalendarDayListComponent);
  fixture.componentRef.setInput('events', events);
  fixture.componentRef.setInput('firstOn', firstOn);
  fixture.componentRef.setInput('lastOn', lastOn);
  fixture.componentRef.setInput('today', '2026-11-18');
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const section = (el: HTMLElement, day: string) =>
  el.querySelector<HTMLElement>(`section[data-day="${day}"]`)!;

describe('CalendarDayListComponent (defect 1: one section per day)', () => {
  it('has one section per day with events, each with its own h3 header', async () => {
    const el = await mount('Europe/Paris');
    const days = [...el.querySelectorAll('section')].map((s) => s.getAttribute('data-day'));
    expect(days).toEqual([
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-22',
      '2026-11-23',
      '2026-11-24',
    ]);
    for (const s of el.querySelectorAll('section')) {
      expect(s.querySelectorAll('h3')).toHaveLength(1);
      expect(s.querySelectorAll('ul')).toHaveLength(1);
      const labelledBy = s.getAttribute('aria-labelledby')!;
      expect(s.querySelector(`#${labelledBy}`)).toBe(s.querySelector('h3'));
    }
    // A list never holds the events of two days.
    expect(el.querySelectorAll('ul')).toHaveLength(days.length);
  });

  it('styles the header and the rows with the border tokens', async () => {
    const el = await mount('Europe/Paris');
    const header = section(el, '2026-11-19').querySelector('h3')!;
    for (const cls of ['sticky', 'bg-canvas-subtle', 'border-default']) {
      expect(header.classList.contains(cls)).toBe(true);
    }
    expect(header.textContent).toContain('19 nov.');
    for (const li of el.querySelectorAll('li')) expect(li.classList).toContain('border-muted');
  });

  it('marks today and tomorrow', async () => {
    const el = await mount('Europe/Paris');
    expect(section(el, '2026-11-18').querySelector('h3')!.textContent).toContain("Aujourd'hui");
    expect(section(el, '2026-11-19').querySelector('h3')!.textContent).toContain('Demain');
    expect(section(el, '2026-11-20').querySelector('[data-testid="calendar-day-pill"]')).toBeNull();
  });

  it('shows hours as HH:MM', async () => {
    const el = await mount('Europe/Paris');
    const times = [
      ...section(el, '2026-11-18').querySelectorAll('[data-testid="calendar-row-time"]'),
    ].map((t) => t.textContent!.trim());
    expect(times).toEqual(['Journée', '02:00', '09:00', '23:30']);
    for (const t of el.querySelectorAll('[data-testid="calendar-row-time"]')) {
      const text = t.textContent!.trim();
      expect(text === 'Journée' || /^\d{2}:\d{2}$/.test(text)).toBe(true);
    }
  });

  it('lists the 12 events of F10 under the 20th', async () => {
    const el = await mount('Europe/Paris');
    expect(section(el, '2026-11-20').querySelectorAll('li')).toHaveLength(F10_COUNT);
  });

  it('places F3 under the 17th in Santiago', async () => {
    const el = await mount('America/Santiago', '2026-11-17', '2026-11-24');
    expect(section(el, '2026-11-17').textContent).toContain('F3');
    expect(section(el, '2026-11-18').textContent).not.toContain('F3');
  });

  it('renders F8 as text, without any img', async () => {
    const el = await mount('Europe/Paris');
    expect(el.textContent).toContain(F8_TITLE);
    expect(el.querySelector('img')).toBeNull();
  });

  it('shows today with a quiet line when it has no event (L14)', async () => {
    const empty = await mount('Europe/Paris', '2026-11-18', '2026-11-24', []);
    expect(empty.textContent).toContain("Rien de prévu aujourd'hui.");
  });
});
