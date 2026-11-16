import { ApplicationInitStatus, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideAppI18n } from '../../core/i18n';
import { FakeSettingsRepository } from '../../core/testing/fake-settings.repository';
import { FakeTimeSessionRepository } from '../../core/testing/fake-time-session.repository';
import { SYSTEM_TIME_ZONE_READER } from '../../core/time';
import { ManualClock } from '../../core/time/testing/manual-clock';
import { PendingWrites, WIDGET_CONTEXT } from '../../core/widgets';
import type { GridSize, WidgetContext } from '../../core/widgets';
import { CLOCK, DataError, SETTINGS_REPOSITORY } from '../../data';
import type { TimeSession, TimeSessionKind } from '../../data';
import { TIME_SESSION_REPOSITORY } from '../../data/schedule.tokens';
import { POMODORO_SETTINGS_SAVE_DEBOUNCE_MS } from './pomodoro-settings.component';
import { PomodoroComponent } from './pomodoro.component';
import { pomodoroDefaults } from './pomodoro.config';
import type { PomodoroConfig } from './pomodoro.config';

/** Lists a session as running until Rust completes it, as in the gap before the scheduler runs. */
class LaggingSessions extends FakeTimeSessionRepository {
  override async listRunning(): Promise<TimeSession[]> {
    this.calls.listRunning++;
    return this.items.filter((s) => s.endedAt === null);
  }

  override async history(): Promise<TimeSession[]> {
    this.calls.history++;
    return this.items.filter((s) => s.endedAt !== null);
  }
}

// 11:00 on 2026-11-16 in Paris (CET).
const NOW = '2026-11-16T10:00:00.000Z';
const MIN = 60_000;

function ended(
  id: string,
  kind: TimeSessionKind,
  startedAt: string,
  minutes: number,
  endReason: 'completed' | 'stopped' = 'completed',
): TimeSession {
  const endedAt = new Date(Date.parse(startedAt) + minutes * MIN).toISOString();
  return {
    id,
    kind,
    label: '',
    startedAt,
    endsAt: endedAt,
    endedAt,
    endReason,
    createdAt: startedAt,
    updatedAt: endedAt,
  };
}

interface Options {
  now?: string;
  config?: Partial<PomodoroConfig>;
  lag?: boolean;
  prepare?: (sessions: FakeTimeSessionRepository) => void;
}

async function render(options: Options = {}) {
  const clock = new ManualClock(options.now ?? NOW);
  const sessions = options.lag ? new LaggingSessions(clock) : new FakeTimeSessionRepository(clock);
  options.prepare?.(sessions);
  const config = signal<PomodoroConfig>({ ...pomodoroDefaults(), ...options.config });
  const saved: PomodoroConfig[] = [];
  const hooks: { update?: () => Promise<void> } = {};
  const ctx: WidgetContext<PomodoroConfig> = {
    instanceId: 'inst-1',
    type: 'pomodoro',
    config,
    size: signal<GridSize>({ w: 3, h: 4 }),
    permissions: new Set(['notifications']),
    updateConfig: (next) => {
      saved.push(next);
      config.set(next);
      return hooks.update?.() ?? Promise.resolve();
    },
  };
  TestBed.configureTestingModule({
    providers: [
      provideAppI18n(),
      { provide: WIDGET_CONTEXT, useValue: ctx },
      { provide: CLOCK, useValue: clock },
      { provide: TIME_SESSION_REPOSITORY, useValue: sessions },
      { provide: SETTINGS_REPOSITORY, useValue: new FakeSettingsRepository() },
      { provide: SYSTEM_TIME_ZONE_READER, useValue: () => 'Europe/Paris' },
    ],
  });
  await TestBed.inject(ApplicationInitStatus).donePromise;
  const fixture = TestBed.createComponent(PomodoroComponent);
  document.body.appendChild(fixture.nativeElement);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement>(id: string) => el.querySelector<T>(`[data-testid="${id}"]`);
  const all = (id: string) => Array.from(el.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`));
  const text = (id: string) => q(id)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  const settle = async (ms = 0) => {
    await vi.advanceTimersByTimeAsync(ms);
    fixture.detectChanges();
  };
  const elapse = async (ms: number) => {
    clock.advance(ms);
    await settle(ms);
  };
  const click = async (target: HTMLElement | null) => {
    if (!target) throw new Error('element not found');
    target.click();
    await settle();
  };
  const type = async (id: string, value: string) => {
    const input = q<HTMLInputElement>(id);
    if (!input) throw new Error(`input ${id} not found`);
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
  };
  await settle();
  return {
    fixture,
    el,
    clock,
    sessions,
    config,
    saved,
    hooks,
    q,
    all,
    text,
    settle,
    elapse,
    click,
    type,
  };
}

describe('PomodoroComponent', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('proposes work first, with the two other phases as secondary buttons', async () => {
    const t = await render();
    expect(t.text('pomodoro-start')).toBe('Démarrer : Travail');
    expect(t.q('pomodoro-start')?.className).toContain('btn-primary');
    expect(t.all('pomodoro-other').map((b) => b.textContent?.trim())).toEqual([
      'Pause courte',
      'Pause longue',
    ]);
    for (const b of t.all('pomodoro-other')) expect(b.className).not.toContain('btn-primary');
    expect(t.text('pomodoro-today')).toBe("Aujourd'hui : 0 pomodoro");
    expect(t.text('pomodoro-dots')).toBe('0 sur 4');
    const label = t.q<HTMLInputElement>('pomodoro-label');
    expect(t.el.querySelector(`label[for="${label?.id}"]`)).not.toBeNull();
    expect(label?.placeholder).toBe('Sur quoi travaillez-vous ?');
  });

  it('starts a work phase, counts down in 32 px without a live region and moves the focus', async () => {
    const t = await render();
    await t.type('pomodoro-label', 'Rapport');
    await t.click(t.q('pomodoro-start'));
    expect(t.sessions.items[0]).toMatchObject({ kind: 'pomodoro_work', label: 'Rapport' });
    expect(t.sessions.items[0].endsAt).toBe('2026-11-16T10:25:00.000Z');
    expect(t.text('pomodoro-phase')).toBe('Travail');
    expect(t.text('pomodoro-label-shown')).toBe('Rapport');
    expect(t.text('pomodoro-clock')).toBe('25:00');
    expect(t.q('pomodoro-clock')?.className).toContain('text-2xl');
    expect(t.q('pomodoro-clock')?.className).toContain('tabular-nums');
    expect(t.q('pomodoro-clock')?.closest('[aria-live]')).toBeNull();
    expect(document.activeElement).toBe(t.q('pomodoro-stop'));
    await t.elapse(1000);
    expect(t.text('pomodoro-clock')).toBe('24:59');
    expect(t.text('pomodoro-dots')).toBe('0 sur 4');
    expect(t.q('pomodoro-start')).toBeNull();
  });

  it('uses the configured duration', async () => {
    const t = await render({ config: { workMinutes: 50 } });
    await t.click(t.q('pomodoro-start'));
    expect(t.text('pomodoro-clock')).toBe('50:00');
  });

  it('announces the end of the phase in the status region and proposes the short break', async () => {
    const t = await render();
    expect(t.q('pomodoro-status')?.getAttribute('role')).toBe('status');
    await t.click(t.q('pomodoro-start'));
    expect(t.text('pomodoro-status')).toBe('');
    await t.elapse(25 * MIN);
    expect(t.text('pomodoro-status')).toBe("Pomodoro terminé : c'est l'heure de la pause.");
    expect(t.q('pomodoro-running')).toBeNull();
    expect(t.text('pomodoro-start')).toBe('Démarrer : Pause courte');
    expect(t.text('pomodoro-today')).toBe("Aujourd'hui : 1 pomodoro");
    expect(t.text('pomodoro-dots')).toBe('1 sur 4');
  });

  it('starts the next phase right after the deadline, before Rust completed the session', async () => {
    const t = await render({
      lag: true,
      prepare: (sessions) =>
        sessions.items.push({
          ...ended('w1', 'pomodoro_work', '2026-11-16T09:34:00.000Z', 25),
          // Past its deadline by a minute, still listed as running.
          endedAt: null,
          endReason: null,
          endsAt: '2026-11-16T09:59:00.000Z',
        }),
    });
    expect(t.sessions.items[0].endedAt).toBeNull();
    expect(t.q('pomodoro-running')).toBeNull();
    expect(t.text('pomodoro-start')).toBe('Démarrer : Pause courte');
    await t.click(t.q('pomodoro-start'));
    expect(t.sessions.calls.start).toBe(1);
    expect(t.q('pomodoro-action-error')).toBeNull();
    expect(t.text('pomodoro-phase')).toBe('Pause courte');
    expect(t.text('pomodoro-clock')).toBe('5:00');
    // Rust completed the expired work itself, with ended_at = ends_at.
    expect(t.sessions.items[0]).toMatchObject({
      endReason: 'completed',
      endedAt: '2026-11-16T09:59:00.000Z',
    });
  });

  it('runs a short break, then proposes work', async () => {
    const t = await render({ config: { shortBreakMinutes: 3 } });
    await t.click(t.q('pomodoro-start'));
    await t.elapse(25 * MIN);
    await t.click(t.q('pomodoro-start'));
    expect(t.sessions.items[1]).toMatchObject({ kind: 'pomodoro_short_break', label: '' });
    expect(t.text('pomodoro-clock')).toBe('3:00');
    expect(t.text('pomodoro-status')).toBe('');
    await t.elapse(3 * MIN);
    expect(t.text('pomodoro-status')).toBe('Pause terminée.');
    expect(t.text('pomodoro-start')).toBe('Démarrer : Travail');
  });

  it('proposes the long break after the 4th completed work (MV7)', async () => {
    const t = await render({
      config: { workMinutes: 1, shortBreakMinutes: 1 },
      prepare: (sessions) => {
        sessions.items.push(
          ended('a1', 'pomodoro_work', '2026-11-16T06:00:00.000Z', 25),
          ended('a2', 'pomodoro_short_break', '2026-11-16T06:30:00.000Z', 5),
          ended('a3', 'pomodoro_work', '2026-11-16T07:00:00.000Z', 25),
          ended('a4', 'pomodoro_short_break', '2026-11-16T07:30:00.000Z', 5),
          ended('a5', 'pomodoro_work', '2026-11-16T08:00:00.000Z', 25),
          ended('a6', 'pomodoro_short_break', '2026-11-16T08:30:00.000Z', 5),
        );
      },
    });
    expect(t.text('pomodoro-start')).toBe('Démarrer : Travail');
    expect(t.text('pomodoro-dots')).toBe('3 sur 4');
    await t.click(t.q('pomodoro-start'));
    await t.elapse(MIN);
    expect(t.text('pomodoro-start')).toBe('Démarrer : Pause longue');
    expect(t.text('pomodoro-dots')).toBe('4 sur 4');
    expect(t.text('pomodoro-today')).toBe("Aujourd'hui : 4 pomodoros");
    expect(t.all('pomodoro-other').map((b) => b.textContent?.trim())).toEqual([
      'Travail',
      'Pause courte',
    ]);
    await t.click(t.q('pomodoro-start'));
    expect(t.text('pomodoro-phase')).toBe('Pause longue');
    expect(t.text('pomodoro-clock')).toBe('15:00');
    // The cycle stays full while the long break runs, then starts over.
    expect(t.text('pomodoro-dots')).toBe('4 sur 4');
    await t.elapse(15 * MIN);
    expect(t.text('pomodoro-start')).toBe('Démarrer : Travail');
    expect(t.text('pomodoro-dots')).toBe('0 sur 4');
  });

  it('lets the user start any phase from the secondary buttons', async () => {
    const t = await render();
    await t.click(t.all('pomodoro-other')[1]);
    expect(t.sessions.items[0].kind).toBe('pomodoro_long_break');
    expect(t.text('pomodoro-clock')).toBe('15:00');
  });

  it('stops the phase without pause, proposes work again and returns the focus', async () => {
    const t = await render();
    await t.click(t.q('pomodoro-start'));
    await t.elapse(5 * MIN);
    await t.click(t.q('pomodoro-stop'));
    expect(t.sessions.items[0].endReason).toBe('stopped');
    expect(t.q('pomodoro-running')).toBeNull();
    expect(t.text('pomodoro-start')).toBe('Démarrer : Travail');
    expect(t.text('pomodoro-today')).toBe("Aujourd'hui : 0 pomodoro");
    expect(document.activeElement).toBe(t.q('pomodoro-start'));
  });

  it('explains AlreadyRunning and re-reads', async () => {
    const t = await render();
    t.sessions.failNext(new DataError('conflict', 'A pomodoro is already running'));
    await t.click(t.q('pomodoro-start'));
    const error = t.q('pomodoro-action-error');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent?.trim()).toBe('Un pomodoro est déjà en cours.');
    expect(t.q('pomodoro-load-error')).toBeNull();
    expect(t.sessions.calls.listRunning).toBeGreaterThanOrEqual(2);
    await t.click(t.q('pomodoro-start'));
    expect(t.q('pomodoro-action-error')).toBeNull();
  });

  it('separates a failed action from a failed read', async () => {
    const t = await render();
    t.sessions.failNext(new DataError('forbidden', 'Too many sessions'));
    await t.click(t.q('pomodoro-start'));
    expect(t.text('pomodoro-action-error')).toContain('Trop de sessions');
    expect(t.q('pomodoro-load-error')).toBeNull();
  });

  it('shows a failed read as such', async () => {
    const read = await render({
      prepare: (sessions) => sessions.failNext(new DataError('busy', 'busy')),
    });
    expect(read.q('pomodoro-load-error')).not.toBeNull();
  });

  it('shows the desktop-only banner outside Tauri and disables the buttons', async () => {
    const t = await render({
      prepare: (sessions) => sessions.failNext(new DataError('unavailable', 'no tauri')),
    });
    expect(t.text('pomodoro-unavailable')).toBe(
      "Disponible uniquement dans l'application Windows.",
    );
    expect(t.q<HTMLButtonElement>('pomodoro-start')?.disabled).toBe(true);
    for (const b of t.all('pomodoro-other') as HTMLButtonElement[]) expect(b.disabled).toBe(true);
  });

  it('ignores timers and stopwatches', async () => {
    const t = await render({
      prepare: (sessions) =>
        sessions.items.push({
          ...ended('c1', 'countdown', '2026-11-16T09:55:00.000Z', 30),
          endedAt: null,
          endReason: null,
        }),
    });
    expect(t.q('pomodoro-running')).toBeNull();
    expect(t.text('pomodoro-start')).toBe('Démarrer : Travail');
  });

  it('prefixes its ids with the widget instance', async () => {
    const t = await render();
    expect(t.q('pomodoro-label')?.id).toBe('pomodoro-label-inst-1');
  });

  it('empties the status region when a phase starts', async () => {
    const t = await render({ config: { shortBreakMinutes: 3 } });
    await t.click(t.q('pomodoro-start'));
    await t.elapse(25 * MIN);
    expect(t.text('pomodoro-status')).not.toBe('');
    await t.click(t.q('pomodoro-start'));
    expect(t.text('pomodoro-status')).toBe('');
  });

  it('does not announce what already ended before the widget showed', async () => {
    const t = await render({
      prepare: (sessions) =>
        sessions.items.push(ended('w0', 'pomodoro_work', '2026-11-16T09:30:00.000Z', 25)),
    });
    expect(t.text('pomodoro-status')).toBe('');
  });

  it('disables the buttons until the first read is done', async () => {
    let release = () => undefined as void;
    const t = await render({
      prepare: (sessions) => {
        vi.spyOn(sessions, 'listRunning').mockImplementation(
          () => new Promise((resolve) => (release = () => resolve([]))),
        );
      },
    });
    expect(t.q<HTMLButtonElement>('pomodoro-start')?.disabled).toBe(true);
    for (const b of t.all('pomodoro-other') as HTMLButtonElement[]) expect(b.disabled).toBe(true);
    release();
    await t.settle();
    expect(t.q<HTMLButtonElement>('pomodoro-start')?.disabled).toBe(false);
  });

  it('draws the dots from tokens, in one template', async () => {
    const t = await render();
    const dots = Array.from(t.q('pomodoro-dots')?.querySelectorAll('span[aria-hidden]') ?? []);
    expect(dots).toHaveLength(4);
    for (const dot of dots) {
      expect(dot.className).toContain('rounded-pill');
      expect(dot.className).toContain('border-fg-muted');
    }
    expect(t.all('pomodoro-dots')).toHaveLength(1);
  });

  it('returns the focus to the start button when the running phase ends', async () => {
    const t = await render();
    await t.click(t.q('pomodoro-start'));
    expect(document.activeElement).toBe(t.q('pomodoro-stop'));
    await t.elapse(25 * MIN);
    expect(t.q('pomodoro-stop')).toBeNull();
    expect(document.activeElement).toBe(t.q('pomodoro-start'));
  });

  it('leaves the focus alone when it is elsewhere as the phase ends', async () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    const t = await render();
    await t.click(t.q('pomodoro-start'));
    outside.focus();
    await t.elapse(25 * MIN);
    expect(document.activeElement).toBe(outside);
  });

  it('returns the focus to the start button when starting fails', async () => {
    const t = await render();
    t.q<HTMLInputElement>('pomodoro-label')?.focus();
    t.sessions.failNext(new DataError('busy', 'busy'));
    await t.click(t.q('pomodoro-start'));
    expect(t.q('pomodoro-action-error')).not.toBeNull();
    expect(document.activeElement).toBe(t.q('pomodoro-start'));
  });

  it('clears a failed action message after a successful re-read', async () => {
    const t = await render();
    t.sessions.failNext(new DataError('busy', 'busy'));
    await t.click(t.q('pomodoro-start'));
    expect(t.q('pomodoro-action-error')).not.toBeNull();
    window.dispatchEvent(new Event('focus'));
    await t.elapse(300);
    expect(t.q('pomodoro-action-error')).toBeNull();
  });

  it('proposes the break of a work that ended after midnight, with a counter at 0', async () => {
    // 00:15 on the 17th in Paris; the work ran 23:50 to 00:15 (22:50Z to 23:15Z on the 16th).
    const t = await render({
      now: '2026-11-16T23:15:00.000Z',
      prepare: (sessions) =>
        sessions.items.push(ended('night', 'pomodoro_work', '2026-11-16T22:50:00.000Z', 25)),
    });
    expect(t.text('pomodoro-start')).toBe('Démarrer : Pause courte');
    expect(t.text('pomodoro-today')).toBe("Aujourd'hui : 0 pomodoro");
    expect(t.text('pomodoro-dots')).toBe('0 sur 4');
  });

  it('resets the cycle when a long break is stopped', async () => {
    const works = ['00', '01', '02', '03'].map((h, i) =>
      ended(`w${i}`, 'pomodoro_work', `2026-11-16T${h}:00:00.000Z`, 25),
    );
    const t = await render({ prepare: (sessions) => sessions.items.push(...works) });
    expect(t.text('pomodoro-start')).toBe('Démarrer : Pause longue');
    await t.click(t.q('pomodoro-start'));
    await t.click(t.q('pomodoro-stop'));
    expect(t.text('pomodoro-dots')).toBe('0 sur 4');
    expect(t.text('pomodoro-start')).toBe('Démarrer : Travail');
  });

  describe('a cycle of 8', () => {
    const works = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        ended(`w${i}`, 'pomodoro_work', `2026-11-16T0${i}:00:00.000Z`, 25),
      );

    it('proposes a short break after 7 works and draws 8 dots', async () => {
      const t = await render({
        config: { longBreakEvery: 8 },
        prepare: (sessions) => sessions.items.push(...works(7)),
      });
      expect(t.text('pomodoro-start')).toBe('Démarrer : Pause courte');
      expect(t.text('pomodoro-dots')).toBe('7 sur 8');
      expect(t.q('pomodoro-dots')?.querySelectorAll('span[aria-hidden]')).toHaveLength(8);
    });

    it('proposes the long break after the 8th work', async () => {
      const t = await render({
        config: { longBreakEvery: 8 },
        prepare: (sessions) => sessions.items.push(...works(8)),
      });
      expect(t.text('pomodoro-start')).toBe('Démarrer : Pause longue');
      expect(t.text('pomodoro-dots')).toBe('8 sur 8');
    });
  });

  describe('settings', () => {
    async function openSettings(options: Options = {}) {
      const t = await render(options);
      await t.click(t.q('pomodoro-settings-open'));
      return t;
    }

    it('opens a panel with the four values and focuses the first field', async () => {
      const t = await openSettings();
      expect(t.q('pomodoro-settings')?.getAttribute('role')).toBe('group');
      expect(t.q<HTMLInputElement>('pomodoro-setting-workMinutes')?.value).toBe('25');
      expect(t.q<HTMLInputElement>('pomodoro-setting-shortBreakMinutes')?.value).toBe('5');
      expect(t.q<HTMLInputElement>('pomodoro-setting-longBreakMinutes')?.value).toBe('15');
      expect(t.q<HTMLInputElement>('pomodoro-setting-longBreakEvery')?.value).toBe('4');
      expect(document.activeElement).toBe(t.q('pomodoro-setting-workMinutes'));
      for (const key of ['workMinutes', 'longBreakEvery']) {
        const field = t.q<HTMLInputElement>(`pomodoro-setting-${key}`);
        expect(field?.id).toBe(`pomodoro-${key}-inst-1`);
        expect(t.el.querySelector(`label[for="${field?.id}"]`)).not.toBeNull();
      }
      expect(t.q('pomodoro-setting-workMinutes')?.getAttribute('type')).toBe('text');
      expect(t.q('pomodoro-setting-workMinutes')?.getAttribute('inputmode')).toBe('numeric');
    });

    it('saves 800 ms after the last keystroke and applies to the next phase', async () => {
      const t = await openSettings();
      await t.type('pomodoro-setting-workMinutes', '1');
      await t.settle(POMODORO_SETTINGS_SAVE_DEBOUNCE_MS - 1);
      expect(t.saved).toHaveLength(0);
      await t.settle(1);
      expect(t.saved).toEqual([{ ...pomodoroDefaults(), workMinutes: 1 }]);
      expect(t.text('pomodoro-settings-status')).toBe('Enregistré');
      await t.click(t.q('pomodoro-settings-back'));
      expect(t.q('pomodoro-settings')).toBeNull();
      expect(document.activeElement).toBe(t.q('pomodoro-settings-open'));
      await t.click(t.q('pomodoro-start'));
      expect(t.text('pomodoro-clock')).toBe('1:00');
    });

    it('refuses values out of bounds, decimals and empty fields without saving them', async () => {
      const t = await openSettings();
      for (const bad of ['0', '181', '2.5', '', 'abc', '1e2']) {
        await t.type('pomodoro-setting-workMinutes', bad);
        expect(t.text('pomodoro-setting-error-workMinutes'), bad).toBe(
          'Saisissez un nombre entier de 1 à 180.',
        );
        expect(t.q('pomodoro-setting-workMinutes')?.getAttribute('aria-invalid')).toBe('true');
      }
      await t.type('pomodoro-setting-longBreakEvery', '9');
      await t.type('pomodoro-setting-shortBreakMinutes', '7');
      await t.settle(POMODORO_SETTINGS_SAVE_DEBOUNCE_MS);
      // Only the valid field is written.
      expect(t.saved).toEqual([{ ...pomodoroDefaults(), shortBreakMinutes: 7 }]);
      await t.type('pomodoro-setting-workMinutes', '30');
      expect(t.q('pomodoro-setting-error-workMinutes')).toBeNull();
    });

    it('closes on Escape after writing what was typed, and returns the focus', async () => {
      const t = await openSettings();
      await t.type('pomodoro-setting-longBreakEvery', '3');
      t.q('pomodoro-settings')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      await t.settle();
      expect(t.saved).toEqual([{ ...pomodoroDefaults(), longBreakEvery: 3 }]);
      expect(t.q('pomodoro-settings')).toBeNull();
      expect(document.activeElement).toBe(t.q('pomodoro-settings-open'));
      expect(t.text('pomodoro-dots')).toBe('0 sur 3');
    });

    it('saves at once on blur', async () => {
      const t = await openSettings();
      await t.type('pomodoro-setting-workMinutes', '40');
      t.q('pomodoro-setting-workMinutes')?.dispatchEvent(new Event('blur'));
      await t.settle();
      expect(t.saved).toEqual([{ ...pomodoroDefaults(), workMinutes: 40 }]);
    });

    it('keeps the last typed value when a blur arrives during a save', async () => {
      const t = await openSettings();
      let release = () => undefined as void;
      let first = true;
      t.hooks.update = () => {
        if (!first) return Promise.resolve();
        first = false;
        return new Promise<void>((resolve) => (release = resolve));
      };
      await t.type('pomodoro-setting-workMinutes', '40');
      await t.settle(POMODORO_SETTINGS_SAVE_DEBOUNCE_MS);
      expect(t.saved).toHaveLength(1);
      await t.type('pomodoro-setting-workMinutes', '45');
      t.q('pomodoro-setting-workMinutes')?.dispatchEvent(new Event('blur'));
      release();
      await t.settle();
      await t.settle();
      expect(t.config().workMinutes).toBe(45);
      expect(t.saved.at(-1)?.workMinutes).toBe(45);
    });

    it('writes pending changes when the pending writes are flushed', async () => {
      const t = await openSettings();
      await t.type('pomodoro-setting-workMinutes', '40');
      expect(t.saved).toHaveLength(0);
      await TestBed.inject(PendingWrites).flushAll();
      expect(t.saved).toEqual([{ ...pomodoroDefaults(), workMinutes: 40 }]);
    });
  });
});
