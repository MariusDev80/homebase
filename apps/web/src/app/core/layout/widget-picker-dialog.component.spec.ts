import { ApplicationInitStatus } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DASHBOARD_REPOSITORY, DataError, WIDGET_INSTANCE_REPOSITORY } from '../../data';
import { DashboardStore } from '../dashboard/dashboard.store';
import { WidgetAddFlow } from '../dashboard/widget-add-flow';
import { provideAppI18n } from '../i18n';
import { FakeDashboardRepository } from '../testing/fake-dashboard.repository';
import { FakeWidgetInstanceRepository } from '../testing/fake-widget-instance.repository';
import { fixtureDefinition } from '../testing/fixture-definitions';
import type { WidgetDefinition } from '../widgets/widget-definition';
import { provideWidget } from '../widgets/widget-registry';
import { WidgetPickerDialogComponent } from './widget-picker-dialog.component';

describe('WidgetPickerDialogComponent', () => {
  let fixture: ComponentFixture<WidgetPickerDialogComponent>;
  let flow: WidgetAddFlow;
  let store: DashboardStore;
  let instances: FakeWidgetInstanceRepository;

  async function setup(definitions: WidgetDefinition[]) {
    instances = new FakeWidgetInstanceRepository();
    TestBed.configureTestingModule({
      imports: [WidgetPickerDialogComponent],
      providers: [
        provideAppI18n(),
        ...definitions.map((d) => provideWidget(d)),
        { provide: DASHBOARD_REPOSITORY, useValue: new FakeDashboardRepository() },
        { provide: WIDGET_INSTANCE_REPOSITORY, useValue: instances },
      ],
    });
    await TestBed.compileComponents();
    await TestBed.inject(ApplicationInitStatus).donePromise;
    store = TestBed.inject(DashboardStore);
    flow = TestBed.inject(WidgetAddFlow);
    await store.open(null, 'Accueil');
    flow.open();
    fixture = TestBed.createComponent(WidgetPickerDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  const entry = (type: string): HTMLButtonElement =>
    document.querySelector<HTMLButtonElement>(`[data-testid="add-${type}"]`) as HTMLButtonElement;
  const press = (key: string): void => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  };

  afterEach(() => {
    document.querySelectorAll('p-dialog, .p-dialog-mask').forEach((node) => node.remove());
  });

  it('lists every registered widget with title and description, and focuses the first', async () => {
    await setup([
      fixtureDefinition({ type: 'aa' }),
      fixtureDefinition({ type: 'bb' }),
    ] as WidgetDefinition[]);
    expect(entry('aa')).not.toBeNull();
    expect(entry('bb')).not.toBeNull();
    expect(entry('aa').textContent).toContain('Bonjour');
    expect(document.querySelector('.p-dialog-close-button')).toBeNull();
    expect(document.activeElement).toBe(entry('aa'));
  });

  it('disables an entry at its limit and shows the reason', async () => {
    await setup([
      fixtureDefinition({ type: 'aa', maxInstances: 1 }),
      fixtureDefinition({ type: 'bb' }),
    ] as WidgetDefinition[]);
    flow.cancel();
    flow.open();
    await flow.pick('aa');
    flow.finish();
    flow.open();
    fixture.detectChanges();
    expect(entry('aa').disabled).toBe(true);
    expect(entry('aa').textContent).toContain('Déjà présent sur ce tableau');
    expect(entry('bb').disabled).toBe(false);
    expect(document.querySelector('[data-testid="widget-picker-full"]')).toBeNull();
  });

  it('shows the grid-full message and disables every entry, creating nothing', async () => {
    await setup([fixtureDefinition({ type: 'aa' })] as WidgetDefinition[]);
    // 24 widgets of 2 x 2 fill the 12 x 8 grid.
    for (let i = 0; i < 24; i++) await store.add('aa');
    fixture.detectChanges();
    expect(entry('aa').disabled).toBe(true);
    expect(entry('aa').textContent).toContain('Plus assez de place');
    expect(document.querySelector('[data-testid="widget-picker-full"]')?.textContent).toContain(
      'La grille est pleine',
    );
    const create = vi.spyOn(instances, 'create');
    entry('aa').click();
    expect(create).not.toHaveBeenCalled();
  });

  it('picks a widget: confirming phase, nothing else', async () => {
    await setup([fixtureDefinition({ type: 'aa' })] as WidgetDefinition[]);
    entry('aa').click();
    await vi.waitFor(() => expect(flow.phase()).toBe('confirming'));
    expect(store.instances()).toHaveLength(1);
  });

  it('shows an error and refocuses the first active entry after a failed add', async () => {
    await setup([fixtureDefinition({ type: 'aa' })] as WidgetDefinition[]);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    instances.failNext(new DataError('busy', 'locked'));
    entry('aa').click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(document.querySelector('[data-testid="widget-picker-error"]')).not.toBeNull();
      expect(document.activeElement).toBe(entry('aa'));
    });
    expect(flow.phase()).toBe('choosing');
  });

  it('Escape cancels the pop-up', async () => {
    await setup([fixtureDefinition({ type: 'aa' })] as WidgetDefinition[]);
    press('Escape');
    expect(flow.phase()).toBe('idle');
  });

  it('Escape is ignored while an add is being written', async () => {
    await setup([fixtureDefinition({ type: 'aa' })] as WidgetDefinition[]);
    const create = instances.create.bind(instances);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(instances, 'create').mockImplementation(async (input) => {
      await gate;
      return create(input);
    });
    const picking = flow.pick('aa');
    expect(flow.pending()).toBe(true);
    press('Escape');
    expect(flow.phase()).toBe('choosing');
    release();
    await picking;
    expect(flow.phase()).toBe('confirming');
  });

  it('the Cancel button cancels', async () => {
    await setup([fixtureDefinition({ type: 'aa' })] as WidgetDefinition[]);
    document.querySelector<HTMLButtonElement>('[data-testid="widget-picker-cancel"]')?.click();
    expect(flow.phase()).toBe('idle');
  });
});
