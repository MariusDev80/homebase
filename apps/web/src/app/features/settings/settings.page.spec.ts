import { TestBed } from '@angular/core/testing';
import { ApplicationInitStatus } from '@angular/core';
import { provideAppI18n } from '../../core/i18n';
import { SPIKE_TOOLS_ENABLED, SystemService } from '../../core/system';
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
        { provide: SystemService, useValue: system },
        { provide: SPIKE_TOOLS_ENABLED, useValue: opts.spikeTools ?? true },
      ],
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
