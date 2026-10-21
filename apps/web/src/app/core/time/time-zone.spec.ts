import { TestBed } from '@angular/core/testing';
import { SETTINGS_REPOSITORY } from '../../data';
import { FakeSettingsRepository } from '../testing/fake-settings.repository';
import { TimeError } from './time-error';
import {
  SUPPORTED_TIME_ZONES_READER,
  SYSTEM_TIME_ZONE_READER,
  TIME_ZONE_SETTING_KEY,
  UserTimeZone,
} from './time-zone';

describe('UserTimeZone', () => {
  let repo: FakeSettingsRepository;
  let system: string;
  let supported: string[];

  function create(): UserTimeZone {
    TestBed.configureTestingModule({
      providers: [
        { provide: SETTINGS_REPOSITORY, useValue: repo },
        { provide: SYSTEM_TIME_ZONE_READER, useValue: () => system },
        { provide: SUPPORTED_TIME_ZONES_READER, useValue: () => supported },
      ],
    });
    return TestBed.inject(UserTimeZone);
  }

  beforeEach(() => {
    repo = new FakeSettingsRepository();
    system = 'Europe/Paris';
    supported = ['Europe/Paris', 'America/Montreal', 'Asia/Kolkata'];
  });

  it('follows the system when no setting is stored', async () => {
    const zone = create();
    await zone.load();
    expect(zone.id()).toBe('Europe/Paris');
    expect(zone.source()).toBe('system');
    expect(zone.preference()).toBeNull();
    expect(zone.invalidPreference()).toBeNull();
  });

  it('uses a valid stored setting', async () => {
    repo.values.set(TIME_ZONE_SETTING_KEY, 'America/Montreal');
    const zone = create();
    await zone.load();
    expect(zone.id()).toBe('America/Montreal');
    expect(zone.source()).toBe('setting');
    expect(zone.systemId()).toBe('Europe/Paris');
  });

  it('C19: ignores and reports invalid stored values', async () => {
    for (const bad of ['Mars/Base', '+02:00', 'Etc/Unknown']) {
      TestBed.resetTestingModule();
      repo = new FakeSettingsRepository();
      repo.values.set(TIME_ZONE_SETTING_KEY, bad);
      const zone = create();
      await zone.load();
      expect(zone.id(), bad).toBe('Europe/Paris');
      expect(zone.source()).toBe('system');
      expect(zone.invalidPreference()).toBe(bad);
    }
  });

  it('C20: an unknown Windows zone falls back to UTC', async () => {
    system = 'Etc/Unknown';
    const zone = create();
    await zone.load();
    expect(zone.id()).toBe('UTC');
    expect(zone.source()).toBe('fallback-utc');
    expect(zone.systemId()).toBe('UTC');
  });

  it('rejects an invalid zone without writing', async () => {
    const zone = create();
    await expect(zone.setPreference('Mars/Base')).rejects.toBeInstanceOf(TimeError);
    expect(repo.values.has(TIME_ZONE_SETTING_KEY)).toBe(false);
  });

  it('C38: stores the normalised identifier', async () => {
    const zone = create();
    await zone.setPreference('europe/paris');
    expect(repo.values.get(TIME_ZONE_SETTING_KEY)).toBe('Europe/Paris');
    expect(zone.preference()).toBe('Europe/Paris');
  });

  it('null removes the setting', async () => {
    repo.values.set(TIME_ZONE_SETTING_KEY, 'America/Montreal');
    const zone = create();
    await zone.load();
    const remove = vi.spyOn(repo, 'remove');
    await zone.setPreference(null);
    expect(remove).toHaveBeenCalledWith(TIME_ZONE_SETTING_KEY);
    expect(zone.source()).toBe('system');
  });

  it('refreshSystem re-reads the Windows zone', async () => {
    const zone = create();
    await zone.load();
    system = 'Asia/Kolkata';
    expect(zone.id()).toBe('Europe/Paris');
    zone.refreshSystem();
    expect(zone.id()).toBe('Asia/Kolkata');
  });

  it('follows Windows when the repository fails on load', async () => {
    repo.failGet = true;
    const zone = create();
    await expect(zone.load()).resolves.toBeUndefined();
    expect(zone.id()).toBe('Europe/Paris');
  });

  it('availableTimeZones adds UTC, the system zone and the preference without duplicates', async () => {
    supported = ['Europe/Paris', 'America/Montreal'];
    system = 'Asia/Kolkata';
    repo.values.set(TIME_ZONE_SETTING_KEY, 'Pacific/Auckland');
    const zone = create();
    await zone.load();
    const list = zone.availableTimeZones();
    expect(list).toContain('UTC');
    expect(list).toContain('Asia/Kolkata');
    expect(list).toContain('Pacific/Auckland');
    expect(list).toContain('Europe/Paris');
    expect(new Set(list).size).toBe(list.length);
    expect([...list].sort()).toEqual([...list]);
  });
});
