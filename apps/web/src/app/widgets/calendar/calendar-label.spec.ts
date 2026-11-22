import { ApplicationInitStatus } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { provideAppI18n } from '../../core/i18n';
import { FakeSettingsRepository } from '../../core/testing/fake-settings.repository';
import { SYSTEM_TIME_ZONE_READER, TimeDisplay, UserTimeZone } from '../../core/time';
import { ManualClock } from '../../core/time/testing/manual-clock';
import { CLOCK, SETTINGS_REPOSITORY } from '../../data';
import { eventName } from './calendar-label';
import type { CalendarEvent } from '../../core/calendar/calendar-source';
import {
  CALENDAR_FIXTURES,
  OCCURRENCE_FIXTURES,
  fixture,
  occurrenceFixture,
} from './testing/calendar-fixtures';
import { mountCalendar } from './testing/calendar-harness';

async function names(zone = 'Europe/Paris') {
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
  const display = TestBed.inject(TimeDisplay);
  const transloco = TestBed.inject(TranslocoService);
  return (key: string | CalendarEvent) =>
    eventName(
      typeof key !== 'string'
        ? key
        : OCCURRENCE_FIXTURES.some((e) => e.sourceId === key)
          ? occurrenceFixture(key)
          : fixture(key),
      display,
      zone,
      (k, params) => transloco.translate(k, params),
    );
}

describe('eventName (CA-C3-4)', () => {
  it('names a timed reminder', async () => {
    const name = await names();
    expect(name('F1')).toBe('Rappel : F1 Rappel 09:00 Paris, mercredi 18 novembre 2026, 09:00');
  });

  it('uses the display zone', async () => {
    const name = await names('America/Santiago');
    expect(name('F1')).toBe('Rappel : F1 Rappel 09:00 Paris, mercredi 18 novembre 2026, 05:00');
  });

  it('names an all-day task, a late one and a multi-day one', async () => {
    const name = await names();
    expect(name('F8')).toContain(', jeudi 19 novembre 2026, toute la journée');
    expect(name('F8').startsWith('Tâche : ')).toBe(true);
    expect(name('F4')).toBe(
      'Tâche : F4 Tache en retard, mercredi 18 novembre 2026, toute la journée, en retard',
    );
    expect(name('F5')).toMatch(/^Tâche : F5 Tache sur trois jours, du .* au .*, toute la journée$/);
  });
});

describe('accessible names in the views (CA-C3-4)', () => {
  it('every Agenda row carries the name', async () => {
    const { el } = await mountCalendar({ config: { view: 'agenda', agendaDays: 7 } });
    const rows = el.querySelectorAll<HTMLElement>('button[data-event-id]');
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.getAttribute('aria-label')).toMatch(/^(Rappel|Tâche) : /);
    expect(
      el.querySelector('button[data-event-id="reminders:F1:"]')!.getAttribute('aria-label'),
    ).toBe('Rappel : F1 Rappel 09:00 Paris, mercredi 18 novembre 2026, 09:00');
  });

  it('every Month event carries the name as aria-label', async () => {
    const { el } = await mountCalendar({ maxEventsPerDay: 20 });
    const labelled = [...el.querySelectorAll<HTMLElement>('[aria-label^="Rappel : F1 "]')];
    expect(labelled.length).toBeGreaterThan(0);
    expect(labelled[0].getAttribute('aria-label')).toBe(
      'Rappel : F1 Rappel 09:00 Paris, mercredi 18 novembre 2026, 09:00',
    );
    const task = el.querySelector('[aria-label^="Tâche : F4 "]');
    expect(task!.getAttribute('aria-label')).toMatch(/, en retard$/);
  });

  it('every Month event element carries exactly eventName (all fixtures)', async () => {
    const { el } = await mountCalendar({ maxEventsPerDay: 50 });
    const display = TestBed.inject(TimeDisplay);
    const transloco = TestBed.inject(TranslocoService);
    const zone = TestBed.inject(UserTimeZone).id();
    const nodes = [...el.querySelectorAll<HTMLElement>('[data-event-id]')];
    const seen = new Set<string>();
    for (const node of nodes) {
      const id = node.dataset['eventId']!;
      const event = CALENDAR_FIXTURES.find((candidate) => candidate.id === id)!;
      expect(node.getAttribute('aria-label')).toBe(
        eventName(event, display, zone, (k, params) => transloco.translate(k, params), undefined),
      );
      seen.add(id);
    }
    // F6 (24 October) lies before the six displayed weeks: only the others are checked.
    for (const event of CALENDAR_FIXTURES.filter((e) => e.sourceId !== 'F6')) {
      expect(seen.has(event.id)).toBe(true);
    }
  });
});

describe('habit names (CA-CO3-6)', () => {
  it('names an all-day planned habit', async () => {
    const name = await names();
    expect(name('F14')).toBe(
      'Habitude : F14 Habitude a faire, vendredi 20 novembre 2026, toute la journée, à faire',
    );
  });

  it('names a timed planned habit', async () => {
    const name = await names();
    expect(name('F15')).toBe(
      'Habitude : F15 Habitude 08:00, vendredi 20 novembre 2026, 08:00, à faire',
    );
  });

  it('names a timed done habit', async () => {
    const name = await names();
    expect(name({ ...occurrenceFixture('F15'), tone: 'success', status: 'done' })).toBe(
      'Habitude : F15 Habitude 08:00, vendredi 20 novembre 2026, 08:00, fait',
    );
  });
});
