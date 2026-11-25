import {
  APP_INITIALIZER,
  ɵINJECTOR_SCOPE as INJECTOR_SCOPE,
  EnvironmentInjector,
  createEnvironmentInjector,
  runInInjectionContext,
} from '@angular/core';
import { NOTE_REPOSITORY, SHORTCUT_REPOSITORY, TODO_REPOSITORY } from './content.tokens';
import { provideDataLayer } from './data.providers';

// Outside Tauri: the real wiring (tokens -> guarded executor) must fail with `unavailable`.
vi.mock('../tauri-runtime', () => ({ isTauriRuntime: () => false }));

async function createInjector(): Promise<EnvironmentInjector> {
  const injector = createEnvironmentInjector(
    [{ provide: INJECTOR_SCOPE, useValue: 'root' }, provideDataLayer()],
    // Root-less parent; INJECTOR_SCOPE makes the injector resolve `providedIn: 'root'` tokens.
    undefined as unknown as EnvironmentInjector,
  );
  // provideAppInitializer registers the bootstrap under APP_INITIALIZER: run it as the app would.
  for (const init of injector.get(APP_INITIALIZER, [])) {
    await runInInjectionContext(injector, init);
  }
  return injector;
}

describe('content repository tokens (real wiring, outside Tauri)', () => {
  it('rejects todo reads with unavailable', async () => {
    const injector = await createInjector();
    await expect(injector.get(TODO_REPOSITORY).listTodos('x')).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });

  it('rejects note reads with unavailable', async () => {
    const injector = await createInjector();
    await expect(injector.get(NOTE_REPOSITORY).get('x')).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });

  it('rejects shortcut reads with unavailable', async () => {
    const injector = await createInjector();
    await expect(injector.get(SHORTCUT_REPOSITORY).list()).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });

  it('returns the same instance on every inject', async () => {
    const injector = await createInjector();
    expect(injector.get(TODO_REPOSITORY)).toBe(injector.get(TODO_REPOSITORY));
    expect(injector.get(NOTE_REPOSITORY)).toBe(injector.get(NOTE_REPOSITORY));
    expect(injector.get(SHORTCUT_REPOSITORY)).toBe(injector.get(SHORTCUT_REPOSITORY));
  });
});
