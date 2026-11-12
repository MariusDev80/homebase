import { ApplicationInitStatus, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideAppI18n } from '../../core/i18n';
import { UrlOpener } from '../../core/system';
import { FakeShortcutRepository } from '../../core/testing/fake-shortcut.repository';
import { WIDGET_CONTEXT } from '../../core/widgets';
import type { WidgetContext } from '../../core/widgets';
import { DataError, SHORTCUT_REPOSITORY } from '../../data';
import { ShortcutsComponent } from './shortcuts.component';
import type { ShortcutsConfig } from './shortcuts.config';

async function render(repo = new FakeShortcutRepository()) {
  const open = vi.fn<(ctx: unknown, url: string) => Promise<void>>(() => Promise.resolve());
  const ctx: WidgetContext<ShortcutsConfig> = {
    instanceId: 'inst-1',
    type: 'shortcuts',
    config: signal({}),
    size: signal({ w: 3, h: 3 }),
    permissions: new Set(['open-url']),
    updateConfig: () => Promise.resolve(),
  };
  TestBed.configureTestingModule({
    providers: [
      provideAppI18n(),
      { provide: WIDGET_CONTEXT, useValue: ctx },
      { provide: SHORTCUT_REPOSITORY, useValue: repo },
      { provide: UrlOpener, useValue: { open } },
    ],
  });
  await TestBed.inject(ApplicationInitStatus).donePromise;
  const fixture = TestBed.createComponent(ShortcutsComponent);
  const settle = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
  };
  await settle();
  const el = fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement>(id: string) =>
    el.querySelector(`[data-testid="${id}"]`) as T | null;
  const all = (id: string) => Array.from(el.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`));
  const click = async (target: HTMLElement | null) => {
    if (!target) throw new Error('element not found');
    target.click();
    await settle();
  };
  const fill = (id: string, value: string) => {
    const input = q<HTMLInputElement>(id);
    if (!input) throw new Error(`${id} not rendered`);
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  const submit = async () => {
    q('shortcuts-form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
  };
  const labels = () =>
    all('shortcut-row').map((r) => r.querySelector('.truncate')?.textContent?.trim());
  return { repo, open, el, settle, q, all, click, fill, submit, labels };
}

function seeded() {
  const repo = new FakeShortcutRepository();
  repo.seed('GitHub', 'https://github.com/');
  repo.seed('Docs', 'https://docs.example.com/a');
  repo.seed('Wiki', 'http://wiki.example.org/');
  return repo;
}

describe('ShortcutsComponent', () => {
  it('shows an empty state without shortcuts', async () => {
    const { q } = await render();
    expect(q('shortcuts-empty')).not.toBeNull();
  });

  it('lists label, domain and initial in order', async () => {
    const { all, labels } = await render(seeded());
    expect(labels()).toEqual(['GitHub', 'Docs', 'Wiki']);
    const first = all('shortcut-open')[0];
    expect(first.textContent).toContain('github.com');
    expect(first.textContent).toContain('G');
  });

  it('opens the URL through UrlOpener on click', async () => {
    const { all, open, click } = await render(seeded());
    await click(all('shortcut-open')[1]);
    expect(open).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ type: 'shortcuts' }),
      'https://docs.example.com/a',
    );
  });

  it('shows an error when opening fails', async () => {
    const { all, open, click, q } = await render(seeded());
    open.mockRejectedValueOnce(new Error('refused'));
    await click(all('shortcut-open')[0]);
    expect(q('shortcuts-action-error')).not.toBeNull();
  });

  it('adds a valid shortcut', async () => {
    const { repo, click, q, fill, submit, labels } = await render();
    await click(q('shortcuts-manage'));
    await click(q('shortcuts-add'));
    fill('shortcuts-label', '  Mail ');
    fill('shortcuts-url', 'https://mail.example.com');
    await submit();
    expect(repo.items.map((s) => [s.label, s.url])).toEqual([
      ['Mail', 'https://mail.example.com/'],
    ]);
    expect(q('shortcuts-form')).toBeNull();
    expect(labels()).toEqual(['Mail']);
  });

  it.each([
    ['javascript:alert(1)', 'http et https'],
    ['file:///C:/x', 'http et https'],
    ['https://user:pw@example.com', 'identifiants'],
    ['pas une url', 'Adresse invalide'],
  ])('refuses the URL %s', async (url, message) => {
    const { repo, click, q, fill, submit } = await render();
    await click(q('shortcuts-manage'));
    await click(q('shortcuts-add'));
    fill('shortcuts-label', 'X');
    fill('shortcuts-url', url);
    await submit();
    expect(q('shortcuts-url-error')?.textContent).toContain(message);
    expect(repo.items).toEqual([]);
    expect(q('shortcuts-form')).not.toBeNull();
  });

  it('refuses an empty label', async () => {
    const { repo, click, q, fill, submit } = await render();
    await click(q('shortcuts-manage'));
    await click(q('shortcuts-add'));
    fill('shortcuts-label', '   ');
    fill('shortcuts-url', 'https://a.example');
    await submit();
    expect(q('shortcuts-label-error')).not.toBeNull();
    expect(repo.items).toEqual([]);
  });

  it('edits a shortcut', async () => {
    const { repo, click, q, all, fill, submit, labels } = await render(seeded());
    await click(q('shortcuts-manage'));
    await click(all('shortcut-edit')[0]);
    expect(q<HTMLInputElement>('shortcuts-label')?.value).toBe('GitHub');
    fill('shortcuts-label', 'Git');
    await submit();
    expect(repo.items[0].label).toBe('Git');
    expect(labels()[0]).toBe('Git');
  });

  it('moves shortcuts up and down, with the ends disabled', async () => {
    const { repo, click, q, all, labels } = await render(seeded());
    await click(q('shortcuts-manage'));
    expect((all('shortcut-up')[0] as HTMLButtonElement).disabled).toBe(true);
    expect((all('shortcut-down')[2] as HTMLButtonElement).disabled).toBe(true);
    await click(all('shortcut-down')[0]);
    expect(labels()).toEqual(['Docs', 'GitHub', 'Wiki']);
    await click(all('shortcut-up')[2]);
    expect(labels()).toEqual(['Docs', 'Wiki', 'GitHub']);
    expect((await repo.list()).map((s) => s.label)).toEqual(['Docs', 'Wiki', 'GitHub']);
  });

  it('removes only after confirmation, and cancel keeps it', async () => {
    const { repo, click, q, all, labels } = await render(seeded());
    await click(q('shortcuts-manage'));
    await click(all('shortcut-remove')[1]);
    expect(q('shortcut-confirm')?.textContent).toContain('Docs');
    await click(q('shortcut-confirm-no'));
    expect(repo.items).toHaveLength(3);
    await click(all('shortcut-remove')[1]);
    await click(q('shortcut-confirm-yes'));
    expect(labels()).toEqual(['GitHub', 'Wiki']);
    expect(repo.items).toHaveLength(2);
  });

  it('shows an action error when a write fails', async () => {
    const { repo, click, q, all } = await render(seeded());
    await click(q('shortcuts-manage'));
    await click(all('shortcut-remove')[0]);
    repo.failNext(new DataError('busy', 'busy'));
    await click(q('shortcut-confirm-yes'));
    expect(q('shortcuts-action-error')).not.toBeNull();
  });

  it('shows a load error with retry', async () => {
    const repo = seeded();
    repo.failNext(new DataError('unavailable', 'down'));
    const { q, click, labels } = await render(repo);
    expect(q('shortcuts-load-error')).not.toBeNull();
    await click(q('shortcuts-retry'));
    expect(labels()).toHaveLength(3);
  });

  it('ignores a second submit while the first one is in flight', async () => {
    const { repo, click, q, fill, settle } = await render();
    const create = vi.spyOn(repo, 'create');
    await click(q('shortcuts-manage'));
    await click(q('shortcuts-add'));
    fill('shortcuts-label', 'Mail');
    fill('shortcuts-url', 'https://mail.example.com');
    const form = q('shortcuts-form');
    form?.dispatchEvent(new Event('submit', { cancelable: true }));
    form?.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('ignores a second move while the first one is in flight', async () => {
    const { repo, click, q, all, settle } = await render(seeded());
    const reorder = vi.spyOn(repo, 'reorder');
    await click(q('shortcuts-manage'));
    const down = all('shortcut-down')[0];
    down.click();
    down.click();
    await settle();
    expect(reorder).toHaveBeenCalledTimes(1);
  });

  it('links invalid fields to their error message', async () => {
    const { click, q, fill, submit } = await render();
    await click(q('shortcuts-manage'));
    await click(q('shortcuts-add'));
    fill('shortcuts-label', '');
    fill('shortcuts-url', 'nope');
    await submit();
    for (const [field, error] of [
      ['shortcuts-label', 'shortcuts-label-error'],
      ['shortcuts-url', 'shortcuts-url-error'],
    ]) {
      const id = q(error)?.id;
      expect(id).toBeTruthy();
      expect(q(field)?.getAttribute('aria-describedby')).toBe(id);
    }
  });

  describe('focus management', () => {
    const active = () => document.activeElement?.getAttribute('data-testid');

    it('focuses the cancel button of the confirmation, then the trash button on cancel', async () => {
      const { click, q, all } = await render(seeded());
      await click(q('shortcuts-manage'));
      const trash = all('shortcut-remove')[1];
      await click(trash);
      expect(active()).toBe('shortcut-confirm-no');
      await click(q('shortcut-confirm-no'));
      expect(document.activeElement).toBe(all('shortcut-remove')[1]);
    });

    it('focuses the delete button of the next row after a deletion, the add button when empty', async () => {
      const { click, q, all, el } = await render(seeded());
      await click(q('shortcuts-manage'));
      await click(all('shortcut-remove')[0]);
      await click(q('shortcut-confirm-yes'));
      const rows = Array.from(el.querySelectorAll('[data-testid="shortcut-row"]'));
      expect(document.activeElement).toBe(rows[0].querySelector('[data-testid="shortcut-remove"]'));
      for (let i = 0; i < 2; i++) {
        await click(all('shortcut-remove')[0]);
        await click(q('shortcut-confirm-yes'));
      }
      expect(active()).toBe('shortcuts-add');
    });

    it('keeps the focus on the moved item and switches direction at the list ends', async () => {
      const { click, q, all, el } = await render(seeded());
      await click(q('shortcuts-manage'));
      const rowOf = (label: string) =>
        Array.from(el.querySelectorAll('[data-testid="shortcut-row"]')).find((r) =>
          r.textContent?.includes(label),
        ) as HTMLElement;
      await click(all('shortcut-down')[0]);
      expect(document.activeElement).toBe(
        rowOf('GitHub').querySelector('[data-testid="shortcut-down"]'),
      );
      await click(rowOf('GitHub').querySelector('[data-testid="shortcut-down"]'));
      // GitHub is now last: its down button is disabled, the focus goes to the up button.
      expect(document.activeElement).toBe(
        rowOf('GitHub').querySelector('[data-testid="shortcut-up"]'),
      );
    });

    it('returns the focus to the opener control after cancelling or saving a form', async () => {
      const { click, q, all, fill, submit } = await render(seeded());
      await click(q('shortcuts-manage'));
      await click(all('shortcut-edit')[1]);
      expect(active()).toBe('shortcuts-label');
      await click(q('shortcuts-cancel'));
      expect(document.activeElement).toBe(all('shortcut-edit')[1]);
      await click(q('shortcuts-add'));
      await click(q('shortcuts-cancel'));
      expect(active()).toBe('shortcuts-add');
      await click(all('shortcut-edit')[0]);
      fill('shortcuts-label', 'Git');
      await submit();
      expect(document.activeElement).toBe(all('shortcut-edit')[0]);
    });
  });
});
