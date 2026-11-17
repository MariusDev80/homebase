import { ApplicationInitStatus, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideAppI18n } from '../../core/i18n';
import { HabitStore } from '../../core/habits';
import { FakeHabitRepository } from '../../core/testing/fake-habit.repository';
import { FakeSettingsRepository } from '../../core/testing/fake-settings.repository';
import { SYSTEM_TIME_ZONE_READER } from '../../core/time';
import { ManualClock } from '../../core/time/testing/manual-clock';
import { WIDGET_CONTEXT } from '../../core/widgets';
import type { GridSize, WidgetContext } from '../../core/widgets';
import { CLOCK, DataError, SETTINGS_REPOSITORY } from '../../data';
import type { Habit, HabitInput, LocalDateIso } from '../../data';
import { HABIT_REPOSITORY } from '../../data/schedule.tokens';
import { HabitsComponent } from './habits.component';
import type { HabitsConfig } from './habits.config';

// 11:00 on Tuesday 2026-11-17 in Paris (CET).
const NOW = '2026-11-17T10:00:00.000Z';
const TODAY = '2026-11-17';
const ALL = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

function daily(title: string, startOn = '2026-11-10'): HabitInput {
  return { title, schedule: { kind: 'days', days: [...ALL] }, startOn, reminder: null };
}

async function seed(
  repo: FakeHabitRepository,
  input: HabitInput,
  checked: readonly LocalDateIso[] = [],
): Promise<Habit> {
  const habit = await repo.create(input);
  for (const day of checked) await repo.setCheck(habit.id, day, true);
  return habit;
}

/** Records the id of every create, and can write then answer conflict (a lost response). */
class ProbeRepository extends FakeHabitRepository {
  readonly createdIds: (string | undefined)[] = [];
  conflictAfterWrite = false;

  override async create(input: HabitInput & { readonly id?: string }): Promise<Habit> {
    this.createdIds.push(input.id);
    const created = await super.create(input);
    if (this.conflictAfterWrite) {
      this.conflictAfterWrite = false;
      throw new DataError('conflict', 'exists', { cause: { kind: 'conflict' } });
    }
    return created;
  }
}

/** A check that waits for the test to let it through. */
class GatedRepository extends FakeHabitRepository {
  gate: Promise<void> | null = null;

  override async setCheck(habitId: string, dayOn: LocalDateIso, done: boolean): Promise<boolean> {
    if (this.gate !== null) await this.gate;
    return super.setCheck(habitId, dayOn, done);
  }
}

interface Options {
  make?: (clock: ManualClock) => FakeHabitRepository;
  prepare?: (repo: FakeHabitRepository) => Promise<void> | void;
}

async function render(options: Options = {}) {
  const clock = new ManualClock(NOW);
  const repo = options.make?.(clock) ?? new FakeHabitRepository(clock);
  await options.prepare?.(repo);
  const ctx: WidgetContext<HabitsConfig> = {
    instanceId: 'inst-1',
    type: 'habits',
    config: signal<HabitsConfig>({}),
    size: signal<GridSize>({ w: 4, h: 4 }),
    permissions: new Set(['notifications']),
    updateConfig: () => Promise.resolve(),
  };
  TestBed.configureTestingModule({
    providers: [
      provideAppI18n(),
      { provide: WIDGET_CONTEXT, useValue: ctx },
      { provide: CLOCK, useValue: clock },
      { provide: HABIT_REPOSITORY, useValue: repo },
      { provide: SETTINGS_REPOSITORY, useValue: new FakeSettingsRepository() },
      { provide: SYSTEM_TIME_ZONE_READER, useValue: () => 'Europe/Paris' },
    ],
  });
  await TestBed.inject(ApplicationInitStatus).donePromise;
  const fixture = TestBed.createComponent(HabitsComponent);
  document.body.appendChild(fixture.nativeElement);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement>(id: string) => el.querySelector<T>(`[data-testid="${id}"]`);
  const all = (id: string) => Array.from(el.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`));
  const text = (id: string) => q(id)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  const cell = (habitId: string, day: string) =>
    el.querySelector<HTMLButtonElement>(`[data-cell="${habitId}|${day}"]`);
  const settle = async (ms = 0) => {
    await vi.advanceTimersByTimeAsync(ms);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
  };
  const click = async (target: HTMLElement | null) => {
    if (!target) throw new Error('element not found');
    target.click();
    await settle();
  };
  const type = async (id: string, value: string, event = 'input') => {
    const input = q<HTMLInputElement>(id);
    if (!input) throw new Error(`input ${id} not found`);
    input.value = value;
    input.dispatchEvent(new Event(event, { bubbles: true }));
    await settle();
  };
  const key = async (target: HTMLElement | null, name: string) => {
    if (!target) throw new Error('element not found');
    target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
    await settle();
  };
  await settle();
  return {
    fixture,
    el,
    clock,
    repo,
    store: TestBed.inject(HabitStore),
    q,
    all,
    text,
    cell,
    settle,
    click,
    type,
    key,
  };
}

describe('HabitsComponent', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('shows the empty state with a permanent status zone', async () => {
    const view = await render();
    expect(view.text('habits-empty')).toContain('Aucune habitude.');
    expect(view.text('habits-empty')).toContain('Créer une habitude');
    expect(view.q('habits-status')?.getAttribute('role')).toBe('status');
  });

  it('shows the desktop-only banner outside Tauri', async () => {
    const clock = new ManualClock(NOW);
    const repo = new FakeHabitRepository(clock);
    repo.failNext(new DataError('unavailable', 'no tauri'));
    TestBed.configureTestingModule({
      providers: [
        provideAppI18n(),
        {
          provide: WIDGET_CONTEXT,
          useValue: {
            instanceId: 'inst-1',
            type: 'habits',
            config: signal({}),
            size: signal({ w: 4, h: 4 }),
            permissions: new Set(['notifications']),
            updateConfig: () => Promise.resolve(),
          },
        },
        { provide: CLOCK, useValue: clock },
        { provide: HABIT_REPOSITORY, useValue: repo },
        { provide: SETTINGS_REPOSITORY, useValue: new FakeSettingsRepository() },
        { provide: SYSTEM_TIME_ZONE_READER, useValue: () => 'Europe/Paris' },
      ],
    });
    await TestBed.inject(ApplicationInitStatus).donePromise;
    const fixture = TestBed.createComponent(HabitsComponent);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="habits-unavailable"]')?.textContent).toContain(
      "Disponible uniquement dans l'application Windows.",
    );
    expect(el.querySelector('[data-testid="habits-create"]')).toBeNull();
    expect(el.querySelector('[data-testid="habits-new"]')).toBeNull();
  });

  it('renders the strip, the streak and the title as text', async () => {
    let id = '';
    const view = await render({
      prepare: async (repo) => {
        id = (
          await seed(repo, daily('<b>Read</b>'), [
            '2026-11-10',
            '2026-11-11',
            '2026-11-12',
            '2026-11-13',
            '2026-11-14',
            '2026-11-15',
            '2026-11-16',
          ])
        ).id;
      },
    });
    expect(view.all('habits-row')).toHaveLength(1);
    expect(view.el.querySelector('b')).toBeNull();
    expect(view.text('habits-row-title')).toBe('<b>Read</b>');
    expect(view.text('habits-row-form')).toBe('Tous les jours');
    expect(view.all('habits-cell')).toHaveLength(7);
    expect(view.cell(id, '2026-11-16')?.getAttribute('aria-pressed')).toBe('true');
    expect(view.cell(id, TODAY)?.getAttribute('aria-pressed')).toBe('false');
    expect(view.cell(id, TODAY)?.className).toContain('border-accent');
    expect(view.cell(id, '2026-11-16')?.className).toContain('bg-success-emphasis');
    expect(view.cell(id, '2026-11-16')?.querySelector('.pi-check')).not.toBeNull();
    expect(view.text('habits-row-streak')).toContain('Série : 7');
    expect(view.text('habits-row-streak')).toContain("7 jours prévus d'affilée");
    expect(view.cell(id, TODAY)?.getAttribute('aria-label')).toBe(
      "<b>Read</b>, mardi 17 novembre 2026, aujourd'hui",
    );
  });

  it('disables the days before the start date and marks the unplanned days', async () => {
    let id = '';
    const view = await render({
      prepare: async (repo) => {
        id = (
          await repo.create({
            title: 'Gym',
            schedule: { kind: 'days', days: ['MO', 'WE', 'FR'] },
            startOn: '2026-11-15',
            reminder: null,
          })
        ).id;
      },
    });
    expect(view.cell(id, '2026-11-14')?.disabled).toBe(true);
    expect(view.cell(id, '2026-11-15')?.disabled).toBe(false);
    // Sunday 15 and Tuesday 17 are not planned: still checkable, shown differently.
    expect(view.cell(id, '2026-11-15')?.className).toContain('bg-canvas-subtle');
    expect(view.cell(id, '2026-11-15')?.getAttribute('aria-label')).toContain('jour non prévu');
    expect(view.cell(id, '2026-11-16')?.className).not.toContain('bg-canvas-subtle');
    expect(view.text('habits-row-form')).toBe('Lun, mer, ven');
  });

  it('checks and unchecks a day, including the unplanned one', async () => {
    let id = '';
    const view = await render({
      prepare: async (repo) => {
        id = (await seed(repo, daily('Read'), ['2026-11-16'])).id;
      },
    });
    expect(view.text('habits-row-streak')).toContain('Série : 1');
    await view.click(view.cell(id, TODAY));
    expect(view.repo.checkRows.some((c) => c.dayOn === TODAY)).toBe(true);
    expect(view.cell(id, TODAY)?.getAttribute('aria-pressed')).toBe('true');
    expect(view.text('habits-row-streak')).toContain('Série : 2');
    await view.click(view.cell(id, TODAY));
    expect(view.repo.checkRows.some((c) => c.dayOn === TODAY)).toBe(false);
    expect(view.cell(id, TODAY)?.getAttribute('aria-pressed')).toBe('false');
    expect(view.q('habits-action-error')).toBeNull();
  });

  it('shows an action error on its own banner and rolls the cell back', async () => {
    let id = '';
    const view = await render({
      prepare: async (repo) => {
        id = (await seed(repo, daily('Read'))).id;
      },
    });
    view.repo.failNext(new DataError('busy', 'busy'));
    await view.click(view.cell(id, TODAY));
    expect(view.text('habits-action-error')).toContain('Homebase est occupé');
    expect(view.cell(id, TODAY)?.getAttribute('aria-pressed')).toBe('false');
    expect(view.q('habits-load-error')).toBeNull();
  });

  it('shows the weekly progress of a "N times a week" habit', async () => {
    const view = await render({
      prepare: async (repo) => {
        const h = await repo.create({
          title: 'Gym',
          schedule: { kind: 'weekly', target: 3 },
          startOn: '2026-11-01',
          reminder: null,
        });
        await repo.setCheck(h.id, '2026-11-16', true);
      },
    });
    expect(view.text('habits-row-form')).toBe('3 fois par semaine');
    expect(view.text('habits-row-progress')).toBe('1/3 cette semaine');
  });

  it('has a single tab stop per row and moves with the arrows, Home and End', async () => {
    let a = '';
    let b = '';
    const view = await render({
      prepare: async (repo) => {
        a = (await seed(repo, daily('Read'))).id;
        b = (await seed(repo, daily('Run'))).id;
      },
    });
    const stops = (id: string) =>
      view
        .all('habits-cell')
        .filter((c) => c.dataset['cell']?.startsWith(id) && c.getAttribute('tabindex') === '0');
    expect(stops(a)).toHaveLength(1);
    expect(stops(b)).toHaveLength(1);
    expect(stops(a)[0].dataset['day']).toBe(TODAY);

    const today = view.cell(a, TODAY);
    today?.focus();
    await view.key(today, 'ArrowLeft');
    expect(document.activeElement).toBe(view.cell(a, '2026-11-16'));
    expect(stops(a)[0].dataset['day']).toBe('2026-11-16');
    await view.key(document.activeElement as HTMLElement, 'Home');
    expect(document.activeElement).toBe(view.cell(a, '2026-11-11'));
    await view.key(document.activeElement as HTMLElement, 'ArrowLeft');
    expect(document.activeElement).toBe(view.cell(a, '2026-11-11'));
    await view.key(document.activeElement as HTMLElement, 'End');
    expect(document.activeElement).toBe(view.cell(a, TODAY));
    // The other row keeps its own tab stop.
    expect(stops(b)[0].dataset['day']).toBe(TODAY);
  });

  it('toggles with the button click that Space and Enter produce and keeps the focus', async () => {
    let id = '';
    const view = await render({
      prepare: async (repo) => {
        id = (await seed(repo, daily('Read'))).id;
      },
    });
    const target = view.cell(id, '2026-11-16');
    target?.focus();
    await view.click(target);
    expect(view.cell(id, '2026-11-16')?.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(view.cell(id, '2026-11-16'));
  });

  describe('panel', () => {
    it('opens a new habit, closes on Escape and gives the focus back', async () => {
      const view = await render();
      await view.click(view.q('habits-create'));
      expect(view.q('habit-form')).not.toBeNull();
      expect(document.activeElement).toBe(view.q('habit-title'));
      await view.key(view.q('habit-form'), 'Escape');
      expect(view.q('habit-form')).toBeNull();
      expect(document.activeElement).toBe(view.q('habits-create'));
    });

    it('asks before abandoning typed changes', async () => {
      const view = await render();
      await view.click(view.q('habits-create'));
      await view.type('habit-title', 'Read');
      await view.click(view.q('habit-cancel'));
      expect(view.q('habit-discard')).not.toBeNull();
      expect(view.q('habit-form')).not.toBeNull();
      await view.click(view.q('habit-keep'));
      expect(view.q('habit-discard')).toBeNull();
      await view.click(view.q('habit-cancel'));
      await view.click(view.q('habit-discard-confirm'));
      expect(view.q('habit-form')).toBeNull();
      expect(view.repo.calls.create).toBe(0);
    });

    it('refuses an empty title on the field, without calling Rust', async () => {
      const view = await render();
      await view.click(view.q('habits-create'));
      await view.click(view.q('habit-save'));
      expect(view.text('habit-error-title')).toContain('titre');
      expect(view.q('habit-title')?.getAttribute('aria-invalid')).toBe('true');
      expect(view.repo.calls.create).toBe(0);
    });

    it('creates a habit with a reminder from the form and announces it', async () => {
      const view = await render();
      await view.click(view.q('habits-create'));
      await view.type('habit-title', 'Balance');
      await view.click(view.q('habit-reminder-on'));
      await view.type('habit-reminder-time', '19:00');
      expect(view.text('habit-zone')).toBe('Heure de Europe/Paris');
      await view.click(view.q('habit-save'));
      expect(view.q('habit-form')).toBeNull();
      expect(view.text('habits-status')).toBe('Habitude enregistrée.');
      expect(view.repo.items).toHaveLength(1);
      expect(view.repo.items[0].reminder).toMatchObject({ time: '19:00', enabled: true });
      expect(view.text('habits-row-reminder')).toContain('Rappel à 19:00');
      expect(document.activeElement).toBe(view.q('habits-new'));
    });

    it('reuses one id for every save of an opening: no duplicate', async () => {
      const view = await render({ make: (clock) => new ProbeRepository(clock) });
      const repo = view.repo as ProbeRepository;
      await view.click(view.q('habits-create'));
      await view.type('habit-title', 'Read');
      repo.failNext(new DataError('busy', 'busy'));
      await view.click(view.q('habit-save'));
      expect(view.q('habit-form-error')).not.toBeNull();
      await view.click(view.q('habit-save'));
      expect(repo.createdIds).toHaveLength(2);
      expect(repo.createdIds[0]).toBeDefined();
      expect(repo.createdIds[1]).toBe(repo.createdIds[0]);
      expect(repo.items).toHaveLength(1);
      expect(view.q('habit-form')).toBeNull();
    });

    it('answers a conflict on create by updating that habit with what is typed', async () => {
      const view = await render({ make: (clock) => new ProbeRepository(clock) });
      const repo = view.repo as ProbeRepository;
      await view.click(view.q('habits-create'));
      await view.type('habit-title', 'Read');
      repo.conflictAfterWrite = true;
      await view.click(view.q('habit-save'));
      expect(repo.calls.update).toBe(1);
      expect(repo.items).toHaveLength(1);
      expect(repo.items[0].id).toBe(repo.createdIds[0]);
      expect(view.q('habit-form')).toBeNull();
      expect(view.text('habits-status')).toBe('Habitude enregistrée.');
    });

    it('puts a Rust refusal on its field', async () => {
      const view = await render();
      await view.click(view.q('habits-create'));
      await view.type('habit-title', 'Read');
      view.repo.failNext(
        new DataError('invalid_input', 'Invalid input', {
          cause: { kind: 'invalid_input', field: 'title' },
        }),
      );
      await view.click(view.q('habit-save'));
      expect(view.q('habit-error-title')).not.toBeNull();
      expect(view.q('habit-form-error')).toBeNull();
    });

    it('explains the limit in the form', async () => {
      const view = await render();
      await view.click(view.q('habits-create'));
      await view.type('habit-title', 'Read');
      view.repo.failNext(new DataError('forbidden', 'limit', { cause: { kind: 'limit_reached' } }));
      await view.click(view.q('habit-save'));
      expect(view.text('habit-form-error')).toContain('100 habitudes au plus.');
    });

    it('edits a habit and returns the focus to its details button', async () => {
      let id = '';
      const view = await render({
        prepare: async (repo) => {
          id = (await seed(repo, daily('Read'))).id;
        },
      });
      const opener = view.q('habits-detail');
      expect(opener?.getAttribute('aria-label')).toBe('Détails de Read');
      await view.click(opener);
      expect((view.q('habit-title') as HTMLInputElement).value).toBe('Read');
      await view.type('habit-title', 'Read more');
      await view.click(view.q('habit-save'));
      expect(view.repo.items.find((h) => h.id === id)?.title).toBe('Read more');
      expect(document.activeElement).toBe(view.q('habits-detail'));
    });

    it('switches to "N times a week" and refuses a bad target on its field', async () => {
      const view = await render();
      await view.click(view.q('habits-create'));
      await view.type('habit-title', 'Gym');
      await view.click(view.q('habit-kind-weekly'));
      await view.type('habit-target', '9');
      await view.click(view.q('habit-save'));
      expect(view.q('habit-error-target')).not.toBeNull();
      await view.type('habit-target', '3');
      await view.click(view.q('habit-save'));
      expect(view.repo.items[0].schedule).toEqual({ kind: 'weekly', target: 3 });
    });

    it('requires at least one day and offers "every day"', async () => {
      const view = await render();
      await view.click(view.q('habits-create'));
      await view.type('habit-title', 'Read');
      for (const day of ALL) await view.click(view.q(`habit-day-${day}`));
      await view.click(view.q('habit-save'));
      expect(view.q('habit-error-days')).not.toBeNull();
      await view.click(view.q('habit-all-days'));
      expect(view.q('habit-error-days')).toBeNull();
      await view.click(view.q('habit-save'));
      expect(view.repo.items).toHaveLength(1);
    });

    it('shows only the time of an existing reminder, never its next occurrence', async () => {
      const view = await render({
        prepare: async (repo) => {
          await repo.create({
            ...daily('Read'),
            reminder: { time: '07:30', days: ['MO'], timeZone: 'Europe/Paris', enabled: true },
          });
        },
      });
      await view.click(view.q('habits-detail'));
      expect((view.q('habit-reminder-time') as HTMLInputElement).value).toBe('07:30');
      expect(view.text('habit-form')).not.toMatch(/prochain|Prochain/);
    });

    it('archives from the form, lists it under Archivées and restores it', async () => {
      const view = await render({
        prepare: async (repo) => {
          await seed(repo, daily('Read'));
        },
      });
      await view.click(view.q('habits-detail'));
      await view.click(view.q('habit-archive'));
      expect(view.text('habits-status')).toBe('Habitude archivée.');
      expect(view.all('habits-row')).toHaveLength(0);
      expect(view.text('habits-archived-toggle')).toContain('Archivées (1)');
      await view.click(view.q('habits-archived-toggle'));
      await view.click(view.q('habits-restore'));
      expect(view.text('habits-status')).toBe('Habitude restaurée.');
      expect(view.all('habits-row')).toHaveLength(1);
      expect(view.q('habits-archived')).toBeNull();
    });

    it('deletes only after a confirmation, from the form and from the archive', async () => {
      const view = await render({
        prepare: async (repo) => {
          await seed(repo, daily('Read'));
          const gone = await seed(repo, daily('Old'));
          await repo.setArchived(gone.id, true);
        },
      });
      await view.click(view.q('habits-archived-toggle'));
      await view.click(view.q('habits-delete'));
      expect(view.repo.calls.remove).toBe(0);
      await view.click(view.q('habits-delete-cancel'));
      expect(view.repo.items).toHaveLength(2);
      await view.click(view.q('habits-delete'));
      await view.click(view.q('habits-delete-confirm'));
      expect(view.repo.items).toHaveLength(1);

      await view.click(view.q('habits-detail'));
      await view.click(view.q('habit-delete'));
      expect(view.repo.calls.remove).toBe(1);
      await view.click(view.q('habit-delete-confirm'));
      expect(view.repo.items).toHaveLength(0);
      expect(view.text('habits-status')).toBe('Habitude supprimée.');
      expect(view.q('habits-empty')).not.toBeNull();
    });

    it('restores the stored reminder when the hidden values are unreadable', async () => {
      const view = await render({
        prepare: async (repo) => {
          await repo.create({
            ...daily('Read'),
            reminder: { time: '07:30', days: ['MO'], timeZone: 'Europe/Paris', enabled: true },
          });
        },
      });
      await view.click(view.q('habits-detail'));
      await view.type('habit-reminder-time', '');
      await view.click(view.q('habit-reminder-on'));
      expect(view.text('habit-reminder-off')).toContain('Rappel désactivé');
      await view.click(view.q('habit-save'));
      expect(view.repo.items[0].reminder).toMatchObject({ time: '07:30', enabled: false });
    });

    it('shows a disabled reminder in the form and, once restored, in the list', async () => {
      const view = await render({
        prepare: async (repo) => {
          const h = await repo.create({
            ...daily('Read'),
            reminder: { time: '07:30', days: ['MO'], timeZone: 'Europe/Paris', enabled: true },
          });
          await repo.setArchived(h.id, true);
        },
      });
      await view.click(view.q('habits-archived-toggle'));
      expect(view.q('habits-detail')).toBeNull();
      await view.click(view.q('habits-restore'));
      expect(view.text('habits-row-reminder')).toContain('Rappel désactivé (07:30)');
      expect(view.q('habits-row-reminder')?.querySelector('.pi-bell-slash')).not.toBeNull();
      await view.click(view.q('habits-detail'));
      expect(view.text('habit-reminder-off')).toBe('Rappel désactivé (07:30)');
    });

    it('backs out of a pending deletion first on Escape', async () => {
      const view = await render({
        prepare: async (repo) => {
          await seed(repo, daily('Read'));
        },
      });
      await view.click(view.q('habits-detail'));
      await view.click(view.q('habit-delete'));
      expect(view.q('habit-delete-confirm')).not.toBeNull();
      await view.key(view.q('habit-form'), 'Escape');
      expect(view.q('habit-delete-confirm')).toBeNull();
      expect(view.q('habit-form')).not.toBeNull();
      await view.key(view.q('habit-form'), 'Escape');
      expect(view.q('habit-form')).toBeNull();
    });

    it('does not see a modification in toggling a day off and on again', async () => {
      const view = await render({
        prepare: async (repo) => {
          await seed(repo, daily('Read'));
        },
      });
      await view.click(view.q('habits-detail'));
      await view.click(view.q('habit-day-MO'));
      await view.click(view.q('habit-day-MO'));
      await view.click(view.q('habit-cancel'));
      expect(view.q('habit-discard')).toBeNull();
      expect(view.q('habit-form')).toBeNull();
    });

    it('bounds the start date by today', async () => {
      const view = await render();
      await view.click(view.q('habits-create'));
      expect(view.q('habit-start')?.getAttribute('max')).toBe(TODAY);
      expect(view.q('habit-start')?.getAttribute('min')).toBe('1900-01-01');
    });
  });

  describe('strip', () => {
    it('lines the header up with the row: same columns, hidden cells and [i] size', async () => {
      const view = await render({
        prepare: async (repo) => {
          await seed(repo, daily('Read'));
        },
      });
      const header = view.q('habits-header') as HTMLElement;
      const headerCells = Array.from(header.children[1].children);
      const cells = view.all('habits-cell');
      expect(headerCells).toHaveLength(cells.length);
      headerCells.forEach((h, i) => {
        expect(h.classList.contains('@max-[20rem]:hidden')).toBe(
          cells[i].classList.contains('@max-[20rem]:hidden'),
        );
      });
      const spacer = view.q('habits-header-detail') as HTMLElement;
      for (const cls of ['btn', 'btn-icon', 'btn-compact', 'btn-invisible']) {
        expect(spacer.classList.contains(cls)).toBe(
          view.q('habits-detail')?.classList.contains(cls),
        );
      }
      expect(view.q('habits-row-title')?.getAttribute('title')).toBe('Read');
    });

    it('hands the tab stop back to today when the focus leaves the row', async () => {
      let id = '';
      const view = await render({
        prepare: async (repo) => {
          id = (await seed(repo, daily('Read'))).id;
        },
      });
      const today = view.cell(id, TODAY);
      today?.focus();
      await view.key(today, 'ArrowLeft');
      expect(view.cell(id, '2026-11-16')?.getAttribute('tabindex')).toBe('0');
      // Moving inside the row keeps the stop where it is.
      await view.key(document.activeElement as HTMLElement, 'ArrowLeft');
      expect(view.cell(id, '2026-11-15')?.getAttribute('tabindex')).toBe('0');
      (view.q('habits-new') as HTMLElement).focus();
      await view.settle();
      expect(view.cell(id, TODAY)?.getAttribute('tabindex')).toBe('0');
      expect(view.cell(id, '2026-11-15')?.getAttribute('tabindex')).toBe('-1');
    });

    it('checks then unchecks a day the habit does not plan', async () => {
      let id = '';
      const view = await render({
        prepare: async (repo) => {
          id = (
            await repo.create({
              title: 'Gym',
              schedule: { kind: 'days', days: ['MO', 'WE', 'FR'] },
              startOn: '2026-11-01',
              reminder: null,
            })
          ).id;
        },
      });
      // Tuesday 17 is not planned.
      expect(view.cell(id, TODAY)?.className).toContain('border-dashed');
      await view.click(view.cell(id, TODAY));
      expect(view.repo.checkRows.some((c) => c.dayOn === TODAY)).toBe(true);
      expect(view.cell(id, TODAY)?.getAttribute('aria-pressed')).toBe('true');
      await view.click(view.cell(id, TODAY));
      expect(view.repo.checkRows.some((c) => c.dayOn === TODAY)).toBe(false);
      expect(view.cell(id, TODAY)?.getAttribute('aria-pressed')).toBe('false');
    });

    it('has no unplanned cell for a "N times a week" habit', async () => {
      const view = await render({
        prepare: async (repo) => {
          await repo.create({
            title: 'Gym',
            schedule: { kind: 'weekly', target: 3 },
            startOn: '2026-11-01',
            reminder: null,
          });
        },
      });
      for (const c of view.all('habits-cell')) {
        expect(c.className).not.toContain('border-dashed');
        expect(c.getAttribute('aria-label')).not.toContain('non prévu');
      }
    });

    it('names today and the reason of a disabled cell', async () => {
      let id = '';
      const view = await render({
        prepare: async (repo) => {
          id = (await seed(repo, daily('Read', '2026-11-16'))).id;
        },
      });
      expect(view.cell(id, TODAY)?.getAttribute('aria-label')).toContain("aujourd'hui");
      expect(view.cell(id, '2026-11-15')?.getAttribute('aria-label')).toContain('avant le début');
    });

    it('shows the city of a reminder set in another time zone', async () => {
      const view = await render({
        prepare: async (repo) => {
          await repo.create({
            ...daily('Read'),
            reminder: { time: '07:30', days: ['MO'], timeZone: 'America/Montreal', enabled: true },
          });
        },
      });
      expect(view.text('habits-row-reminder')).toContain('Rappel à 07:30 (Montreal)');
    });

    it('disables the cell during the call and gives the focus back afterwards', async () => {
      let id = '';
      const view = await render({
        make: (clock) => new GatedRepository(clock),
        prepare: async (repo) => {
          id = (await seed(repo, daily('Read'))).id;
        },
      });
      const repo = view.repo as GatedRepository;
      let release!: () => void;
      repo.gate = new Promise<void>((resolve) => (release = resolve));
      const target = view.cell(id, '2026-11-16');
      target?.focus();
      target?.click();
      await view.settle();
      expect(view.cell(id, '2026-11-16')?.disabled).toBe(true);
      // A real browser drops the focus of a button that becomes disabled.
      (document.activeElement as HTMLElement).blur();
      release();
      await view.settle();
      expect(view.cell(id, '2026-11-16')?.disabled).toBe(false);
      expect(document.activeElement).toBe(view.cell(id, '2026-11-16'));
    });

    it('does not steal the focus from where the user went meanwhile', async () => {
      let id = '';
      const view = await render({
        make: (clock) => new GatedRepository(clock),
        prepare: async (repo) => {
          id = (await seed(repo, daily('Read'))).id;
        },
      });
      const repo = view.repo as GatedRepository;
      let release!: () => void;
      repo.gate = new Promise<void>((resolve) => (release = resolve));
      view.cell(id, '2026-11-16')?.focus();
      view.cell(id, '2026-11-16')?.click();
      await view.settle();
      (view.q('habits-new') as HTMLElement).focus();
      release();
      await view.settle();
      expect(document.activeElement).toBe(view.q('habits-new'));
    });

    it('shifts the strip when the day changes at midnight', async () => {
      let id = '';
      const view = await render({
        prepare: async (repo) => {
          id = (await seed(repo, daily('Read'))).id;
        },
      });
      expect(view.cell(id, '2026-11-11')).not.toBeNull();
      expect(view.cell(id, '2026-11-18')).toBeNull();
      // 01:00 on the 18th in Paris.
      view.clock.advance(14 * 3_600_000);
      await view.settle(16 * 60_000);
      await view.settle();
      expect(view.cell(id, '2026-11-18')).not.toBeNull();
      expect(view.cell(id, '2026-11-11')).toBeNull();
      expect(view.cell(id, '2026-11-18')?.className).toContain('border-accent');
    });
  });
});
