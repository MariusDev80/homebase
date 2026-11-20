import { ApplicationInitStatus, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideAppI18n } from '../../core/i18n';
import { HabitStore } from '../../core/habits';
import { FakeHabitRepository } from '../../core/testing/fake-habit.repository';
import { FakeSettingsRepository } from '../../core/testing/fake-settings.repository';
import { SYSTEM_TIME_ZONE_READER } from '../../core/time';
import { Temporal } from '../../core/time/temporal';
import { ManualClock } from '../../core/time/testing/manual-clock';
import { WIDGET_CONTEXT } from '../../core/widgets';
import type { GridSize, WidgetContext } from '../../core/widgets';
import { CLOCK, DataError, SETTINGS_REPOSITORY } from '../../data';
import type { Habit, HabitInput, LocalDateIso } from '../../data';
import { HABIT_REPOSITORY } from '../../data/schedule.tokens';
import { HabitHistoryComponent } from './habit-history.component';
import type { HabitsConfig } from './habits.config';

// 11:00 on Tuesday 2026-11-17 in Paris (CET).
const NOW = '2026-11-17T10:00:00.000Z';
const ALL = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

function daily(startOn: string, title = 'Lire'): HabitInput {
  return { title, schedule: { kind: 'days', days: [...ALL] }, startOn, reminder: null };
}

/** A check that waits for the test to let it through, or fails. */
class ProbeRepository extends FakeHabitRepository {
  gate: Promise<void> | null = null;
  failing = false;

  override async setCheck(habitId: string, dayOn: LocalDateIso, done: boolean): Promise<boolean> {
    if (this.gate !== null) await this.gate;
    if (this.failing) throw new DataError('unknown', 'boom');
    return super.setCheck(habitId, dayOn, done);
  }
}

async function render(input: HabitInput, checked: readonly LocalDateIso[] = [], now = NOW) {
  const clock = new ManualClock(now);
  const repo = new ProbeRepository(clock);
  const habit: Habit = await repo.create(input);
  for (const day of checked) await repo.setCheck(habit.id, day, true);
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
  const store = TestBed.inject(HabitStore);
  const fixture = TestBed.createComponent(HabitHistoryComponent);
  document.body.appendChild(fixture.nativeElement);
  fixture.componentRef.setInput('habit', habit);
  const settle = async (ms = 0) => {
    await vi.advanceTimersByTimeAsync(ms);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
  };
  await settle();
  const el = fixture.nativeElement as HTMLElement;
  const cell = (day: string) =>
    el.querySelector<HTMLButtonElement>(`[data-testid="habit-history-cell"][data-day="${day}"]`);
  const cells = () => Array.from(el.querySelectorAll<HTMLButtonElement>('[data-day]'));
  const text = (id: string) =>
    el.querySelector(`[data-testid="${id}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  const key = async (target: HTMLElement | null, name: string) => {
    if (!target) throw new Error('element not found');
    target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
    await settle();
  };
  return { el, habit, store, cell, cells, text, key, settle, fixture, clock, repo };
}

let release!: () => void;

describe('HabitHistoryComponent', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('draws 5 weeks from Monday, without future days', async () => {
    const view = await render(daily('2026-10-01'));
    const weeks = Array.from(view.el.querySelectorAll('[data-testid="habit-history-week"]'));
    expect(weeks).toHaveLength(5);
    expect(weeks.map((w) => w.querySelectorAll('[data-day]').length)).toEqual([7, 7, 7, 7, 2]);
    expect(view.cells()[0].dataset['day']).toBe('2026-10-19');
    expect(view.cell('2026-11-17')).not.toBeNull();
    expect(view.cell('2026-11-18')).toBeNull();
  });

  it('disables days before the start, dashes unplanned days and marks today', async () => {
    const view = await render({
      title: 'Sport',
      schedule: { kind: 'days', days: ['MO', 'WE'] },
      startOn: '2026-11-10',
      reminder: null,
    });
    expect(view.cell('2026-11-09')?.disabled).toBe(true);
    expect(view.cell('2026-11-09')?.getAttribute('aria-label')).toContain('avant le début');
    expect(view.cell('2026-11-10')?.disabled).toBe(false);
    expect(view.cell('2026-11-10')?.className).toContain('border-dashed');
    expect(view.cell('2026-11-10')?.getAttribute('aria-label')).toContain('jour non prévu');
    expect(view.cell('2026-11-11')?.className).not.toContain('border-dashed');
    const today = view.cell('2026-11-17');
    expect(today?.className).toContain('border-accent');
    expect(today?.getAttribute('aria-label')).toContain("aujourd'hui");
  });

  it('treats every day of a weekly habit as planned', async () => {
    const view = await render({
      title: 'Yoga',
      schedule: { kind: 'weekly', target: 3 },
      startOn: '2026-10-01',
      reminder: null,
    });
    expect(view.el.querySelector('.border-dashed')).toBeNull();
  });

  it('shows done cells with a check and the streak and rate of habit-stats (C6)', async () => {
    const days = ['10', '11', '12', '13', '14', '15'].map((d) => `2026-11-${d}`);
    const view = await render(daily('2026-11-10'), days);
    expect(view.cell('2026-11-12')?.className).toContain('bg-success-emphasis');
    expect(view.cell('2026-11-12')?.querySelector('.pi-check')).not.toBeNull();
    expect(view.cell('2026-11-12')?.getAttribute('aria-pressed')).toBe('true');
    // 11-16 is not checked: the streak is broken at once.
    expect(view.text('habit-history-streak')).toBe('Série actuelle : aucune');
    expect(view.text('habit-history-rate')).toBe('Réussite sur 30 jours : 86 % (6/7)');
  });

  it('counts a streak in planned days, today still pending (C1)', async () => {
    const days = ['10', '11', '12', '13', '14', '15', '16'].map((d) => `2026-11-${d}`);
    const view = await render(daily('2026-11-10'), days);
    expect(view.text('habit-history-streak')).toBe("Série actuelle : 7 jours prévus d'affilée");
    expect(view.text('habit-history-rate')).toBe('Réussite sur 30 jours : 100 % (7/7)');
  });

  it('shows weekly stats and the no-data text', async () => {
    const empty = await render({
      title: 'Yoga',
      schedule: { kind: 'weekly', target: 1 },
      startOn: '2026-11-17',
      reminder: null,
    });
    expect(empty.text('habit-history-rate')).toBe('Réussite : pas encore de données');
    expect(empty.text('habit-history-streak')).toBe('Série actuelle : aucune');
    TestBed.resetTestingModule();
    document.body.innerHTML = '';
    const done = await render(
      {
        title: 'Yoga',
        schedule: { kind: 'weekly', target: 2 },
        startOn: '2026-11-02',
        reminder: null,
      },
      ['2026-11-03', '2026-11-05', '2026-11-09', '2026-11-12'],
    );
    expect(done.text('habit-history-rate')).toBe('Sur 4 semaines : 2/2');
    expect(done.text('habit-history-streak')).toBe("Série actuelle : 2 semaines d'affilée");
  });

  it('checks and unchecks a day through the store, optimistically', async () => {
    const view = await render(daily('2026-11-10'));
    view.cell('2026-11-17')?.click();
    await view.settle();
    expect(view.store.checks().get(view.habit.id)?.has('2026-11-17')).toBe(true);
    expect(view.cell('2026-11-17')?.getAttribute('aria-pressed')).toBe('true');
    expect(view.text('habit-history-streak')).toBe("Série actuelle : 1 jour prévu d'affilée");
    view.cell('2026-11-17')?.click();
    await view.settle();
    expect(view.cell('2026-11-17')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps the focus on the cell after a check', async () => {
    const view = await render(daily('2026-11-10'));
    view.cell('2026-11-16')?.focus();
    view.cell('2026-11-16')?.click();
    await view.settle();
    await view.settle();
    expect(document.activeElement).toBe(view.cell('2026-11-16'));
  });

  it('has a single tab stop for the grid, on today', async () => {
    const view = await render(daily('2026-10-01'));
    const stops = view.cells().filter((c) => c.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(stops[0].dataset['day']).toBe('2026-11-17');
  });

  it('moves by day with left/right and by 7 days with up/down', async () => {
    const view = await render(daily('2026-10-01'));
    view.cell('2026-11-17')?.focus();
    await view.key(view.cell('2026-11-17'), 'ArrowLeft');
    expect(document.activeElement).toBe(view.cell('2026-11-16'));
    await view.key(view.cell('2026-11-16'), 'ArrowUp');
    expect(document.activeElement).toBe(view.cell('2026-11-09'));
    expect(view.cell('2026-11-09')?.tabIndex).toBe(0);
    expect(view.cells().filter((c) => c.tabIndex === 0)).toHaveLength(1);
    await view.key(view.cell('2026-11-09'), 'ArrowDown');
    expect(document.activeElement).toBe(view.cell('2026-11-16'));
    // No future day: down from 11-17 stays put; right stops at today.
    await view.key(view.cell('2026-11-16'), 'ArrowRight');
    await view.key(view.cell('2026-11-17'), 'ArrowDown');
    expect(document.activeElement).toBe(view.cell('2026-11-17'));
    await view.key(view.cell('2026-11-17'), 'ArrowRight');
    expect(document.activeElement).toBe(view.cell('2026-11-17'));
  });

  it('does not go above the first week or before the start date', async () => {
    const view = await render(daily('2026-11-12'));
    view.cell('2026-11-17')?.focus();
    await view.key(view.cell('2026-11-17'), 'ArrowUp');
    expect(document.activeElement).toBe(view.cell('2026-11-17'));
    view.cell('2026-11-12')?.focus();
    await view.key(view.cell('2026-11-12'), 'ArrowLeft');
    expect(document.activeElement).toBe(view.cell('2026-11-12'));
    await view.key(view.cell('2026-11-12'), 'Home');
    expect(document.activeElement).toBe(view.cell('2026-11-12'));
    await view.key(view.cell('2026-11-12'), 'End');
    expect(document.activeElement).toBe(view.cell('2026-11-17'));
  });

  it('gives the focus back after a check, like the strip', async () => {
    const view = await render(daily('2026-11-10'));
    view.repo.gate = new Promise<void>((resolve) => (release = resolve));
    view.cell('2026-11-16')?.focus();
    view.cell('2026-11-16')?.click();
    await view.settle();
    expect(view.cell('2026-11-16')?.disabled).toBe(true);
    (document.activeElement as HTMLElement).blur();
    release();
    await view.settle();
    await view.settle();
    expect(view.cell('2026-11-16')?.disabled).toBe(false);
    expect(document.activeElement).toBe(view.cell('2026-11-16'));
  });

  it('does not steal the focus from where the user went meanwhile', async () => {
    const view = await render(daily('2026-11-10'));
    const other = document.createElement('button');
    document.body.appendChild(other);
    view.repo.gate = new Promise<void>((resolve) => (release = resolve));
    view.cell('2026-11-16')?.focus();
    view.cell('2026-11-16')?.click();
    await view.settle();
    other.focus();
    release();
    await view.settle();
    await view.settle();
    expect(document.activeElement).toBe(other);
  });

  it('asks for no focus once destroyed (no NG0911, no unhandled rejection)', async () => {
    const view = await render(daily('2026-11-10'));
    view.repo.gate = new Promise<void>((resolve) => (release = resolve));
    view.cell('2026-11-16')?.click();
    await view.settle();
    view.fixture.destroy();
    release();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(view.fixture.componentRef.hostView.destroyed).toBe(true);
  });

  it('gives the tab stop back to today when the focus leaves the grid', async () => {
    const view = await render(daily('2026-10-01'));
    const other = document.createElement('button');
    document.body.appendChild(other);
    view.cell('2026-11-12')?.focus();
    await view.settle();
    expect(view.cell('2026-11-12')?.tabIndex).toBe(0);
    other.focus();
    await view.settle();
    expect(view.cell('2026-11-12')?.tabIndex).toBe(-1);
    expect(view.cell('2026-11-17')?.tabIndex).toBe(0);
  });

  it('shows an error when a check fails, and clears it after a successful re-read', async () => {
    const view = await render(daily('2026-11-10'));
    view.repo.failing = true;
    view.cell('2026-11-16')?.click();
    await view.settle();
    expect(view.el.querySelector('[data-testid="habit-history-error"]')).not.toBeNull();
    view.repo.failing = false;
    view.cell('2026-11-15')?.click();
    await view.settle();
    expect(view.el.querySelector('[data-testid="habit-history-error"]')).toBeNull();
  });

  it('shows 57+ style when the streak reaches the end of the loaded window', async () => {
    const days: LocalDateIso[] = [];
    for (let i = 1; i <= 399; i++) {
      days.push(Temporal.PlainDate.from('2026-11-17').subtract({ days: i }).toString());
    }
    const view = await render(daily('2025-01-01'), days);
    expect(view.text('habit-history-streak')).toMatch(/^Série actuelle : \d+\+ jours prévus/);
  });

  it('says 1 semaine for a one-week streak', async () => {
    const view = await render(
      {
        title: 'Yoga',
        schedule: { kind: 'weekly', target: 1 },
        startOn: '2026-11-02',
        reminder: null,
      },
      ['2026-11-17'],
    );
    expect(view.text('habit-history-streak')).toBe("Série actuelle : 1 semaine d'affilée");
  });

  it('shifts the grid at midnight, Tuesday to Wednesday', async () => {
    const view = await render(daily('2026-10-01'));
    expect(view.cell('2026-11-18')).toBeNull();
    view.clock.advance(14 * 3_600_000);
    await view.settle(16 * 60_000);
    await view.settle();
    expect(view.cell('2026-11-18')?.className).toContain('border-accent');
    expect(view.cell('2026-11-17')?.className).not.toContain('border-accent');
    const weeks = Array.from(view.el.querySelectorAll('[data-testid="habit-history-week"]'));
    expect(weeks.map((w) => w.querySelectorAll('[data-day]').length)).toEqual([7, 7, 7, 7, 3]);
  });

  it('starts a new row at midnight, Sunday to Monday', async () => {
    const view = await render(daily('2026-10-01'), [], '2026-11-22T10:00:00.000Z');
    const count = () =>
      Array.from(view.el.querySelectorAll('[data-testid="habit-history-week"]')).map(
        (w) => w.querySelectorAll('[data-day]').length,
      );
    expect(count()).toEqual([7, 7, 7, 7, 7]);
    expect(view.cells()[0].dataset['day']).toBe('2026-10-19');
    view.clock.advance(14 * 3_600_000);
    await view.settle(16 * 60_000);
    await view.settle();
    expect(count()).toEqual([7, 7, 7, 7, 1]);
    expect(view.cells()[0].dataset['day']).toBe('2026-10-26');
    expect(view.cell('2026-11-23')?.className).toContain('border-accent');
  });

  it('has one cell in the last row on a Monday', async () => {
    const view = await render(daily('2026-10-01'), [], '2026-11-16T10:00:00.000Z');
    const weeks = Array.from(view.el.querySelectorAll('[data-testid="habit-history-week"]'));
    expect(weeks.map((w) => w.querySelectorAll('[data-day]').length)).toEqual([7, 7, 7, 7, 1]);
  });

  it('leaves nothing focusable when every day is before the start date', async () => {
    const view = await render(daily('2026-11-18'));
    expect(view.cells().every((c) => c.disabled && c.tabIndex === -1)).toBe(true);
  });
});
