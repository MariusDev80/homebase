import { TestBed } from '@angular/core/testing';
import { ApplicationInitStatus } from '@angular/core';
import { provideAppI18n } from '../../core/i18n';
import { SystemService } from '../../core/system';
import { SettingsPage } from './settings.page';

describe('SettingsPage system section', () => {
  function setup(opts: { available: boolean; autostart?: boolean }) {
    const system = {
      isAvailable: vi.fn().mockReturnValue(opts.available),
      getAutostart: vi.fn().mockResolvedValue(opts.autostart ?? false),
      setAutostart: vi.fn().mockResolvedValue(undefined),
      scheduleTestNotification: vi.fn().mockResolvedValue(undefined),
    };
    TestBed.configureTestingModule({
      providers: [provideAppI18n(), { provide: SystemService, useValue: system }],
    });
    return system;
  }

  async function render() {
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
