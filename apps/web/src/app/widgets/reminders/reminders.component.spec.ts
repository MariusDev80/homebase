import { ApplicationInitStatus, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideAppI18n } from '../../core/i18n';
import { ReminderStore } from '../../core/reminders';
import { FakeReminderRepository } from '../../core/testing/fake-reminder.repository';
import { FakeSettingsRepository } from '../../core/testing/fake-settings.repository';
import { RECURRENCE_ENGINE, SYSTEM_TIME_ZONE_READER, TimeError } from '../../core/time';
import type { Occurrence, RecurrenceEngine, RecurrenceSpec } from '../../core/time';
import { ManualClock } from '../../core/time/testing/manual-clock';
import { WIDGET_CONTEXT } from '../../core/widgets';
import type { GridSize, WidgetContext } from '../../core/widgets';
import { CLOCK, DataError, SETTINGS_REPOSITORY } from '../../data';
import type { Reminder, ReminderInput } from '../../data';
import { REMINDER_REPOSITORY } from '../../data/schedule.tokens';
import { RemindersComponent } from './reminders.component';
import type { RemindersConfig } from './reminders.config';

// 11:00 on Monday 2026-11-16 in Paris (CET).
const NOW = '2026-11-16T10:00:00.000Z';

interface ExpandResult {
  readonly occurrences: readonly Occurrence[];
  readonly truncated: boolean;
}

interface FakeEngine extends RecurrenceEngine {
  validated: RecurrenceSpec[];
  expandCalls: number;
  /** Canonical form the engine answers with (default: the input as is). */
  canonical: (rrule: string | null) => string | null;
  rejectValidate: unknown;
  expandImpl: (spec: RecurrenceSpec) => Promise<ExpandResult>;
}

function occurrence(start: string): Occurrence {
  return {
    kind: 'date-time',
    key: '2026-11-17T09:00:00',
    start,
    nominalLocal: '2026-11-17T09:00:00',
    timeZone: 'Europe/Paris',
  };
}

function fakeEngine(): FakeEngine {
  const engine: FakeEngine = {
    validated: [],
    expandCalls: 0,
    canonical: (rrule) => rrule,
    rejectValidate: undefined,
    expandImpl: async () => ({
      occurrences: [occurrence('2026-11-17T08:00:00.000Z')],
      truncated: false,
    }),
    validate: async (spec) => {
      engine.validated.push(spec);
      if (engine.rejectValidate !== undefined) throw engine.rejectValidate;
      return { rrule: engine.canonical(spec.rrule), exdates: spec.exdates };
    },
    expand: async (spec) => {
      engine.expandCalls++;
      return engine.expandImpl(spec);
    },
  };
  return engine;
}

/** Like the scheduler: an enabled reminder with a future anchor gets a next occurrence. */
class SchedulingRepository extends FakeReminderRepository {
  /** Off while the test prepares its data, on for the actions under test. */
  ringing = false;

  override async create(input: ReminderInput & { readonly id?: string }): Promise<Reminder> {
    const created = await super.create(input);
    return this.ring(created.id, input);
  }

  override async update(id: string, input: ReminderInput): Promise<Reminder> {
    await super.update(id, input);
    return this.ring(id, input);
  }

  private ring(id: string, input: ReminderInput): Reminder {
    if (this.ringing && input.enabled)
      this.schedule(id, '2026-11-17T08:00:00.000Z', input.startLocal);
    return this.items.find((r) => r.id === id) as Reminder;
  }
}

async function seed(
  repo: FakeReminderRepository,
  title: string,
  options: {
    rrule?: string | null;
    at?: string | null;
    key?: string | null;
    enabled?: boolean;
  } = {},
): Promise<Reminder> {
  const input: ReminderInput = {
    title,
    startLocal: '2026-11-17T09:00:00',
    timeZone: 'Europe/Paris',
    rrule: options.rrule ?? null,
    exdates: [],
    enabled: options.enabled ?? true,
  };
  const created = await repo.create(input);
  if (options.at !== undefined) repo.schedule(created.id, options.at, options.key ?? null);
  return repo.items.find((r) => r.id === created.id) ?? created;
}

interface Options {
  /** Plain fake: every saved reminder stays without a next occurrence. */
  plain?: boolean;
  prepare?: (repo: FakeReminderRepository) => Promise<void> | void;
}

async function render(options: Options = {}) {
  const clock = new ManualClock(NOW);
  const repo = options.plain ? new FakeReminderRepository(clock) : new SchedulingRepository(clock);
  await options.prepare?.(repo);
  if (repo instanceof SchedulingRepository) repo.ringing = true;
  const engine = fakeEngine();
  const ctx: WidgetContext<RemindersConfig> = {
    instanceId: 'inst-1',
    type: 'reminders',
    config: signal<RemindersConfig>({}),
    size: signal<GridSize>({ w: 4, h: 5 }),
    permissions: new Set(['notifications']),
    updateConfig: () => Promise.resolve(),
  };
  TestBed.configureTestingModule({
    providers: [
      provideAppI18n(),
      { provide: WIDGET_CONTEXT, useValue: ctx },
      { provide: CLOCK, useValue: clock },
      { provide: REMINDER_REPOSITORY, useValue: repo },
      { provide: RECURRENCE_ENGINE, useValue: engine },
      { provide: SETTINGS_REPOSITORY, useValue: new FakeSettingsRepository() },
      { provide: SYSTEM_TIME_ZONE_READER, useValue: () => 'Europe/Paris' },
    ],
  });
  await TestBed.inject(ApplicationInitStatus).donePromise;
  const fixture = TestBed.createComponent(RemindersComponent);
  document.body.appendChild(fixture.nativeElement);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement>(id: string) => el.querySelector<T>(`[data-testid="${id}"]`);
  const all = (id: string) => Array.from(el.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`));
  const text = (id: string) => q(id)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
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
    const input = q<HTMLInputElement | HTMLSelectElement>(id);
    if (!input) throw new Error(`input ${id} not found`);
    input.value = value;
    input.dispatchEvent(new Event(event, { bubbles: true }));
    await settle();
  };
  await settle();
  return {
    fixture,
    el,
    repo,
    engine,
    store: TestBed.inject(ReminderStore),
    q,
    all,
    text,
    settle,
    click,
    type,
  };
}

describe('RemindersComponent', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('shows the empty state', async () => {
    const view = await render();
    expect(view.q('reminders-empty')).not.toBeNull();
    expect(view.q('reminders-status')?.getAttribute('role')).toBe('status');
  });

  it('lists upcoming, paused, invalid and finished reminders', async () => {
    const view = await render({
      prepare: async (repo) => {
        await seed(repo, 'Rent', {
          rrule: 'FREQ=DAILY',
          at: '2026-11-17T08:00:00.000Z',
          key: '2026-11-17T09:00:00',
        });
        await seed(repo, 'Today', { at: '2026-11-16T14:00:00.000Z', key: '2026-11-16T15:00:00' });
        await seed(repo, 'Asleep', { enabled: false });
        await seed(repo, 'Over', { at: null });
        const bad = await seed(repo, 'Broken');
        repo.items = repo.items.map((r) => (r.id === bad.id ? { ...r, status: 'invalid' } : r));
      },
    });
    const upcoming = view.all('reminders-upcoming-item').map((e) => e.textContent ?? '');
    expect(upcoming).toHaveLength(2);
    expect(upcoming[0]).toContain("Aujourd'hui 15:00");
    expect(upcoming[1]).toContain('Demain 09:00');
    expect(upcoming[1]).toContain('Récurrent');
    expect(view.all('reminders-paused-item')).toHaveLength(1);
    expect(view.all('reminders-invalid-item')).toHaveLength(1);
    const toggle = view.q('reminders-finished-toggle');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    await view.click(toggle);
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows a title as text, never as markup', async () => {
    const view = await render({
      prepare: async (repo) => {
        await seed(repo, '<b>bold</b>', {
          at: '2026-11-17T08:00:00.000Z',
          key: '2026-11-17T09:00:00',
        });
      },
    });
    expect(view.el.querySelector('b')).toBeNull();
    expect(view.el.textContent).toContain('<b>bold</b>');
  });

  it('lists the rung reminders and marks one as seen', async () => {
    const view = await render({
      prepare: async (repo) => {
        const r = await seed(repo, 'Call', { rrule: 'FREQ=DAILY' });
        repo.addDelivery({
          reminderId: r.id,
          title: 'Call',
          occurrenceKey: '2026-11-16T09:00:00',
          dueAt: '2026-11-16T08:00:00.000Z',
          skippedCount: 2,
        });
      },
    });
    expect(view.all('reminders-rung-item')).toHaveLength(1);
    expect(view.text('reminders-rung')).toContain('09:00');
    expect(view.text('reminders-skipped')).toContain('+2');
    await view.click(view.q('reminders-ok'));
    expect(view.repo.calls.markSeen).toBe(1);
    expect(view.q('reminders-rung')).toBeNull();
    expect(view.text('reminders-status')).toBe('Marqué comme vu.');
  });

  it('marks every delivery as seen', async () => {
    const view = await render({
      prepare: async (repo) => {
        const r = await seed(repo, 'Call');
        repo.addDelivery({ reminderId: r.id, occurrenceKey: '2026-11-15T09:00:00' });
        repo.addDelivery({ reminderId: r.id, occurrenceKey: '2026-11-16T09:00:00' });
      },
    });
    expect(view.all('reminders-rung-item')).toHaveLength(2);
    await view.click(view.q('reminders-mark-all'));
    expect(view.q('reminders-rung')).toBeNull();
  });

  it('keeps the rung list and shows a message when marking fails', async () => {
    const view = await render({
      prepare: async (repo) => {
        const r = await seed(repo, 'Call');
        repo.addDelivery({ reminderId: r.id });
      },
    });
    view.repo.failNext(new DataError('busy', 'busy'));
    await view.click(view.q('reminders-ok'));
    expect(view.q('reminders-action-error')).not.toBeNull();
    expect(view.q('reminders-load-error')).toBeNull();
    expect(view.all('reminders-rung-item')).toHaveLength(1);
  });

  it('shows a banner outside Tauri and disables creation', async () => {
    const view = await render({
      prepare: (repo) => repo.failNext(new DataError('unavailable', 'no')),
    });
    expect(view.text('reminders-unavailable')).toContain('Disponible uniquement');
    expect(view.q<HTMLButtonElement>('reminders-new')?.disabled).toBe(true);
    expect(view.q('reminders-empty')).toBeNull();
  });

  it('shows a read error banner', async () => {
    const view = await render({
      prepare: (repo) => repo.failNext(new DataError('unknown', 'boom')),
    });
    expect(view.q('reminders-load-error')).not.toBeNull();
  });

  describe('form', () => {
    it('refuses an empty title on the title field and writes nothing', async () => {
      const view = await render();
      await view.click(view.q('reminders-new'));
      await view.click(view.q('reminder-save'));
      expect(view.text('reminder-error-title')).toContain('titre');
      expect(view.q('reminder-title')?.getAttribute('aria-invalid')).toBe('true');
      expect(view.repo.calls.create).toBe(0);
      expect(document.activeElement).toBe(view.q('reminder-title'));
    });

    it('creates a one-shot reminder on Save, then announces it', async () => {
      const view = await render();
      await view.click(view.q('reminders-new'));
      await view.type('reminder-title', 'Pay rent');
      await view.click(view.q('reminder-save'));
      expect(view.repo.items).toHaveLength(1);
      expect(view.repo.items[0]).toMatchObject({
        title: 'Pay rent',
        startLocal: '2026-11-17T09:00:00',
        timeZone: 'Europe/Paris',
        rrule: null,
      });
      expect(view.q('reminder-form')).toBeNull();
      expect(view.text('reminders-status')).toBe('Rappel enregistré.');
    });

    it('creates a weekly series with the canonical rule', async () => {
      const view = await render();
      await view.click(view.q('reminders-new'));
      await view.type('reminder-title', 'Gym');
      await view.type('reminder-repeat', 'weekly', 'change');
      await view.click(view.q('reminder-weekday-FR'));
      await view.click(view.q('reminder-save'));
      expect(view.repo.items[0].rrule).toBe('FREQ=WEEKLY;BYDAY=TU,FR');
    });

    it('refuses a past date on the date field', async () => {
      const view = await render();
      await view.click(view.q('reminders-new'));
      await view.type('reminder-title', 'Late');
      await view.type('reminder-date', '2026-11-10');
      await view.click(view.q('reminder-save'));
      expect(view.text('reminder-error-date')).toBe('Cette date est passée.');
      expect(view.repo.calls.create).toBe(0);
    });

    it('shows a gap warning', async () => {
      const view = await render();
      await view.click(view.q('reminders-new'));
      await view.type('reminder-date', '2027-03-28');
      await view.type('reminder-time', '02:30');
      expect(view.text('reminder-warning')).toContain('03:30');
    });

    it('shows a refusal of the command on the right field', async () => {
      const view = await render();
      await view.click(view.q('reminders-new'));
      await view.type('reminder-title', 'x');
      view.repo.failNext(
        new DataError('invalid_input', 'bad', { cause: { kind: 'invalid_input', field: 'title' } }),
      );
      await view.click(view.q('reminder-save'));
      expect(view.q('reminder-error-title')).not.toBeNull();
      expect(view.q('reminder-form-error')).toBeNull();
    });

    it('shows a refusal without a field on the form', async () => {
      const view = await render();
      await view.click(view.q('reminders-new'));
      await view.type('reminder-title', 'x');
      view.repo.failNext(new DataError('forbidden', 'limit'));
      await view.click(view.q('reminder-save'));
      expect(view.text('reminder-form-error')).toContain('Trop de rappels');
    });

    it('cancels with Escape and gives the focus back to the opener', async () => {
      const view = await render({
        prepare: async (repo) => {
          await seed(repo, 'Rent', { at: '2026-11-17T08:00:00.000Z', key: '2026-11-17T09:00:00' });
        },
      });
      const opener = view.q('reminders-detail');
      await view.click(opener);
      expect(view.q('reminder-form')).not.toBeNull();
      view.q('reminder-form')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await view.settle();
      expect(view.q('reminder-form')).toBeNull();
      expect(view.repo.calls.update).toBe(0);
      expect(document.activeElement).toBe(view.q('reminders-detail'));
    });

    it('skips the next occurrence of a series', async () => {
      const view = await render({
        prepare: async (repo) => {
          await seed(repo, 'Rent', {
            rrule: 'FREQ=DAILY',
            at: '2026-11-17T08:00:00.000Z',
            key: '2026-11-17T09:00:00',
          });
        },
      });
      await view.click(view.q('reminders-detail'));
      await view.click(view.q('reminder-skip'));
      expect(view.repo.items[0].exdates).toEqual(['2026-11-17T09:00:00']);
      expect(view.text('reminders-status')).toBe('Prochaine occurrence ignorée.');
    });

    it('offers no skip for a one-shot reminder', async () => {
      const view = await render({
        prepare: async (repo) => {
          await seed(repo, 'Once', { at: '2026-11-17T08:00:00.000Z', key: '2026-11-17T09:00:00' });
        },
      });
      await view.click(view.q('reminders-detail'));
      expect(view.q('reminder-skip')).toBeNull();
    });

    it('asks for a confirmation before deleting', async () => {
      const view = await render({
        prepare: async (repo) => {
          await seed(repo, 'Once', { at: '2026-11-17T08:00:00.000Z', key: '2026-11-17T09:00:00' });
        },
      });
      await view.click(view.q('reminders-detail'));
      await view.click(view.q('reminder-delete'));
      expect(view.repo.items).toHaveLength(1);
      await view.click(view.q('reminder-delete-confirm'));
      expect(view.repo.items).toHaveLength(0);
      expect(view.text('reminders-status')).toBe('Rappel supprimé.');
    });

    it('keeps a rule outside the choices read-only', async () => {
      const view = await render({
        prepare: async (repo) => {
          await seed(repo, 'Odd', {
            rrule: 'FREQ=MONTHLY;BYMONTHDAY=5',
            at: '2026-12-05T08:00:00.000Z',
            key: '2026-12-05T09:00:00',
          });
        },
      });
      await view.click(view.q('reminders-detail'));
      expect(view.q('reminder-custom')?.textContent).toContain('FREQ=MONTHLY;BYMONTHDAY=5');
      expect(view.q<HTMLSelectElement>('reminder-repeat')?.disabled).toBe(true);
    });
  });
  describe('preview', () => {
    it('shows the preview even with an empty title', async () => {
      const view = await render();
      await view.click(view.q('reminders-new'));
      await view.settle(200);
      expect(view.all('reminder-preview-item')).toHaveLength(1);
    });

    it('does not ask the engine again when only the title changes', async () => {
      const view = await render();
      await view.click(view.q('reminders-new'));
      await view.settle(200);
      const before = view.engine.expandCalls;
      expect(before).toBe(1);
      await view.type('reminder-title', 'Pay rent');
      await view.settle(500);
      expect(view.engine.expandCalls).toBe(before);
      await view.type('reminder-time', '10:00');
      await view.settle(200);
      expect(view.engine.expandCalls).toBe(before + 1);
    });

    it('waits for the typing to pause before asking the engine', async () => {
      const view = await render();
      await view.click(view.q('reminders-new'));
      await view.type('reminder-time', '10:00');
      await view.settle(100);
      await view.type('reminder-time', '11:00');
      await view.settle(100);
      expect(view.engine.expandCalls).toBe(0);
      await view.settle(200);
      expect(view.engine.expandCalls).toBe(1);
    });

    it('lets a late answer lose against the latest one', async () => {
      const view = await render();
      const pending: ((r: ExpandResult) => void)[] = [];
      view.engine.expandImpl = () => new Promise<ExpandResult>((resolve) => pending.push(resolve));
      await view.click(view.q('reminders-new'));
      await view.settle(200);
      await view.type('reminder-time', '10:00');
      await view.settle(200);
      expect(pending).toHaveLength(2);
      const answer = (start: string): ExpandResult => ({
        occurrences: [occurrence(start)],
        truncated: false,
      });
      pending[1](answer('2026-11-17T10:00:00.000Z'));
      await view.settle();
      pending[0](answer('2026-11-17T08:00:00.000Z'));
      await view.settle();
      const text = view.text('reminder-preview') ?? '';
      expect(text).toContain('11:00');
      expect(text).not.toContain('09:00');
    });

    it('has no preview for a disabled reminder', async () => {
      const view = await render();
      await view.click(view.q('reminders-new'));
      await view.settle(200);
      expect(view.q('reminder-preview')).not.toBeNull();
      await view.click(view.q('reminder-enabled'));
      expect(view.q('reminder-preview')).toBeNull();
    });
  });

  describe('save', () => {
    it('stores the canonical form returned by the engine', async () => {
      const view = await render();
      view.engine.canonical = (rrule) =>
        rrule?.replace('FREQ=DAILY', 'FREQ=DAILY;INTERVAL=1') ?? null;
      await view.click(view.q('reminders-new'));
      await view.type('reminder-title', 'Daily');
      await view.type('reminder-repeat', 'daily', 'change');
      await view.click(view.q('reminder-save'));
      expect(view.engine.validated[0].rrule).toBe('FREQ=DAILY');
      expect(view.repo.items[0].rrule).toBe('FREQ=DAILY;INTERVAL=1');
    });

    it('updates an existing reminder and turns it off', async () => {
      const view = await render({
        prepare: async (repo) => {
          await seed(repo, 'Rent', { at: '2026-11-17T08:00:00.000Z', key: '2026-11-17T09:00:00' });
        },
      });
      await view.click(view.q('reminders-detail'));
      await view.type('reminder-title', 'Rent 2');
      await view.click(view.q('reminder-enabled'));
      await view.click(view.q('reminder-save'));
      expect(view.repo.calls.update).toBe(1);
      expect(view.repo.items[0]).toMatchObject({ title: 'Rent 2', enabled: false });
      expect(view.q('reminder-form')).toBeNull();
    });

    it('saves a series that ends on a chosen day', async () => {
      const view = await render();
      await view.click(view.q('reminders-new'));
      await view.type('reminder-title', 'Course');
      await view.type('reminder-repeat', 'daily', 'change');
      expect(view.q('reminder-until')).toBeNull();
      await view.type('reminder-end', 'until', 'change');
      await view.type('reminder-until', '2026-12-31');
      await view.click(view.q('reminder-save'));
      expect(view.repo.items[0].rrule).toBe('FREQ=DAILY;UNTIL=20261231T225959Z');
    });

    it('refuses an end date beyond 10 years on the end date field', async () => {
      const view = await render();
      await view.click(view.q('reminders-new'));
      await view.type('reminder-title', 'Course');
      await view.type('reminder-repeat', 'daily', 'change');
      await view.type('reminder-end', 'until', 'change');
      await view.type('reminder-until', '2199-12-31');
      await view.click(view.q('reminder-save'));
      expect(view.text('reminder-error-until')).toContain('10 ans');
      expect(view.repo.calls.create).toBe(0);
    });

    it('keeps the exceptions added since the panel opened', async () => {
      const view = await render({
        prepare: async (repo) => {
          await seed(repo, 'Rent', {
            rrule: 'FREQ=DAILY',
            at: '2026-11-17T08:00:00.000Z',
            key: '2026-11-17T09:00:00',
          });
        },
      });
      await view.click(view.q('reminders-detail'));
      view.repo.items = view.repo.items.map((r) => ({ ...r, exdates: ['2026-11-18T09:00:00'] }));
      await view.store.refresh();
      await view.type('reminder-title', 'Rent 2');
      await view.click(view.q('reminder-save'));
      expect(view.repo.items[0].exdates).toEqual(['2026-11-18T09:00:00']);
    });

    it('can rename a finished reminder whose date is past', async () => {
      const view = await render({
        prepare: async (repo) => {
          const r = await repo.create({
            title: 'Old',
            startLocal: '2026-11-01T09:00:00',
            timeZone: 'Europe/Paris',
            rrule: null,
            exdates: [],
            enabled: true,
          });
          repo.schedule(r.id, null, null);
        },
      });
      await view.click(view.q('reminders-detail'));
      await view.type('reminder-title', 'Older');
      await view.click(view.q('reminder-save'));
      expect(view.q('reminder-error-date')).toBeNull();
      expect(view.repo.items[0].title).toBe('Older');
    });

    it('warns instead of announcing a success when nothing will ring', async () => {
      const view = await render({ plain: true });
      await view.click(view.q('reminders-new'));
      await view.type('reminder-title', 'Silent');
      await view.click(view.q('reminder-save'));
      expect(view.repo.items).toHaveLength(1);
      expect(view.text('reminders-notice')).toContain('ne sonnera pas');
      expect(view.text('reminders-status')).toContain('ne sonnera pas');
    });
  });

  describe('engine and command refusals', () => {
    it('shows an invalid rule on the repetition field', async () => {
      const view = await render();
      await view.click(view.q('reminders-new'));
      await view.type('reminder-title', 'x');
      view.engine.rejectValidate = new TimeError('invalid_rule', 'x', { rule: 'syntax' });
      await view.click(view.q('reminder-save'));
      expect(view.q('reminder-error-repeat')).not.toBeNull();
      expect(view.repo.calls.create).toBe(0);
    });

    it('shows an unknown time zone on the form', async () => {
      const view = await render();
      await view.click(view.q('reminders-new'));
      await view.type('reminder-title', 'x');
      view.engine.rejectValidate = new TimeError('unknown_time_zone', 'x');
      await view.click(view.q('reminder-save'));
      expect(view.text('reminder-form-error')).toContain('refusées');
    });

    it('puts an error of a custom rule under the rule text, not on a hidden field', async () => {
      const view = await render({
        prepare: async (repo) => {
          await seed(repo, 'Odd', {
            rrule: 'FREQ=MONTHLY;BYMONTHDAY=5',
            at: '2026-12-05T08:00:00.000Z',
            key: '2026-12-05T09:00:00',
          });
        },
      });
      await view.click(view.q('reminders-detail'));
      view.engine.rejectValidate = new TimeError('invalid_rule', 'x', {
        rule: 'until_before_start',
      });
      await view.click(view.q('reminder-save'));
      expect(view.q('reminder-error-custom')).not.toBeNull();
      expect(view.q('reminder-custom')?.getAttribute('aria-describedby')).toBe(
        view.q('reminder-error-custom')?.id,
      );
      expect(view.q('reminder-error-until')).toBeNull();
      expect(view.q('reminder-form-error')).toBeNull();
    });
  });

  describe('skip and discard', () => {
    async function series() {
      return render({
        prepare: async (repo) => {
          await seed(repo, 'Rent', {
            rrule: 'FREQ=DAILY',
            at: '2026-11-17T08:00:00.000Z',
            key: '2026-11-17T09:00:00',
          });
        },
      });
    }

    it('names the occurrence on the skip button', async () => {
      const view = await series();
      await view.click(view.q('reminders-detail'));
      expect(view.text('reminder-skip')).toMatch(/Ignorer l'occurrence du mar\.? 17 nov\.?, 09:00/);
    });

    it('asks to click again when the next occurrence moved since opening', async () => {
      const view = await series();
      await view.click(view.q('reminders-detail'));
      view.repo.schedule(view.repo.items[0].id, '2026-11-18T08:00:00.000Z', '2026-11-18T09:00:00');
      await view.store.refresh();
      await view.settle();
      expect(view.text('reminder-skip')).toContain('18 nov');
      await view.click(view.q('reminder-skip'));
      expect(view.repo.calls.update).toBe(0);
      expect(view.q('reminder-skip-note')?.textContent).toContain('a changé');
      await view.click(view.q('reminder-skip'));
      expect(view.repo.items[0].exdates).toEqual(['2026-11-18T09:00:00']);
    });

    it('says so when no occurrence is left', async () => {
      const view = await series();
      await view.click(view.q('reminders-detail'));
      view.repo.schedule(view.repo.items[0].id, null, null);
      await view.store.refresh();
      await view.click(view.q('reminder-skip'));
      expect(view.repo.calls.update).toBe(0);
      expect(view.q('reminder-skip-note')?.textContent).toContain("plus d'occurrence");
    });

    it('asks before dropping typed changes', async () => {
      const view = await render();
      await view.click(view.q('reminders-new'));
      await view.type('reminder-title', 'half');
      await view.click(view.q('reminder-cancel'));
      expect(view.q('reminder-discard')).not.toBeNull();
      expect(view.q('reminder-form')).not.toBeNull();
      await view.click(view.q('reminder-keep'));
      expect(view.q('reminder-discard')).toBeNull();
      view.q('reminder-form')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await view.settle();
      expect(view.q('reminder-discard')).not.toBeNull();
      await view.click(view.q('reminder-discard-confirm'));
      expect(view.q('reminder-form')).toBeNull();
      expect(view.repo.calls.create).toBe(0);
    });

    it('goes back at once when nothing was typed', async () => {
      const view = await render();
      await view.click(view.q('reminders-new'));
      await view.click(view.q('reminder-back'));
      expect(view.q('reminder-form')).toBeNull();
    });
  });

  describe('unreadable reminders', () => {
    function corrupt(repo: FakeReminderRepository, change: Partial<Reminder>): void {
      repo.items = repo.items.map((r) => ({ ...r, ...change }));
    }

    it('deletes an invalid reminder after an inline confirmation, title first', async () => {
      const view = await render({
        prepare: async (repo) => {
          await seed(repo, 'Broken');
          corrupt(repo, {
            status: 'invalid',
            startLocal: 'bad' as Reminder['startLocal'],
            timeZone: 'Nope/Zone',
            rrule: 'garbage',
          });
        },
      });
      const row = view.q('reminders-invalid-item');
      expect(row?.textContent?.trim().startsWith('Broken')).toBe(true);
      expect(view.q('reminders-detail')).toBeNull();
      await view.click(view.q('reminders-invalid-delete'));
      expect(view.repo.items).toHaveLength(1);
      await view.click(view.q('reminders-invalid-confirm'));
      expect(view.repo.items).toHaveLength(0);
      expect(view.text('reminders-status')).toBe('Rappel supprimé.');
    });

    it('opens a reminder with a malformed anchor on a readable fallback', async () => {
      const view = await render({
        prepare: async (repo) => {
          await seed(repo, 'Odd', {
            rrule: 'FREQ=NOPE',
            at: '2026-12-05T08:00:00.000Z',
            key: null,
          });
          corrupt(repo, { startLocal: 'bad' as Reminder['startLocal'] });
        },
      });
      await view.click(view.q('reminders-detail'));
      expect(view.q('reminder-form')).not.toBeNull();
      expect(view.q('reminder-unreadable')).not.toBeNull();
      expect(view.q<HTMLInputElement>('reminder-title')?.value).toBe('Odd');
    });

    it('survives an unknown time zone and reports it on save', async () => {
      const view = await render({
        prepare: async (repo) => {
          await seed(repo, 'Zoned', { at: '2026-12-05T08:00:00.000Z', key: '2026-12-05T09:00:00' });
          corrupt(repo, { timeZone: 'Nope/Zone' });
        },
      });
      await view.click(view.q('reminders-detail'));
      expect(view.q('reminder-form')).not.toBeNull();
      await view.type('reminder-title', 'Zoned 2');
      await view.click(view.q('reminder-save'));
      expect(view.q('reminder-form-error')).not.toBeNull();
      expect(view.repo.calls.update).toBe(0);
    });

    it('shows a rule it cannot read as a custom rule', async () => {
      const view = await render({
        prepare: async (repo) => {
          await seed(repo, 'Garbage', {
            rrule: 'not a rule',
            at: '2026-12-05T08:00:00.000Z',
            key: '2026-12-05T09:00:00',
          });
        },
      });
      await view.click(view.q('reminders-detail'));
      expect(view.q('reminder-custom')?.textContent).toContain('not a rule');
    });

    it('puts a scheduled reminder without a next occurrence last, with a readable label', async () => {
      const view = await render({
        prepare: async (repo) => {
          const r = await seed(repo, 'Nothing');
          await seed(repo, 'Soon', { at: '2026-11-17T08:00:00.000Z', key: '2026-11-17T09:00:00' });
          repo.items = repo.items.map((x) =>
            x.id === r.id ? { ...x, status: 'scheduled', nextFireAt: null } : x,
          );
        },
      });
      const items = view.all('reminders-upcoming-item');
      expect(items[0].textContent).toContain('Soon');
      expect(items[1].textContent).toContain('Aucune occurrence à venir');
    });
  });
});
