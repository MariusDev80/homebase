import { ApplicationInitStatus } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Dialog } from 'primeng/dialog';
import { DASHBOARD_REPOSITORY, SETTINGS_REPOSITORY, WIDGET_INSTANCE_REPOSITORY } from '../../data';
import type { JsonObject } from '../../data';
import { DashboardListStore } from '../dashboard/dashboard-list.store';
import { CARD_TINTS } from '../dashboard/dashboard-theme';
import { DashboardThemeFlow } from '../dashboard/dashboard-theme-flow';
import { DashboardStore } from '../dashboard/dashboard.store';
import { provideAppI18n } from '../i18n';
import { FakeDashboardRepository } from '../testing/fake-dashboard.repository';
import { FakeSettingsRepository } from '../testing/fake-settings.repository';
import { FakeWidgetInstanceRepository } from '../testing/fake-widget-instance.repository';
import { DashboardThemeDialogComponent } from './dashboard-theme-dialog.component';

interface Seed {
  readonly name: string;
  readonly theme?: JsonObject;
  readonly themeVersion?: number;
}

describe('DashboardThemeDialogComponent', () => {
  let fixture: ComponentFixture<DashboardThemeDialogComponent>;
  let repository: FakeDashboardRepository;
  let list: DashboardListStore;
  let store: DashboardStore;
  let flow: DashboardThemeFlow;

  /** Opens the first seeded dashboard in the store and the flow, then renders the panel. */
  async function setup(seed: readonly Seed[] = [{ name: 'Accueil' }]) {
    repository = new FakeDashboardRepository();
    for (const item of seed) await repository.create(item);
    TestBed.configureTestingModule({
      imports: [DashboardThemeDialogComponent],
      providers: [
        provideAppI18n(),
        { provide: DASHBOARD_REPOSITORY, useValue: repository },
        { provide: SETTINGS_REPOSITORY, useValue: new FakeSettingsRepository() },
        { provide: WIDGET_INSTANCE_REPOSITORY, useValue: new FakeWidgetInstanceRepository() },
      ],
    });
    await TestBed.compileComponents();
    await TestBed.inject(ApplicationInitStatus).donePromise;
    list = TestBed.inject(DashboardListStore);
    store = TestBed.inject(DashboardStore);
    flow = TestBed.inject(DashboardThemeFlow);
    await list.load('Accueil');
    await store.open(repository.items[0]?.id ?? null, 'Accueil');
    flow.open();
    render();
    await fixture.whenStable();
  }

  function render(): void {
    fixture = TestBed.createComponent(DashboardThemeDialogComponent);
    fixture.detectChanges();
  }

  const q = <T extends HTMLElement>(testid: string): T | null =>
    document.querySelector<T>(`[data-testid="${testid}"]`);
  const radios = (slot: string): HTMLInputElement[] =>
    Array.from(
      document.querySelectorAll<HTMLInputElement>(`input[name="dashboard-theme-${slot}"]`),
    );
  const choice = (slot: string, tint: string): HTMLInputElement =>
    document.querySelector<HTMLInputElement>(
      `label[data-slot="${slot}"][data-tint="${tint}"] input`,
    ) as HTMLInputElement;
  const pick = (slot: string, tint: string): void => {
    choice(slot, tint).click();
    fixture.detectChanges();
  };
  const form = (): HTMLFormElement => document.querySelector('form') as HTMLFormElement;
  const submit = (): void => {
    form().dispatchEvent(new Event('submit', { cancelable: true }));
  };
  const press = (key: string): void => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  };
  const flush = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  /** Holds the next updateTheme until `release()`. */
  function gateWrite() {
    const real = repository.updateTheme.bind(repository);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = vi.spyOn(repository, 'updateTheme').mockImplementation(async (...args) => {
      await gate;
      return real(...args);
    });
    return { spy, release };
  }

  afterEach(() => {
    document.querySelectorAll('p-dialog, .p-dialog-mask').forEach((node) => node.remove());
    vi.restoreAllMocks();
  });

  describe('choices', () => {
    beforeEach(() => setup());

    it('has two fieldsets of 13 radios with their accessible names', () => {
      const groups = document.querySelectorAll('fieldset');
      expect(groups).toHaveLength(2);
      const names = (slot: string) =>
        radios(slot).map((r) => r.closest('label')?.textContent?.trim());
      const tints = [
        'Rose',
        'Pêche',
        'Vanille',
        'Anis',
        'Menthe',
        'Lagon',
        'Ciel',
        'Pervenche',
        'Lavande',
        'Orchidée',
        'Ardoise',
        'Sable',
      ];
      expect(names('cardBody')).toEqual(['Par défaut', ...tints]);
      expect(names('cardHeader')).toEqual(['Comme le fond', ...tints]);
      expect(tints).toHaveLength(CARD_TINTS.length);
    });

    it('keeps the value name out of the legend', () => {
      const legends = Array.from(document.querySelectorAll('legend')).map((l) => l.textContent);
      expect(legends).toEqual(['Fond des widgets', 'En-tête des widgets']);
      const note = document.querySelector('fieldset p[aria-hidden="true"]');
      expect(note?.textContent?.trim()).toBe('Par défaut');
    });

    it('the header default swatch shows the tint of the draft body', () => {
      const swatch = (): string =>
        (
          document.querySelector(
            'label[data-slot="cardHeader"][data-tint="default"]',
          ) as HTMLElement
        ).style.getPropertyValue('--hb-swatch-fill');
      expect(swatch()).toBe('var(--hb-bg)');
      pick('cardBody', 'rose');
      expect(swatch()).toBe('var(--hb-tint-rose-body)');
    });

    it('a change updates the preview and writes nothing', () => {
      const update = vi.spyOn(repository, 'updateTheme');
      pick('cardBody', 'rose');
      pick('cardHeader', 'sky');
      expect(flow.preview()).toEqual({ cardBody: 'rose', cardHeader: 'sky' });
      expect(update).not.toHaveBeenCalled();
      expect(flow.phase()).toBe('editing');
    });

    it('renders a mini preview on a card-theme div that contains the box', () => {
      pick('cardBody', 'rose');
      const scope = document.querySelector('[data-testid="dashboard-theme-preview"] .card-theme');
      expect(scope).not.toBeNull();
      expect(scope?.classList.contains('box')).toBe(false);
      expect(scope?.querySelector(':scope > section.box')).not.toBeNull();
      expect((scope as HTMLElement).style.getPropertyValue('--hb-card-body-bg')).toBe(
        'var(--hb-tint-rose-body)',
      );
    });

    it('configures the dialog: bottom left, clear mask, not closable', () => {
      const dialog = fixture.debugElement.query(By.directive(Dialog)).componentInstance as Dialog;
      expect(dialog.position).toBe('bottomleft');
      expect(dialog.maskStyleClass).toBe('dialog-mask-clear');
      expect(dialog.closable).toBe(false);
      expect(dialog.modal).toBe(true);
      expect(document.querySelector('.p-dialog-header')?.textContent).toContain(
        'Thème de « Accueil »',
      );
    });

    it('has a typed Cancel and a submit Save', () => {
      expect(q('dashboard-theme-cancel')?.getAttribute('type')).toBe('button');
      expect(q('dashboard-theme-save')?.getAttribute('type')).toBe('submit');
    });
  });

  describe('stored choice', () => {
    it('checks the stored choice and names it', async () => {
      await setup([{ name: 'Pro', theme: { cardBody: 'rose', cardHeader: 'sky' } }]);
      expect(choice('cardBody', 'rose').checked).toBe(true);
      expect(choice('cardHeader', 'sky').checked).toBe(true);
      expect(radios('cardBody').filter((r) => r.checked)).toHaveLength(1);
      expect(document.querySelectorAll('fieldset p[aria-hidden="true"]')[1]?.textContent).toContain(
        'Ciel',
      );
    });

    it('focuses the checked choice of the first group, else its first choice', async () => {
      await setup();
      expect(document.activeElement).toBe(choice('cardBody', 'default'));
      TestBed.resetTestingModule();
      document.querySelectorAll('p-dialog, .p-dialog-mask').forEach((node) => node.remove());
      await setup([{ name: 'Pro', theme: { cardBody: 'mint' } }]);
      await vi.waitFor(() => expect(document.activeElement).toBe(choice('cardBody', 'mint')));
    });
  });

  describe('unknown, invalid and future themes', () => {
    it('checks nothing for an unknown tint and keeps it on save of the other slot', async () => {
      await setup([{ name: 'Pro', theme: { cardBody: 'coral', cardHeader: 'sky' } }]);
      expect(radios('cardBody').some((r) => r.checked)).toBe(false);
      expect(q('dashboard-theme-unknown')).not.toBeNull();
      pick('cardHeader', 'mint');
      submit();
      await vi.waitFor(() => expect(flow.phase()).toBe('idle'));
      expect(repository.items[0]).toMatchObject({
        theme: { cardBody: 'coral', cardHeader: 'mint' },
        themeVersion: 1,
      });
    });

    it('shows a warning and the defaults for an unreadable theme', async () => {
      await setup([{ name: 'Pro', theme: { cardBody: 'Rose' } }]);
      expect(q('dashboard-theme-invalid')?.textContent).toContain('illisible');
      expect(choice('cardBody', 'default').checked).toBe(true);
      expect(choice('cardHeader', 'default').checked).toBe(true);
    });

    it('is read-only for a newer theme version: disabled radios, no Save, Close closes', async () => {
      await setup([{ name: 'Pro', theme: { cardBody: 'rose' }, themeVersion: 2 }]);
      expect(q('dashboard-theme-future')?.textContent).toContain('version plus récente');
      for (const fieldset of Array.from(document.querySelectorAll('fieldset'))) {
        expect(fieldset.disabled).toBe(true);
      }
      expect(q('dashboard-theme-save')).toBeNull();
      expect(q('dashboard-theme-cancel')).toBeNull();
      const close = q<HTMLButtonElement>('dashboard-theme-close');
      expect(close?.getAttribute('type')).toBe('button');
      await vi.waitFor(() => expect(document.activeElement).toBe(close));
      const update = vi.spyOn(repository, 'updateTheme');
      submit();
      close?.click();
      expect(flow.phase()).toBe('idle');
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe('save', () => {
    beforeEach(() => setup());

    it('writes once {cardBody, cardHeader} with version 1, even on a double submit, then closes', async () => {
      const id = repository.items[0]?.id as string;
      const { spy, release } = gateWrite();
      pick('cardBody', 'rose');
      pick('cardHeader', 'sky');
      submit();
      submit();
      await flush();
      expect(q<HTMLButtonElement>('dashboard-theme-save')?.disabled).toBe(true);
      expect(q<HTMLButtonElement>('dashboard-theme-cancel')?.disabled).toBe(true);
      release();
      await vi.waitFor(() => expect(flow.phase()).toBe('idle'));
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(id, { cardBody: 'rose', cardHeader: 'sky' }, 1);
      expect(list.dashboards()[0]?.theme).toEqual({ cardBody: 'rose', cardHeader: 'sky' });
      expect(flow.preview()).toBeNull();
    });

    it('shows a message on a write failure and stays open with the preview', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      repository.failNext(new Error('boom'));
      pick('cardBody', 'rose');
      submit();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(q('dashboard-theme-error')?.textContent).toContain("rien n'a été modifié");
      });
      expect(flow.phase()).toBe('editing');
      expect(flow.preview()).toEqual({ cardBody: 'rose', cardHeader: 'default' });
      expect(q<HTMLButtonElement>('dashboard-theme-save')?.disabled).toBe(false);
    });

    it('treats a refused serialization as a failed write', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const update = vi.spyOn(repository, 'updateTheme');
      // A stored value that the schema refuses cannot be reached by a click: force the draft.
      (fixture.componentInstance as unknown as { draft: { set(v: unknown): void } }).draft.set({
        cardBody: 'Not Valid',
        cardHeader: 'default',
      });
      submit();
      await flush();
      expect(q('dashboard-theme-error')).not.toBeNull();
      expect(update).not.toHaveBeenCalled();
      expect(flow.phase()).toBe('editing');
    });

    it('keeps a panel reopened on another dashboard open when an older write returns (C11)', async () => {
      await repository.create({ name: 'Pro' });
      await list.afterRemoval();
      const first = repository.items[0]?.id as string;
      const second = repository.items[1]?.id as string;
      const { spy, release } = gateWrite();
      pick('cardBody', 'rose');
      submit();
      await flush();
      expect(spy).toHaveBeenCalledWith(first, { cardBody: 'rose', cardHeader: 'default' }, 1);
      // Session change, then the panel is opened again on another dashboard.
      store.close();
      await store.open(second, 'Pro');
      expect(flow.phase()).toBe('idle');
      flow.open();
      expect(flow.dashboardId()).toBe(second);
      release();
      await vi.waitFor(() =>
        expect(repository.items[0]?.theme).toEqual({ cardBody: 'rose', cardHeader: 'default' }),
      );
      await flush();
      expect(flow.phase()).toBe('editing');
      expect(flow.dashboardId()).toBe(second);
    });
  });

  describe('cancel and Escape', () => {
    beforeEach(() => setup());

    it('Cancel closes without writing and drops the preview', () => {
      const update = vi.spyOn(repository, 'updateTheme');
      pick('cardBody', 'rose');
      q<HTMLButtonElement>('dashboard-theme-cancel')?.click();
      expect(flow.phase()).toBe('idle');
      expect(flow.preview()).toBeNull();
      expect(update).not.toHaveBeenCalled();
    });

    it('Escape closes without writing', () => {
      const update = vi.spyOn(repository, 'updateTheme');
      pick('cardBody', 'rose');
      press('Escape');
      expect(flow.phase()).toBe('idle');
      expect(flow.preview()).toBeNull();
      expect(update).not.toHaveBeenCalled();
    });

    it('Escape is ignored while the write runs', async () => {
      const { release } = gateWrite();
      pick('cardBody', 'rose');
      submit();
      await flush();
      press('Escape');
      expect(flow.phase()).toBe('editing');
      release();
      await vi.waitFor(() => expect(flow.phase()).toBe('idle'));
    });
  });

  describe('dashboard gone', () => {
    it('closes at once and writes nothing when the dashboard is not in the list', async () => {
      repository = new FakeDashboardRepository();
      await repository.create({ name: 'Accueil' });
      TestBed.configureTestingModule({
        imports: [DashboardThemeDialogComponent],
        providers: [
          provideAppI18n(),
          { provide: DASHBOARD_REPOSITORY, useValue: repository },
          { provide: SETTINGS_REPOSITORY, useValue: new FakeSettingsRepository() },
          { provide: WIDGET_INSTANCE_REPOSITORY, useValue: new FakeWidgetInstanceRepository() },
        ],
      });
      await TestBed.compileComponents();
      await TestBed.inject(ApplicationInitStatus).donePromise;
      list = TestBed.inject(DashboardListStore);
      store = TestBed.inject(DashboardStore);
      flow = TestBed.inject(DashboardThemeFlow);
      // The store knows the dashboard but the list does not (never loaded).
      await store.open(repository.items[0]?.id ?? null, 'Accueil');
      flow.open();
      expect(flow.phase()).toBe('editing');
      const update = vi.spyOn(repository, 'updateTheme');
      render();
      await vi.waitFor(() => expect(flow.phase()).toBe('idle'));
      expect(update).not.toHaveBeenCalled();
    });
  });
});
