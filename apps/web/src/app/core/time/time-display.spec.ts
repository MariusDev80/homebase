import { TestBed } from '@angular/core/testing';
import { ApplicationInitStatus } from '@angular/core';
import { SETTINGS_REPOSITORY } from '../../data';
import { provideAppI18n } from '../i18n';
import { FakeSettingsRepository } from '../testing/fake-settings.repository';
import { TimeDisplay } from './time-display';
import { TimeError } from './time-error';
import { SYSTEM_TIME_ZONE_READER, UserTimeZone } from './time-zone';

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

  it('formats a wall date without offset, even in a zone west of UTC', async () => {
    await TestBed.inject(UserTimeZone).setPreference('Pacific/Honolulu');
    expect(nbsp(display.formatLocalDate('2026-11-03', 'short'))).toBe('3 nov. 2026');
    expect(display.formatLocalDate('2026-11-03', 'long')).toBe('3 novembre 2026');
  });

  it('shows the new year in Paris for 2026-12-31T23:30Z', () => {
    const expected = new Intl.DateTimeFormat('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Paris',
    }).format(Date.UTC(2026, 11, 31, 23, 30, 0));
    const actual = display.formatInstant('2026-12-31T23:30:00.000Z', 'date-time', 'Europe/Paris');
    expect(actual).toBe(expected);
    expect(nbsp(actual)).toContain('1 janv. 2027');
    expect(actual).toContain('00:30');
  });

  it('rejects an unknown explicit zone with a TimeError', () => {
    expect(() => display.formatInstant('2026-11-03T08:00:00.000Z', 'time', 'Mars/Base')).toThrow(
      TimeError,
    );
    expect(display.formatInstant('2026-11-03T08:00:00.000Z', 'time', 'europe/paris')).toBe('09:00');
  });

  it('formats local dates in French, whatever the user zone', () => {
    expect(nbsp(display.formatLocalDate('2026-11-03', 'short'))).toBe('3 nov. 2026');
    expect(display.formatLocalDate('2026-11-03', 'long')).toBe('3 novembre 2026');
    expect(display.formatLocalDate('2026-11-03', 'weekday-long')).toBe('mardi 3 novembre 2026');
  });

  it('formats a short weekday and day number', () => {
    const expected = new Intl.DateTimeFormat('fr-FR', {
      weekday: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(Date.UTC(2026, 9, 23));
    expect(display.formatLocalDate('2026-10-23', 'weekday-short')).toBe(expected);
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
