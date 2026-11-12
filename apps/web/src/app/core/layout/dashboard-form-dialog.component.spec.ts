import { ApplicationInitStatus } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import {
  DASHBOARD_REPOSITORY,
  DEFAULT_DASHBOARD_ICON,
  DataError,
  SETTINGS_REPOSITORY,
  WIDGET_INSTANCE_REPOSITORY,
  type Dashboard,
} from '../../data';
import { DASHBOARD_ICONS } from '../dashboard/dashboard-icons';
import { DashboardListStore, MAX_DASHBOARDS } from '../dashboard/dashboard-list.store';
import { provideAppI18n } from '../i18n';
import { FakeDashboardRepository } from '../testing/fake-dashboard.repository';
import { FakeSettingsRepository } from '../testing/fake-settings.repository';
import { FakeWidgetInstanceRepository } from '../testing/fake-widget-instance.repository';
import { DashboardFormDialogComponent } from './dashboard-form-dialog.component';

describe('DashboardFormDialogComponent', () => {
  let repository: FakeDashboardRepository;
  let list: DashboardListStore;
  let fixture: ComponentFixture<DashboardFormDialogComponent>;
  let closed: (Dashboard | null)[];

  async function open(
    derive: (first: Dashboard) => Dashboard | null = () => null,
    extra = 0,
  ): Promise<void> {
    repository = new FakeDashboardRepository();
    await repository.create({ name: 'Accueil' });
    for (let i = 0; i < extra; i++) await repository.create({ name: `T${i}` });
    TestBed.configureTestingModule({
      imports: [DashboardFormDialogComponent],
      providers: [
        provideAppI18n(),
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
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    closed = [];
    fixture = TestBed.createComponent(DashboardFormDialogComponent);
    fixture.componentRef.setInput('dashboard', derive(repository.items[0] as Dashboard));
    fixture.componentInstance.closed.subscribe((value) => closed.push(value));
    await fixture.whenStable();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(nameInput()).not.toBeNull();
    });
  }

  const nameInput = (): HTMLInputElement | null =>
    document.querySelector<HTMLInputElement>('#dashboard-form-name');
  const form = (): HTMLFormElement => document.querySelector('form') as HTMLFormElement;
  const radios = (): HTMLInputElement[] =>
    Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
  const submit = async (): Promise<Event> => {
    const event = new Event('submit', { cancelable: true });
    form().dispatchEvent(event);
    fixture.detectChanges();
    await fixture.whenStable();
    return event;
  };
  const type = (value: string): void => {
    const input = nameInput() as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const error = (): string | undefined =>
    document.querySelector('[data-testid="dashboard-form-error"]')?.textContent?.trim();

  afterEach(() => {
    document.querySelectorAll('p-dialog, .p-dialog-mask').forEach((node) => node.remove());
  });

  it('is a modal dialog with no close button and no dismissable mask', async () => {
    await open();
    expect(document.querySelector('.p-dialog-close-button')).toBeNull();
    expect(document.querySelector('.p-dialog-mask')).not.toBeNull();
    document.querySelector<HTMLElement>('.p-dialog-mask')?.click();
    expect(closed).toEqual([]);
  });

  it('puts the initial focus on the name field', async () => {
    await open();
    await vi.waitFor(() => expect(document.activeElement).toBe(nameInput()));
  });

  it('offers every icon of the closed list as a native radio, with the default one checked', async () => {
    await open();
    expect(radios().map((r) => r.value)).toEqual([...DASHBOARD_ICONS]);
    expect(
      radios()
        .filter((r) => r.checked)
        .map((r) => r.value),
    ).toEqual([DEFAULT_DASHBOARD_ICON]);
    expect(radios().every((r) => r.closest('label')?.getAttribute('title'))).toBe(true);
  });

  it('refuses an empty name and a name of 101 characters, with an error under the field', async () => {
    await open();
    const create = vi.spyOn(repository, 'create');
    type('   ');
    const event = await submit();
    expect(event.defaultPrevented).toBe(true);
    expect(
      document.querySelector('[data-testid="dashboard-form-name-error"]')?.textContent,
    ).toContain('1 à 100');
    expect(nameInput()?.getAttribute('aria-invalid')).toBe('true');
    type('x'.repeat(101));
    await submit();
    expect(create).not.toHaveBeenCalled();
    expect(closed).toEqual([]);
    type('x'.repeat(100));
    await submit();
    await vi.waitFor(() => expect(closed).toHaveLength(1));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('creates with the trimmed name and the chosen icon, navigates, then closes', async () => {
    await open();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
    type('  Jeux  ');
    const trophy = radios().find((r) => r.value === 'trophy') as HTMLInputElement;
    trophy.click();
    fixture.detectChanges();
    await submit();
    await vi.waitFor(() => expect(closed).toHaveLength(1));
    const created = repository.items[1];
    expect(created).toMatchObject({ name: 'Jeux', icon: 'trophy' });
    expect(closed[0]).toEqual(created);
    expect(navigate).toHaveBeenCalledWith(['/dashboards', created?.id]);
  });

  it('writes once on a double submission', async () => {
    await open();
    const create = vi.spyOn(repository, 'create');
    type('Double');
    form().dispatchEvent(new Event('submit', { cancelable: true }));
    form().dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(closed).toHaveLength(1));
    expect(create).toHaveBeenCalledTimes(1);
    expect(repository.items).toHaveLength(2);
  });

  it('allows a duplicate name', async () => {
    await open();
    type('Accueil');
    await submit();
    await vi.waitFor(() => expect(closed).toHaveLength(1));
    expect(repository.items.map((d) => d.name)).toEqual(['Accueil', 'Accueil']);
  });

  it('edits: prefilled, update only, no navigation', async () => {
    await open((first) => ({ ...first, icon: 'home' }));
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
    expect(nameInput()?.value).toBe('Accueil');
    expect(radios().find((r) => r.checked)?.value).toBe('home');
    expect(document.querySelector('.p-dialog')?.textContent).toContain('Enregistrer');
    type('Maison');
    await submit();
    await vi.waitFor(() => expect(closed).toHaveLength(1));
    expect(repository.items[0]).toMatchObject({ name: 'Maison', icon: 'home' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps an unknown stored icon: nothing is checked and it is written back unchanged', async () => {
    await open((first) => ({ ...first, icon: 'not-in-the-list' }));
    expect(radios().some((r) => r.checked)).toBe(false);
    type('Renommé');
    await submit();
    await vi.waitFor(() => expect(closed).toHaveLength(1));
    expect(repository.items[0]).toMatchObject({ name: 'Renommé', icon: 'not-in-the-list' });
  });

  it('shows a write error, stays open and allows another attempt', async () => {
    await open();
    type('Echec');
    repository.failNext(new DataError('unavailable', 'no db'));
    await submit();
    await vi.waitFor(() => expect(error()).toContain("Impossible d'enregistrer"));
    expect(closed).toEqual([]);
    expect(
      document.querySelector<HTMLButtonElement>('[data-testid="dashboard-form-submit"]')?.disabled,
    ).toBe(false);
    await submit();
    await vi.waitFor(() => expect(closed).toHaveLength(1));
    expect(document.querySelector('[data-testid="dashboard-form-error"]')).toBeNull();
  });

  it('shows the limit message at 100 dashboards', async () => {
    await open(() => null, MAX_DASHBOARDS - 1);
    type('Un de trop');
    await submit();
    await vi.waitFor(() => expect(error()).toContain('Nombre maximal'));
    expect(repository.items).toHaveLength(MAX_DASHBOARDS);
  });

  it('closes on Escape and on Cancel when idle', async () => {
    await open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closed).toEqual([null]);
    document.querySelector<HTMLButtonElement>('[data-testid="dashboard-form-cancel"]')?.click();
    expect(closed).toEqual([null, null]);
  });

  it('ignores Escape and disables the buttons while writing', async () => {
    await open();
    let release: (value: Dashboard) => void = () => undefined;
    vi.spyOn(repository, 'create').mockImplementation(
      () =>
        new Promise<Dashboard>((resolve) => {
          release = resolve;
        }),
    );
    type('Lent');
    form().dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    expect(
      document.querySelector<HTMLButtonElement>('[data-testid="dashboard-form-cancel"]')?.disabled,
    ).toBe(true);
    expect(
      document.querySelector<HTMLButtonElement>('[data-testid="dashboard-form-submit"]')?.disabled,
    ).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closed).toEqual([]);
    release({ ...(repository.items[0] as Dashboard), id: 'new', name: 'Lent' });
    await vi.waitFor(() => expect(closed).toHaveLength(1));
  });
});
