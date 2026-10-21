import { TestBed } from '@angular/core/testing';
import { ApplicationInitStatus } from '@angular/core';
import { SETTINGS_REPOSITORY } from '../../data';
import { provideAppI18n } from '../../core/i18n';
import { SYSTEM_TIME_ZONE_READER, SUPPORTED_TIME_ZONES_READER } from '../../core/time';
import { FakeSettingsRepository } from '../../core/testing/fake-settings.repository';
import { SPIKE_TOOLS_ENABLED, SystemService } from '../../core/system';
import { UserTimeZone } from '../../core/time';
import { SettingsPage } from './settings.page';

describe('SettingsPage system section', () => {
  function setup(opts: { available: boolean; autostart?: boolean; spikeTools?: boolean }) {
    const system = {
      isAvailable: vi.fn().mockReturnValue(opts.available),
      getAutostart: vi.fn().mockResolvedValue(opts.autostart ?? false),
      setAutostart: vi.fn().mockResolvedValue(undefined),
      scheduleTestNotification: vi.fn().mockResolvedValue(undefined),
    };
    TestBed.configureTestingModule({
      providers: [
        provideAppI18n(),
        { provide: SETTINGS_REPOSITORY, useValue: new FakeSettingsRepository() },
        { provide: SYSTEM_TIME_ZONE_READER, useValue: () => 'Europe/Paris' },
        { provide: SystemService, useValue: system },
        { provide: SPIKE_TOOLS_ENABLED, useValue: opts.spikeTools ?? true },
      ],
    });
    return system;
  }

  async function render() {
    await TestBed.inject(ApplicationInitStatus).donePromise;
    await TestBed.inject(ApplicationInitStatus).donePromise;
    const fixture = TestBed.createComponent(SettingsPage);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('calls the service when the test notification button is clicked', async () => {
    const system = setup({ available: true });
    const fixture = await render();
    const button = fixture.nativeElement.querySelector(
      '[data-testid="test-notification"]',
    ) as HTMLButtonElement;
    button.click();
    expect(system.scheduleTestNotification).toHaveBeenCalledWith(10);
  });

  it('hides the test notification button when spike tools are disabled (release)', async () => {
    setup({ available: true, spikeTools: false });
    const fixture = await render();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="test-notification"]')).toBeNull();
    expect(el.querySelector('[data-testid="autostart-toggle"]')).not.toBeNull();
  });

  it('reflects the autostart state on load', async () => {
    setup({ available: true, autostart: true });
    const fixture = await render();
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="autostart-toggle"]',
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });

  it('updates autostart when toggled', async () => {
    const system = setup({ available: true, autostart: false });
    const fixture = await render();
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="autostart-toggle"]',
    ) as HTMLInputElement;
    toggle.click();
    await fixture.whenStable();
    expect(system.setAutostart).toHaveBeenCalledWith(true);
  });

  it('disables controls outside Tauri', async () => {
    const system = setup({ available: false });
    const fixture = await render();
    const button = fixture.nativeElement.querySelector(
      '[data-testid="test-notification"]',
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(system.getAutostart).not.toHaveBeenCalled();
  });
});

describe('SettingsPage time zone section', () => {
  let repo: FakeSettingsRepository;

  async function render(system = 'Europe/Paris') {
    TestBed.configureTestingModule({
      providers: [
        provideAppI18n(),
        { provide: SETTINGS_REPOSITORY, useValue: repo },
        { provide: SYSTEM_TIME_ZONE_READER, useValue: () => system },
        {
          provide: SUPPORTED_TIME_ZONES_READER,
          useValue: () => ['Europe/Paris', 'America/Montreal'],
        },
        {
          provide: SystemService,
          useValue: {
            isAvailable: () => false,
            getAutostart: vi.fn(),
            setAutostart: vi.fn(),
            scheduleTestNotification: vi.fn(),
          },
        },
      ],
    });
    await TestBed.inject(ApplicationInitStatus).donePromise;
    await TestBed.inject(UserTimeZone).load();
    await TestBed.inject(ApplicationInitStatus).donePromise;
    const fixture = TestBed.createComponent(SettingsPage);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    repo = new FakeSettingsRepository();
  });

  it('shows the effective zone', async () => {
    const fixture = await render();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="timezone-effective"]')?.textContent).toContain(
      'Fuseau utilisé : Europe/Paris',
    );
    expect(el.querySelector('[data-testid="timezone-invalid"]')).toBeNull();
  });

  it('stores the selected zone, then removes it when following Windows', async () => {
    const fixture = await render();
    const select = fixture.nativeElement.querySelector(
      '[data-testid="timezone-select"]',
    ) as HTMLSelectElement;
    select.value = 'America/Montreal';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(repo.values.get('time.zone')).toBe('America/Montreal');
    select.value = '';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(repo.values.has('time.zone')).toBe(false);
  });

  it('alerts when the stored value is invalid', async () => {
    repo.values.set('time.zone', 'Mars/Base');
    const fixture = await render();
    const alert = fixture.nativeElement.querySelector('[data-testid="timezone-invalid"]');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent).toContain('Mars/Base');
  });

  it('alerts when the Windows zone is not recognised', async () => {
    const fixture = await render('Etc/Unknown');
    expect(fixture.nativeElement.querySelector('[data-testid="timezone-fallback"]')).not.toBeNull();
  });
});
