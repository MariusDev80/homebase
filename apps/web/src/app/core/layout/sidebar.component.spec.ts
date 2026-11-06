import { ApplicationInitStatus } from '@angular/core';
import { ComponentFixture, DeferBlockBehavior, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { DASHBOARD_REPOSITORY, SETTINGS_REPOSITORY, WIDGET_INSTANCE_REPOSITORY } from '../../data';
import { DashboardListStore, MAX_DASHBOARDS } from '../dashboard/dashboard-list.store';
import { DashboardStore } from '../dashboard/dashboard.store';
import { WidgetAddFlow } from '../dashboard/widget-add-flow';
import { fixtureDefinition } from '../testing/fixture-definitions';
import type { WidgetDefinition } from '../widgets/widget-definition';
import { provideWidget } from '../widgets/widget-registry';
import { provideAppI18n } from '../i18n';
import { FakeDashboardRepository } from '../testing/fake-dashboard.repository';
import { FakeSettingsRepository } from '../testing/fake-settings.repository';
import { FakeWidgetInstanceRepository } from '../testing/fake-widget-instance.repository';
import { DashboardDeleteDialogComponent } from './dashboard-delete-dialog.component';
import { SidebarComponent } from './sidebar.component';

function rect(top: number, height = 40, left = 8): DOMRect {
  return {
    top,
    bottom: top + height,
    left,
    right: left + 40,
    width: 40,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

describe('SidebarComponent', () => {
  let fixture: ComponentFixture<SidebarComponent>;
  let el: HTMLElement;
  let repository: FakeDashboardRepository;
  let list: DashboardListStore;

  async function setup(
    seed: readonly { name: string; icon?: string }[] = [{ name: 'Accueil' }],
    definitions: readonly WidgetDefinition[] = [],
  ) {
    repository = new FakeDashboardRepository();
    for (const item of seed) await repository.create(item);
    TestBed.configureTestingModule({
      imports: [SidebarComponent],
      deferBlockBehavior: DeferBlockBehavior.Playthrough,
      providers: [
        provideAppI18n(),
        ...definitions.map((d) => provideWidget(d)),
        provideRouter([{ path: '**', children: [] }]),
        { provide: DASHBOARD_REPOSITORY, useValue: repository },
        { provide: SETTINGS_REPOSITORY, useValue: new FakeSettingsRepository() },
        { provide: WIDGET_INSTANCE_REPOSITORY, useValue: new FakeWidgetInstanceRepository() },
      ],
    });
    await TestBed.compileComponents();
    await TestBed.inject(ApplicationInitStatus).donePromise;
    list = TestBed.inject(DashboardListStore);
    await list.load('Accueil');
    fixture = TestBed.createComponent(SidebarComponent);
    await fixture.whenStable();
    el = fixture.nativeElement as HTMLElement;
  }

  const bubbles = (): HTMLAnchorElement[] =>
    Array.from(el.querySelectorAll<HTMLAnchorElement>('[data-dashboard-id]'));
  const settings = (): HTMLAnchorElement =>
    el.querySelector<HTMLAnchorElement>('[data-testid="sidebar-settings"]') as HTMLAnchorElement;
  const addButton = (): HTMLButtonElement =>
    el.querySelector<HTMLButtonElement>(
      '[data-testid="sidebar-add-dashboard"]',
    ) as HTMLButtonElement;
  const label = (): HTMLElement | null => el.querySelector<HTMLElement>('.sidebar-label');
  const menu = (): HTMLElement | null => el.querySelector<HTMLElement>('[role="menu"]');
  const menuItems = (): HTMLButtonElement[] =>
    Array.from(el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
  const flush = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>('.p-dialog');

  afterEach(() => {
    // Dialogs are appended to the body.
    document.querySelectorAll('p-dialog, .p-dialog-mask').forEach((node) => node.remove());
  });

  describe('bubbles', () => {
    beforeEach(() => setup([{ name: 'Accueil' }, { name: 'Pro', icon: 'briefcase' }]));

    it('is a nav of named links, without menubar role', () => {
      expect(el.querySelector('nav')?.getAttribute('aria-label')).toBe('Navigation principale');
      expect(el.querySelector('[role="menubar"]')).toBeNull();
      expect(settings().getAttribute('aria-label')).toBe('Réglages');
      expect(settings().getAttribute('href')).toBe('/settings');
      expect(el.querySelector('[data-testid="sidebar-dashboard"][href="/"]')).toBeNull();
    });

    it('has one bubble per dashboard, in sort order, with the icon of the closed list', () => {
      expect(bubbles().map((b) => b.getAttribute('aria-label'))).toEqual(['Accueil', 'Pro']);
      expect(bubbles().map((b) => b.getAttribute('href'))).toEqual([
        `/dashboards/${repository.items[0]?.id}`,
        `/dashboards/${repository.items[1]?.id}`,
      ]);
      expect(bubbles().map((b) => b.querySelector('i')?.className)).toEqual([
        'pi pi-th-large',
        'pi pi-briefcase',
      ]);
      expect(bubbles()[0]?.getAttribute('aria-describedby')).toBe('sidebar-bubble-hint');
      expect(el.querySelector('#sidebar-bubble-hint')?.textContent).toContain('Maj + F10');
    });

    it('follows the order of sort_order, not the one of the list', async () => {
      const [first, second] = repository.items;
      if (!first || !second) throw new Error('seed');
      repository.items[0] = { ...first, sortOrder: 5 };
      repository.items[1] = { ...second, sortOrder: 1 };
      await list.afterRemoval();
      await flush();
      expect(bubbles().map((b) => b.getAttribute('aria-label'))).toEqual(['Pro', 'Accueil']);
    });

    it('shows the default icon for an unknown stored icon, without rewriting it', async () => {
      const first = repository.items[0];
      if (!first) throw new Error('seed');
      repository.items[0] = { ...first, icon: 'unknown-icon' };
      await list.afterRemoval();
      await flush();
      expect(bubbles()[0]?.querySelector('i')?.className).toBe('pi pi-th-large');
      expect(repository.items[0]?.icon).toBe('unknown-icon');
    });

    it('marks the open dashboard with aria-current, not the others', async () => {
      const id = repository.items[1]?.id;
      await TestBed.inject(Router).navigateByUrl(`/dashboards/${id}`);
      await flush();
      expect(bubbles()[1]?.getAttribute('aria-current')).toBe('page');
      expect(bubbles()[0]?.hasAttribute('aria-current')).toBe(false);
      expect(settings().hasAttribute('aria-current')).toBe(false);
    });

    it('marks the settings bubble with aria-current', async () => {
      await TestBed.inject(Router).navigateByUrl('/settings');
      await flush();
      expect(settings().getAttribute('aria-current')).toBe('page');
      expect(bubbles().some((b) => b.hasAttribute('aria-current'))).toBe(false);
    });

    it('shows the dashboard name in the text bubble on mouseenter, removes it on mouseleave', async () => {
      const a = bubbles()[1] as HTMLAnchorElement;
      vi.spyOn(a, 'getBoundingClientRect').mockReturnValue(rect(100));
      a.dispatchEvent(new Event('mouseenter'));
      await flush();
      const l = label();
      expect(l?.getAttribute('aria-hidden')).toBe('true');
      expect(l?.querySelector('span')?.textContent).toBe('Pro');
      expect(l?.style.top).toBe('104px');
      expect(l?.style.left).toBe('56px');

      a.dispatchEvent(new Event('mouseleave'));
      await flush();
      expect(label()).toBeNull();
    });

    it.each([
      [true, true],
      [false, false],
    ])('focusin with :focus-visible=%s shows the label: %s', async (visible, shown) => {
      const a = bubbles()[0] as HTMLAnchorElement;
      vi.spyOn(a, 'matches').mockImplementation((selector: string) =>
        selector === ':focus-visible' ? visible : false,
      );
      a.dispatchEvent(new Event('focusin'));
      await flush();
      expect(label() !== null).toBe(shown);
      if (shown) {
        a.dispatchEvent(new Event('focusout'));
        await flush();
        expect(label()).toBeNull();
      }
    });

    it('removes the label on Escape', async () => {
      settings().dispatchEvent(new Event('mouseenter'));
      await flush();
      expect(label()).not.toBeNull();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await flush();
      expect(label()).toBeNull();
    });

    it('repositions the label on list scroll and removes it when the anchor leaves the area', async () => {
      const a = bubbles()[0] as HTMLAnchorElement;
      const area = el.querySelector<HTMLElement>('ul.sidebar-group-scroll') as HTMLElement;
      const anchorRect = vi.spyOn(a, 'getBoundingClientRect').mockReturnValue(rect(100));
      vi.spyOn(area, 'getBoundingClientRect').mockReturnValue(rect(50, 300));
      a.dispatchEvent(new Event('mouseenter'));
      await flush();
      expect(label()?.style.top).toBe('104px');

      anchorRect.mockReturnValue(rect(70));
      area.dispatchEvent(new Event('scroll'));
      await flush();
      expect(label()?.style.top).toBe('74px');

      anchorRect.mockReturnValue(rect(-20));
      area.dispatchEvent(new Event('scroll'));
      await flush();
      expect(label()).toBeNull();
    });

    it('has a neutral add button under the dashboard bubbles', () => {
      const group = el.querySelector('ul.sidebar-group-scroll') as HTMLElement;
      expect(group.contains(addButton())).toBe(false);
      expect(addButton().getAttribute('aria-label')).toBe('Nouveau tableau de bord');
      expect(addButton().className).not.toContain('sidebar-bubble-add');
      expect(addButton().hasAttribute('aria-disabled')).toBe(false);
      expect(
        group.compareDocumentPosition(addButton()) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('puts the green widget + above Settings at the bottom, after the neutral + and the spacer', () => {
      const green = el.querySelector('[data-testid="add-widget"]') as HTMLElement;
      const follows = (a: Element, b: Element): boolean =>
        !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      const spacer = el.querySelector('.sidebar-spacer') as HTMLElement;
      expect(follows(addButton(), spacer)).toBe(true);
      expect(follows(spacer, green)).toBe(true);
      expect(follows(green, settings())).toBe(true);
      const bottom = green.closest('ul') as HTMLElement;
      expect(bottom.contains(settings())).toBe(true);
      expect(bottom.contains(addButton())).toBe(false);
      expect(bottom.lastElementChild?.contains(settings())).toBe(true);
    });

    it('announces the dashboard shown at each change but the first one', async () => {
      const store = TestBed.inject(DashboardStore);
      const status = (): string | null | undefined =>
        el.querySelector('[data-testid="sidebar-status"]')?.textContent;
      expect(el.querySelector('[data-testid="sidebar-status"]')?.getAttribute('role')).toBe(
        'status',
      );
      await store.open(repository.items[0]?.id ?? null, 'Accueil');
      await flush();
      expect(status()).toBe('');
      await store.open(repository.items[1]?.id ?? null, 'Accueil');
      await flush();
      expect(status()).toBe('Tableau affiché : Pro');
    });
  });

  describe('context menu', () => {
    let navigate: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
      await setup([{ name: 'Accueil' }, { name: 'Pro' }]);
      navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');
    });

    const rightClick = async (bubble: HTMLElement): Promise<Event> => {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      bubble.dispatchEvent(event);
      await flush();
      return event;
    };

    it('opens on contextmenu without navigating, with the first item focused', async () => {
      const bubble = bubbles()[1] as HTMLElement;
      vi.spyOn(bubble, 'getBoundingClientRect').mockReturnValue(rect(100));
      const event = await rightClick(bubble);
      expect(event.defaultPrevented).toBe(true);
      expect(navigate).not.toHaveBeenCalled();
      const m = menu();
      expect(m).not.toBeNull();
      expect(m?.getAttribute('aria-label')).toBe('Actions du tableau Pro');
      expect(m?.style.left).toBe('56px');
      expect(m?.style.top).toBe('100px');
      expect(menuItems().every((i) => i.getAttribute('tabindex') === '-1')).toBe(true);
      expect(document.activeElement).toBe(menuItems()[0]);
    });

    it.each([
      ['ContextMenu', false],
      ['F10', true],
    ])('opens on %s (shift: %s) from the keyboard', async (key, shiftKey) => {
      const bubble = bubbles()[0] as HTMLElement;
      const event = new KeyboardEvent('keydown', {
        key,
        shiftKey,
        bubbles: true,
        cancelable: true,
      });
      bubble.dispatchEvent(event);
      await flush();
      expect(event.defaultPrevented).toBe(true);
      expect(menu()).not.toBeNull();
      expect(navigate).not.toHaveBeenCalled();
    });

    it('ignores F10 without Shift', async () => {
      const bubble = bubbles()[0] as HTMLElement;
      bubble.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', bubbles: true }));
      await flush();
      expect(menu()).toBeNull();
    });

    it('stays open and prevents the native menu on a second contextmenu', async () => {
      const bubble = bubbles()[0] as HTMLElement;
      await rightClick(bubble);
      const second = await rightClick(bubble);
      expect(second.defaultPrevented).toBe(true);
      expect(el.querySelectorAll('[role="menu"]')).toHaveLength(1);
      const inside = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      menu()?.dispatchEvent(inside);
      expect(inside.defaultPrevented).toBe(true);
    });

    it('keeps the menu inside the window at the bottom', async () => {
      const bubble = bubbles()[0] as HTMLElement;
      vi.spyOn(bubble, 'getBoundingClientRect').mockReturnValue(rect(window.innerHeight - 10));
      await rightClick(bubble);
      expect(menu()?.style.top).toBe(`${window.innerHeight - 96}px`);
    });

    it('moves with the arrow keys, Home and End, skipping disabled entries', async () => {
      await rightClick(bubbles()[0] as HTMLElement);
      // Two dashboards: the removal is enabled and focusable.
      const [edit, remove] = menuItems();
      expect(remove?.disabled).toBe(false);
      expect(remove?.textContent).toContain('Supprimer…');
      const press = (key: string): void => {
        (document.activeElement as HTMLElement).dispatchEvent(
          new KeyboardEvent('keydown', { key, bubbles: true }),
        );
      };
      press('ArrowDown');
      expect(document.activeElement).toBe(remove);
      press('ArrowDown');
      expect(document.activeElement).toBe(edit);
      press('End');
      expect(document.activeElement).toBe(remove);
      press('Home');
      expect(document.activeElement).toBe(edit);
    });

    it('opens the deletion dialog from "Supprimer…" and gives the focus back on cancel', async () => {
      const bubble = bubbles()[1] as HTMLElement;
      await rightClick(bubble);
      menuItems()[1]?.click();
      await flush();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(document.querySelector('[data-testid="dashboard-delete-dialog"]')).not.toBeNull();
      });
      expect(menu()).toBeNull();
      (
        document.querySelector('[data-testid="dashboard-delete-cancel"]') as HTMLButtonElement
      ).click();
      await flush();
      await vi.waitFor(() => expect(document.activeElement).toBe(bubble));
      expect(document.querySelector('[data-testid="dashboard-delete-dialog"]')).toBeNull();
    });

    it('focuses the + bubble after a deletion when no bubble is active', async () => {
      await rightClick(bubbles()[1] as HTMLElement);
      menuItems()[1]?.click();
      await flush();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(
          fixture.debugElement.query(By.directive(DashboardDeleteDialogComponent)),
        ).toBeTruthy();
      });
      fixture.debugElement
        .query(By.directive(DashboardDeleteDialogComponent))
        .componentInstance.closed.emit(true);
      await flush();
      await vi.waitFor(() => expect(document.activeElement).toBe(addButton()));
    });

    it('labels the removal as impossible for the last dashboard', async () => {
      repository.items.splice(1, 1);
      await list.afterRemoval();
      await flush();
      await rightClick(bubbles()[0] as HTMLElement);
      expect(menuItems()[1]?.textContent).toContain('dernier tableau');
      expect(menuItems()[1]?.disabled).toBe(true);
    });

    it('closes on Escape and gives the focus back to the bubble', async () => {
      const bubble = bubbles()[1] as HTMLElement;
      await rightClick(bubble);
      menuItems()[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await flush();
      expect(menu()).toBeNull();
      expect(document.activeElement).toBe(bubble);
    });

    it('closes on Tab without taking the focus', async () => {
      const bubble = bubbles()[1] as HTMLElement;
      await rightClick(bubble);
      menuItems()[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      await flush();
      expect(menu()).toBeNull();
      expect(document.activeElement).not.toBe(bubble);
    });

    it('closes on a click outside, stays open on a click inside', async () => {
      await rightClick(bubbles()[0] as HTMLElement);
      menu()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      expect(menu()).not.toBeNull();
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      expect(menu()).toBeNull();
    });
  });

  describe('add button', () => {
    it('is aria-disabled at the limit, shows the limit text and opens nothing', async () => {
      await setup(Array.from({ length: MAX_DASHBOARDS }, (_, i) => ({ name: `T${i}` })));
      expect(addButton().getAttribute('aria-disabled')).toBe('true');
      expect(addButton().getAttribute('aria-label')).toContain('Nombre maximal');
      addButton().click();
      await flush();
      expect(dialog()).toBeNull();
    });
  });

  describe('creation and edition', () => {
    beforeEach(() => setup([{ name: 'Accueil' }, { name: 'Pro' }]));

    const waitDialog = async (): Promise<HTMLElement> => {
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(dialog()).not.toBeNull();
      });
      return dialog() as HTMLElement;
    };

    it('opens the creation dialog from the add button, then returns the focus on cancel', async () => {
      addButton().focus();
      addButton().click();
      const d = await waitDialog();
      expect(d.textContent).toContain('Nouveau tableau de bord');
      (d.querySelector('[data-testid="dashboard-form-cancel"]') as HTMLElement).click();
      await flush();
      await vi.waitFor(() => expect(document.activeElement).toBe(addButton()));
      expect(dialog()).toBeNull();
    });

    it('creates a dashboard, navigates to it and focuses its bubble', async () => {
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
      addButton().click();
      const d = await waitDialog();
      const input = d.querySelector('input[type="text"]') as HTMLInputElement;
      input.value = '  Jeux  ';
      input.dispatchEvent(new Event('input'));
      (d.querySelector('input[value="trophy"]') as HTMLInputElement).click();
      (d.querySelector('form') as HTMLFormElement).dispatchEvent(
        new Event('submit', { cancelable: true }),
      );
      await vi.waitFor(() => expect(repository.items).toHaveLength(3));
      expect(repository.items[2]).toMatchObject({ name: 'Jeux', icon: 'trophy' });
      await vi.waitFor(() => expect(dialog()).toBeNull());
      expect(navigate).toHaveBeenCalledWith(['/dashboards', repository.items[2]?.id]);
      await flush();
      await vi.waitFor(() =>
        expect(document.activeElement?.getAttribute('data-dashboard-id')).toBe(
          repository.items[2]?.id,
        ),
      );
      expect(bubbles()).toHaveLength(3);
    });

    it('edits name and icon from the menu and gives the focus back to the bubble', async () => {
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
      const bubble = bubbles()[1] as HTMLElement;
      bubble.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      await flush();
      menuItems()[0]?.click();
      await flush();
      const d = await waitDialog();
      expect(menu()).toBeNull();
      expect(d.textContent).toContain('Modifier le tableau de bord');
      const input = d.querySelector('input[type="text"]') as HTMLInputElement;
      expect(input.value).toBe('Pro');
      input.value = 'Travail';
      input.dispatchEvent(new Event('input'));
      (d.querySelector('input[value="briefcase"]') as HTMLInputElement).click();
      (d.querySelector('form') as HTMLFormElement).dispatchEvent(
        new Event('submit', { cancelable: true }),
      );
      await vi.waitFor(() => expect(dialog()).toBeNull());
      expect(repository.items[1]).toMatchObject({ name: 'Travail', icon: 'briefcase' });
      expect(navigate).not.toHaveBeenCalled();
      await flush();
      expect(bubbles()[1]?.getAttribute('aria-label')).toBe('Travail');
      await vi.waitFor(() => expect(document.activeElement).toBe(bubbles()[1]));
    });
  });

  describe('add widget button (green +, blue V)', () => {
    const widgetButton = (): HTMLButtonElement =>
      el.querySelector<HTMLButtonElement>('[data-testid="add-widget"]') as HTMLButtonElement;
    const icon = (): string => widgetButton().querySelector('i')?.className ?? '';
    let flow: WidgetAddFlow;
    let store: DashboardStore;

    beforeEach(async () => {
      await setup([{ name: 'Accueil' }], [fixtureDefinition({ type: 'aa' }) as WidgetDefinition]);
      flow = TestBed.inject(WidgetAddFlow);
      store = TestBed.inject(DashboardStore);
    });

    it('is aria-disabled and inert outside a dashboard', async () => {
      expect(widgetButton().getAttribute('aria-disabled')).toBe('true');
      expect(widgetButton().getAttribute('aria-label')).toBe(
        'Ouvrez un tableau de bord pour ajouter un widget',
      );
      expect(widgetButton().disabled).toBe(false);
      widgetButton().click();
      await flush();
      expect(flow.phase()).toBe('unavailable');
      expect(dialog()).toBeNull();
    });

    it('shows a green + that opens the pop-up, separate from the neutral + of dashboards', async () => {
      await store.open(null, 'Accueil');
      await flush();
      expect(widgetButton()).not.toBe(addButton());
      expect(widgetButton().classList.contains('sidebar-bubble-add')).toBe(true);
      expect(widgetButton().classList.contains('sidebar-bubble-done')).toBe(false);
      expect(icon()).toBe('pi pi-plus');
      expect(widgetButton().getAttribute('aria-haspopup')).toBe('dialog');
      expect(widgetButton().getAttribute('aria-disabled')).toBeNull();
      expect(widgetButton().getAttribute('aria-label')).toBe('Ajouter un widget');
      widgetButton().click();
      await flush();
      expect(flow.phase()).toBe('choosing');
      expect(widgetButton().getAttribute('aria-expanded')).toBe('true');
      expect(document.querySelector('[data-testid="add-aa"]')).not.toBeNull();
    });

    it('turns blue with a V after a pick, on the same button node, and the V ends the add', async () => {
      await store.open(null, 'Accueil');
      await flush();
      const node = widgetButton();
      node.click();
      await flush();
      document.querySelector<HTMLButtonElement>('[data-testid="add-aa"]')?.click();
      await vi.waitFor(() => expect(flow.phase()).toBe('confirming'));
      await flush();
      expect(widgetButton()).toBe(node);
      expect(node.classList.contains('sidebar-bubble-done')).toBe(true);
      expect(node.classList.contains('sidebar-bubble-add')).toBe(false);
      expect(icon()).toBe('pi pi-check');
      expect(node.getAttribute('aria-label')).toBe("Terminer l'ajout du widget");
      expect(el.querySelector('[data-testid="sidebar-status"]')?.textContent).toContain('ajouté');
      expect(document.querySelector('[data-testid="widget-picker-dialog"]')).toBeNull();
      await vi.waitFor(() => expect(document.activeElement).toBe(node));
      node.click();
      await flush();
      expect(flow.phase()).toBe('idle');
      expect(widgetButton()).toBe(node);
      expect(node.classList.contains('sidebar-bubble-add')).toBe(true);
      expect(icon()).toBe('pi pi-plus');
      // The V created, cancelled and removed nothing.
      expect(store.instances()).toHaveLength(1);
    });

    it('Escape on the V ends the add', async () => {
      await store.open(null, 'Accueil');
      flow.open();
      await flow.pick('aa');
      await flush();
      widgetButton().focus();
      widgetButton().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
      await flush();
      expect(flow.phase()).toBe('idle');
      expect(store.instances()).toHaveLength(1);
    });

    it('Escape on the + does nothing', async () => {
      await store.open(null, 'Accueil');
      await flush();
      widgetButton().focus();
      widgetButton().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await flush();
      expect(flow.phase()).toBe('idle');
    });

    it('registers itself as the focus trigger', async () => {
      await store.open(null, 'Accueil');
      await flush();
      flow.focusTrigger();
      expect(document.activeElement).toBe(widgetButton());
    });
  });
});
