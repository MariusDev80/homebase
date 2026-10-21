import { TestBed } from '@angular/core/testing';
import { CLOCK, SETTINGS_REPOSITORY } from '../../data';
import { FakeSettingsRepository } from '../testing/fake-settings.repository';
import { ManualClock } from './testing/manual-clock';
import { Today } from './today';
import { SYSTEM_TIME_ZONE_READER, UserTimeZone } from './time-zone';

describe('Today', () => {
  let clock: ManualClock;
  let repo: FakeSettingsRepository;

  function create(): Today {
    TestBed.configureTestingModule({
      providers: [
        { provide: CLOCK, useValue: clock },
        { provide: SETTINGS_REPOSITORY, useValue: repo },
        { provide: SYSTEM_TIME_ZONE_READER, useValue: () => 'Europe/Paris' },
      ],
    });
    return TestBed.inject(Today);
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    repo = new FakeSettingsRepository();
    clock = new ManualClock('2026-10-20T21:59:59.000Z'); // 23:59:59 in Paris (CEST)
  });
  afterEach(() => vi.useRealTimers());

  it('C21: changes at the next local midnight', () => {
    const today = create();
    expect(today.date()).toBe('2026-10-20');
    clock.set('2026-10-20T22:00:01.000Z'); // 00:00:01 on the 21st
    vi.advanceTimersByTime(1000);
    expect(today.date()).toBe('2026-10-21');
  });

  it('handles the 25 hour day (change at 2026-10-25T23:00:00Z)', () => {
    clock.set('2026-10-25T22:59:59.000Z'); // 23:59:59 CET on the 25th
    const today = create();
    expect(today.date()).toBe('2026-10-25');
    clock.set('2026-10-25T23:00:01.000Z');
    vi.advanceTimersByTime(1000);
    expect(today.date()).toBe('2026-10-26');
  });

  it('recomputes when the time zone changes', async () => {
    clock.set('2026-10-20T23:30:00.000Z');
    const today = create();
    expect(today.date()).toBe('2026-10-21');
    await TestBed.inject(UserTimeZone).setPreference('America/New_York');
    expect(today.date()).toBe('2026-10-20');
  });

  it('recomputes when the window becomes visible', () => {
    const today = create();
    expect(today.date()).toBe('2026-10-20');
    clock.set('2026-10-21T10:00:00.000Z');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(today.date()).toBe('2026-10-21');
  });
});
