import { ApplicationInitStatus, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideAppI18n } from '../../core/i18n';
import { WIDGET_CONTEXT, WidgetConfigError, serializeConfig } from '../../core/widgets';
import type { WidgetContext } from '../../core/widgets';
import { helloWidget } from './hello.definition';
import { HelloComponent } from './hello.component';
import type { HelloConfig } from './hello.config';

async function render() {
  const config = signal<HelloConfig>({ name: 'monde' });
  const updateConfig = vi.fn((next: HelloConfig): Promise<void> => {
    const result = serializeConfig(helloWidget.config, next);
    if (!result.ok) return Promise.reject(new WidgetConfigError(result.reason, result.issues));
    config.set(result.config);
    return Promise.resolve();
  });
  const ctx: WidgetContext<HelloConfig> = {
    instanceId: 'inst-1',
    type: 'hello',
    config,
    size: signal({ w: 3, h: 2 }),
    permissions: new Set(),
    updateConfig,
  };
  TestBed.configureTestingModule({
    providers: [provideAppI18n(), { provide: WIDGET_CONTEXT, useValue: ctx }],
  });
  await TestBed.inject(ApplicationInitStatus).donePromise;
  const fixture = TestBed.createComponent(HelloComponent);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const submit = async (value: string) => {
    const input = el.querySelector('[data-testid="hello-name"]') as HTMLInputElement;
    input.value = value;
    el.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
    fixture.detectChanges();
  };
  return { fixture, el, updateConfig, config, submit };
}

describe('HelloComponent', () => {
  it('shows the greeting with the configured name', async () => {
    const { el } = await render();
    expect(el.textContent).toContain('Bonjour, monde !');
  });

  it('saves a new name', async () => {
    const { el, updateConfig, submit } = await render();
    await submit('Alice');
    expect(updateConfig).toHaveBeenCalledWith({ name: 'Alice' });
    expect(el.textContent).toContain('Bonjour, Alice !');
    expect(el.querySelector('[data-testid="hello-error"]')).toBeNull();
  });

  it.each([
    ['empty', ''],
    ['41 characters', 'a'.repeat(41)],
  ])('shows an error and persists nothing for %s', async (_label, value) => {
    const { el, config, submit } = await render();
    await submit(value);
    expect(el.querySelector('[data-testid="hello-error"]')?.textContent).toContain(
      'Le nom doit contenir de 1 à 40 caractères.',
    );
    expect(config()).toEqual({ name: 'monde' });
  });
});
