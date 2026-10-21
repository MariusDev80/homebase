import { TestBed } from '@angular/core/testing';
import { ApplicationInitStatus } from '@angular/core';
import { SETTINGS_REPOSITORY } from '../../data';
import { provideAppI18n } from '../i18n';
import { FakeSettingsRepository } from '../testing/fake-settings.repository';
import { TimeDisplay } from './time-display';
import { SYSTEM_TIME_ZONE_READER } from './time-zone';

describe('TimeDisplay', () => {
  let display: TimeDisplay;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideAppI18n(),
        { provide: SETTINGS_REPOSITORY, useValue: new FakeSettingsRepository() },
        { provide: SYSTEM_TIME_ZONE_READER, useValue: () => 'Europe/Paris' },
      ],
    });
    await TestBed.inject(ApplicationInitStatus).donePromise;
    display = TestBed.inject(TimeDisplay);
  });

  const nbsp = (s: string): string => s.replace(/\s/g, ' ');

  it('formats local dates in French, whatever the user zone', () => {
    expect(nbsp(display.formatLocalDate('2026-11-03', 'short'))).toBe('3 nov. 2026');
    expect(display.formatLocalDate('2026-11-03', 'long')).toBe('3 novembre 2026');
    expect(display.formatLocalDate('2026-11-03', 'weekday-long')).toBe('mardi 3 novembre 2026');
  });

  it('formats instants in the given zone, defaulting to the user zone', () => {
    const instant = '2026-11-03T08:00:00.000Z';
    expect(display.formatInstant(instant, 'time')).toBe('09:00');
    expect(display.formatInstant(instant, 'time', 'America/Montreal')).toBe('03:00');
    expect(nbsp(display.formatInstant(instant, 'date', 'UTC'))).toBe('3 nov. 2026');
  });

  it('date-time matches Intl built with the same options', () => {
    const expected = new Intl.DateTimeFormat('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Paris',
    }).format(Date.UTC(2026, 10, 3, 8, 0, 0));
    expect(display.formatInstant('2026-11-03T08:00:00.000Z', 'date-time')).toBe(expected);
  });
});
