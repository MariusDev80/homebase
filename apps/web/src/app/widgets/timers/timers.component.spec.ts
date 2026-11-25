import { ApplicationInitStatus, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideAppI18n } from '../../core/i18n';
import { ReminderStore } from '../../core/reminders';
import { FakeReminderRepository } from '../../core/testing/fake-reminder.repository';
import { FakeSettingsRepository } from '../../core/testing/fake-settings.repository';
import { FakeTimeSessionRepository } from '../../core/testing/fake-time-session.repository';
import { SYSTEM_TIME_ZONE_READER, resolveLocal } from '../../core/time';
import { ManualClock } from '../../core/time/testing/manual-clock';
import { PendingWrites, WIDGET_CONTEXT } from '../../core/widgets';
import type { GridSize, WidgetContext } from '../../core/widgets';
import { CLOCK, DataError, SETTINGS_REPOSITORY } from '../../data';
import type { Reminder, ReminderInput, TimeSession } from '../../data';
import { REMINDER_REPOSITORY, TIME_SESSION_REPOSITORY } from '../../data/schedule.tokens';
import { TimersComponent } from './timers.component';
import type { TimersConfig } from './timers.config';
import { STOPWATCH_DETAIL_SAVE_DEBOUNCE_MS } from './stopwatch-detail.component';

/** The real repository has Rust compute the next occurrence; the fake needs it done by hand. */
class SchedulingReminders extends FakeReminderRepository {
  /** Number of upcoming create/update results left without a next occurrence. */
  unscheduled = 0;

  override async create(input: ReminderInput & { readonly id?: string }): Promise<Reminder> {
    return this.settle(await super.create(input));
  }

  override async update(id: string, input: ReminderInput): Promise<Reminder> {
    return this.settle(await super.update(id, input));
  }

  private settle(reminder: Reminder): Reminder {
    if (this.unscheduled > 0) {
      this.unscheduled--;
      return reminder;
    }
    this.schedule(
      reminder.id,
      resolveLocal(reminder.startLocal, reminder.timeZone),
      reminder.startLocal,
    );
    return this.items.find((r) => r.id === reminder.id) ?? reminder;
  }
}

// 11:00 on 2026-11-16 in Paris (CET).
const NOW = '2026-11-16T10:00:00.000Z';
const MIN = 60_000;

interface Options {
  now?: string;
  zone?: string;
  prepare?: (sessions: FakeTimeSessionRepository, reminders: FakeReminderRepository) => void;
}

function finished(id: string, label: string, startedAt: string, minutes: number): TimeSession {
  const endedAt = new Date(Date.parse(startedAt) + minutes * MIN).toISOString();
  return {
    id,
    kind: 'countdown',
    label,
    startedAt,
    endsAt: endedAt,
    endedAt,
    endReason: 'completed',
    createdAt: startedAt,
    updatedAt: endedAt,
  };
}

async function render(options: Options = {}) {
  const clock = new ManualClock(options.now ?? NOW);
  const sessions = new FakeTimeSessionRepository(clock);
  const reminders = new SchedulingReminders(clock);
  options.prepare?.(sessions, reminders);
  const ctx: WidgetContext<TimersConfig> = {
    instanceId: 'inst-1',
    type: 'timers',
    config: signal<TimersConfig>({}),
    size: signal<GridSize>({ w: 4, h: 4 }),
    permissions: new Set(['notifications']),
    updateConfig: () => Promise.resolve(),
  };
  TestBed.configureTestingModule({
    providers: [
      provideAppI18n(),
      { provide: WIDGET_CONTEXT, useValue: ctx },
      { provide: CLOCK, useValue: clock },
      { provide: TIME_SESSION_REPOSITORY, useValue: sessions },
      { provide: REMINDER_REPOSITORY, useValue: reminders },
      { provide: SETTINGS_REPOSITORY, useValue: new FakeSettingsRepository() },
      { provide: SYSTEM_TIME_ZONE_READER, useValue: () => options.zone ?? 'Europe/Paris' },
    ],
  });
  await TestBed.inject(ApplicationInitStatus).donePromise;
  const fixture = TestBed.createComponent(TimersComponent);
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
  return { fixture, el, clock, sessions, reminders, q, all, text, settle, elapse, click, type };
}

describe('TimersComponent', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('shows the sections and the empty state', async () => {
    const t = await render();
    expect(t.text('timers-empty')).toBe('Aucun minuteur en cours.');
    expect(t.q('timers-start')).not.toBeNull();
    expect(t.q('timers-alarm-set')).not.toBeNull();
    expect(t.all('timers-preset').map((b) => b.textContent?.trim())).toEqual([
      '1 min',
      '5 min',
      '10 min',
      '15 min',
      '30 min',
    ]);
    // Every field has a visible label.
    for (const id of ['timers-minutes', 'timers-seconds', 'timers-label', 'timers-alarm-time']) {
      const field = t.q<HTMLInputElement>(id);
      expect(t.el.querySelector(`label[for="${field?.id}"]`), id).not.toBeNull();
    }
  });

  it('starts a countdown from a preset, counts down and shows the end time', async () => {
    const t = await render();
    await t.click(t.all('timers-preset')[2]);
    expect(t.q<HTMLInputElement>('timers-minutes')?.value).toBe('10');
    await t.type('timers-label', 'Thé');
    await t.click(t.q('timers-start'));
    expect(t.all('timers-row')).toHaveLength(1);
    expect(t.text('timers-row-name')).toBe('Thé');
    expect(t.text('timers-row-clock')).toBe('10:00');
    expect(t.text('timers-row-detail')).toBe('Fin à 11:10');
    await t.elapse(1000);
    expect(t.text('timers-row-clock')).toBe('9:59');
    // The value that scrolls is not a live region.
    expect(t.q('timers-row-clock')?.closest('[aria-live]')).toBeNull();
    expect(t.q('timers-row-clock')?.getAttribute('aria-live')).toBeNull();
  });

  it('shows Terminé in a status region at 0, then re-reads and moves it to the history', async () => {
    const t = await render();
    await t.type('timers-minutes', '0');
    await t.type('timers-seconds', '5');
    await t.click(t.q('timers-start'));
    expect(t.text('timers-row-clock')).toBe('0:05');
    await t.elapse(5000);
    expect(t.text('timers-row-clock')).toBe('0:00');
    expect(t.text('timers-row-finished')).toBe('Terminé');
    // One permanent status region announces it; only its text changes.
    const zone = t.q('timers-finished-status');
    expect(zone?.getAttribute('role')).toBe('status');
    expect(zone?.textContent?.trim()).toBe('Minuteur : terminé');
    expect(t.q('timers-row-stop')).toBeNull();
    // The store re-reads 1 s after the deadline.
    await t.elapse(1000);
    expect(t.all('timers-row')).toHaveLength(0);
    await t.click(t.q('timers-history'));
    expect(t.all('timer-history-row')).toHaveLength(1);
  });

  it('refuses an invalid duration without calling the repository', async () => {
    const t = await render();
    await t.type('timers-minutes', '0');
    await t.type('timers-seconds', '0');
    await t.click(t.q('timers-start'));
    expect(t.text('timers-duration-error')).toContain('entre 1 seconde et 24 heures');
    expect(t.sessions.calls.start).toBe(0);
    await t.type('timers-minutes', '1441');
    await t.click(t.q('timers-start'));
    expect(t.text('timers-duration-error')).toContain('de 0 à 1440');
    expect(t.q('timers-minutes')?.getAttribute('max')).toBe('1440');
    expect(t.sessions.calls.start).toBe(0);
  });

  it('starts a stopwatch and stops a timer', async () => {
    const t = await render();
    await t.click(t.q('timers-start-stopwatch'));
    expect(t.text('timers-row-name')).toBe('Chrono');
    await t.elapse(65 * MIN);
    expect(t.text('timers-row-since')).toContain('En cours depuis 1 h 05 min');
    expect(t.text('timers-row-since')).toContain('depuis 11:00');
    expect(t.text('timers-row-clock')).toBe('1:05:00');
    await t.click(t.q('timers-row-stop'));
    expect(t.all('timers-row')).toHaveLength(0);
    expect(t.sessions.items[0].endReason).toBe('stopped');
  });

  it('explains a failed start (limit reached) with an alert', async () => {
    const t = await render();
    t.sessions.failNext(new DataError('forbidden', 'Too many sessions'));
    await t.click(t.q('timers-start-stopwatch'));
    const error = t.q('timers-action-error');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toContain(
      'Trop de sessions en cours (20 au plus : minuteurs, chronos et pomodoro).',
    );
  });

  it('shows the desktop-only banner outside Tauri and disables the start buttons', async () => {
    const t = await render({
      prepare: (sessions) => sessions.failNext(new DataError('unavailable', 'no tauri')),
    });
    expect(t.text('timers-unavailable')).toBe("Disponible uniquement dans l'application Windows.");
    expect(t.q<HTMLButtonElement>('timers-start')?.disabled).toBe(true);
    expect(t.q<HTMLButtonElement>('timers-alarm-set')?.disabled).toBe(true);
  });

  describe('stopwatch detail', () => {
    async function openDetail() {
      const t = await render();
      await t.type('timers-label', 'Rédaction');
      await t.click(t.q('timers-start-stopwatch'));
      await t.click(t.q('timers-row-open'));
      return t;
    }

    it('opens a panel with the start, the elapsed time and the same-label sessions', async () => {
      const t = await render({
        prepare: (sessions) => {
          sessions.items.push(finished('old', 'Rédaction', '2026-11-15T08:00:00.000Z', 30));
          sessions.items.push(finished('other', 'Autre', '2026-11-15T09:00:00.000Z', 10));
        },
      });
      await t.type('timers-label', 'Rédaction');
      await t.click(t.q('timers-start-stopwatch'));
      await t.click(t.q('timers-row-open'));
      expect(t.q('stopwatch-detail')?.getAttribute('role')).toBe('group');
      expect(t.q<HTMLInputElement>('stopwatch-detail-label')?.value).toBe('Rédaction');
      expect(t.text('stopwatch-detail-started')).toContain('16 nov. 2026');
      expect(t.text('stopwatch-detail-elapsed')).toBe('0:00');
      const past = t.q('stopwatch-detail-past');
      expect(past?.querySelectorAll('li')).toHaveLength(1);
      expect(past?.textContent).toContain('30 min');
      await t.elapse(2000);
      expect(t.text('stopwatch-detail-elapsed')).toBe('0:02');
      expect(document.activeElement).toBe(t.q('stopwatch-detail-label'));
    });

    it('saves the label 800 ms after the last keystroke', async () => {
      const t = await openDetail();
      await t.type('stopwatch-detail-label', 'Relecture');
      await t.settle(STOPWATCH_DETAIL_SAVE_DEBOUNCE_MS - 1);
      expect(t.sessions.calls.rename).toBe(0);
      await t.settle(1);
      expect(t.sessions.calls.rename).toBe(1);
      expect(t.sessions.items[0].label).toBe('Relecture');
      expect(t.text('stopwatch-detail-status')).toBe('Enregistré');
    });

    it('flushes on Retour, returns the focus to the row and closes on Escape', async () => {
      const t = await openDetail();
      await t.type('stopwatch-detail-label', 'Relecture');
      await t.click(t.q('stopwatch-detail-back'));
      expect(t.sessions.items[0].label).toBe('Relecture');
      expect(t.q('stopwatch-detail')).toBeNull();
      expect(t.text('timers-row-name')).toBe('Relecture');
      expect(document.activeElement).toBe(t.q('timers-row-open'));

      await t.click(t.q('timers-row-open'));
      t.q('stopwatch-detail')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      await t.settle();
      expect(t.q('stopwatch-detail')).toBeNull();
    });

    it('shows an alert when the label cannot be saved', async () => {
      const t = await openDetail();
      t.sessions.failNext(new DataError('busy', 'busy'));
      await t.type('stopwatch-detail-label', 'Relecture');
      await t.settle(STOPWATCH_DETAIL_SAVE_DEBOUNCE_MS);
      expect(t.text('stopwatch-detail-error')).toBe(
        'Homebase est occupé : réessayez dans un instant.',
      );
    });

    it('closes when the stopwatch was stopped elsewhere', async () => {
      const t = await openDetail();
      await t.sessions.stop(t.sessions.items[0].id);
      await t.elapse(0);
      // Re-read happens on focus / action; simulate the window coming back.
      window.dispatchEvent(new Event('focus'));
      await t.elapse(300);
      expect(t.q('stopwatch-detail')).toBeNull();
    });
  });

  describe('history', () => {
    const prepare = (sessions: FakeTimeSessionRepository) => {
      sessions.items.push(
        finished('a', 'Thé', '2026-11-16T08:00:00.000Z', 5),
        { ...finished('b', '', '2026-11-16T07:00:00.000Z', 3), endReason: 'stopped' },
        finished('c', 'Hier', '2026-11-15T09:00:00.000Z', 25),
      );
    };

    it('groups finished sessions by local day with a total, newest day first', async () => {
      const t = await render({ prepare });
      await t.click(t.q('timers-history'));
      const days = t.all('timer-history-day');
      expect(days).toHaveLength(2);
      expect(t.all('timer-history-day-title')[0].textContent).toContain('lundi 16 novembre 2026');
      expect(t.all('timer-history-day-total')[0].textContent?.trim()).toBe('Total : 8 min');
      expect(t.all('timer-history-day-total')[1].textContent?.trim()).toBe('Total : 25 min');
      const rows = t.all('timer-history-row');
      expect(rows).toHaveLength(3);
      expect(rows[0].textContent).toContain('Thé');
      expect(rows[0].textContent).toContain('09:00');
      expect(rows[0].textContent).toContain('5 min');
      expect(rows[1].textContent).toContain('Minuteur');
      expect(rows[1].textContent).toContain('Arrêté');
      expect(rows[0].textContent).not.toContain('Arrêté');
    });

    it('uses the user time zone for the day', async () => {
      const t = await render({
        zone: 'America/Los_Angeles',
        prepare: (sessions) =>
          sessions.items.push(finished('z', 'Nuit', '2026-11-16T03:00:00.000Z', 5)),
      });
      await t.click(t.q('timers-history'));
      // 03:00Z is still the 15th at 19:00 in Los Angeles.
      expect(t.all('timer-history-day-title')[0].textContent).toContain('dimanche 15 novembre');
    });

    it('puts sessions that just ended in a head block, apart from their day', async () => {
      const t = await render({
        prepare: (sessions) => {
          sessions.items.push(
            // Started first, ended 07:30Z (5 min before "now" below).
            finished('fresh', 'Récent', '2026-11-16T05:00:00.000Z', 150),
            // Started later, ended 07:03Z (32 min before).
            finished('old', 'Ancien', '2026-11-16T07:00:00.000Z', 3),
          );
        },
      });
      t.clock.set('2026-11-16T07:35:00.000Z');
      await t.click(t.q('timers-history'));
      const names = t.all('timer-history-name').map((n) => n.textContent?.trim());
      expect(names).toEqual(['Récent', 'Ancien']);
      const titles = t.all('timer-history-day-title').map((n) => n.textContent?.trim());
      expect(titles[0]).toBe("Terminées à l'instant");
      expect(titles).toHaveLength(2);
      expect(t.all('timer-history-day')[1].textContent).not.toContain('Récent');
    });

    it('includes a stopwatch started on another day in the head block', async () => {
      const t = await render({
        prepare: (sessions) =>
          sessions.items.push({
            ...finished('long', 'Long', '2026-11-14T08:00:00.000Z', 0),
            kind: 'stopwatch',
            endsAt: null,
            endedAt: '2026-11-16T09:55:00.000Z',
            endReason: 'stopped',
          }),
      });
      await t.click(t.q('timers-history'));
      expect(t.all('timer-history-day-title')[0].textContent?.trim()).toBe("Terminées à l'instant");
      expect(t.all('timer-history-day')).toHaveLength(1);
      expect(t.all('timer-history-row')[0].textContent).toContain('Long');
      expect(t.all('timer-history-row')[0].textContent).toContain('2 j 1 h');
    });

    it('deletes a session after an inline confirmation', async () => {
      const t = await render({ prepare });
      await t.click(t.q('timers-history'));
      await t.click(t.all('timer-history-remove')[0]);
      expect(t.sessions.calls.remove).toBe(0);
      expect(document.activeElement).toBe(t.q('timer-history-confirm-no'));
      await t.click(t.q('timer-history-confirm-no'));
      expect(t.all('timer-history-row')).toHaveLength(3);
      await t.click(t.all('timer-history-remove')[0]);
      await t.click(t.q('timer-history-confirm-yes'));
      expect(t.sessions.calls.remove).toBe(1);
      expect(t.all('timer-history-row')).toHaveLength(2);
    });

    it('offers "Voir plus" only when another page exists', async () => {
      const t = await render({
        prepare: (sessions) => {
          for (let i = 0; i < 101; i++) {
            const start = new Date(Date.parse('2026-11-01T00:00:00.000Z') + i * 10 * MIN);
            sessions.items.push(
              finished(`s${String(i).padStart(3, '0')}`, '', start.toISOString(), 1),
            );
          }
        },
      });
      await t.click(t.q('timers-history'));
      expect(t.all('timer-history-row')).toHaveLength(100);
      await t.click(t.q('timer-history-more'));
      expect(t.all('timer-history-row')).toHaveLength(101);
      expect(t.q('timer-history-more')).toBeNull();
    });

    it('shows an empty state, closes on Escape and returns the focus to the button', async () => {
      const t = await render();
      await t.click(t.q('timers-history'));
      expect(t.q('timer-history-empty')).not.toBeNull();
      expect(document.activeElement).toBe(t.q('timer-history-back'));
      t.q('timer-history')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      await t.settle();
      expect(t.q('timer-history')).toBeNull();
      expect(document.activeElement).toBe(t.q('timers-history'));
    });
  });

  describe('alarm', () => {
    it('creates a one-shot reminder for tomorrow when the time has passed (MV5)', async () => {
      const t = await render();
      await t.type('timers-alarm-time', '07:00');
      await t.click(t.q('timers-alarm-set'));
      expect(t.reminders.items).toHaveLength(1);
      expect(t.reminders.items[0]).toMatchObject({
        title: 'Alarme',
        startLocal: '2026-11-17T07:00:00',
        timeZone: 'Europe/Paris',
        rrule: null,
        exdates: [],
        enabled: true,
      });
      const message = t.q('timers-alarm-message');
      expect(message?.getAttribute('role')).toBe('status');
      expect(message?.textContent?.trim()).toBe('Alarme réglée pour demain à 07:00');
      expect(t.q('timers-alarm-note')).toBeNull();
    });

    it('rings today when the time is ahead, with the typed label', async () => {
      const t = await render();
      await t.type('timers-alarm-time', '18:30');
      await t.type('timers-alarm-label', 'Sortir le pain');
      await t.click(t.q('timers-alarm-set'));
      expect(t.reminders.items[0]).toMatchObject({
        title: 'Sortir le pain',
        startLocal: '2026-11-16T18:30:00',
      });
      expect(t.text('timers-alarm-message')).toBe("Alarme réglée pour aujourd'hui à 18:30");
    });

    it('announces a time that does not exist (spring forward) and the time used', async () => {
      const t = await render({ now: '2027-03-27T23:30:00.000Z' });
      await t.type('timers-alarm-time', '02:30');
      await t.click(t.q('timers-alarm-set'));
      expect(t.reminders.items[0].startLocal).toBe('2027-03-28T03:30:00');
      expect(t.text('timers-alarm-text')).toBe("Alarme réglée pour aujourd'hui à 03:30");
      expect(t.text('timers-alarm-note')).toContain("Cette heure n'existe pas ce jour-là");
    });

    it('announces an ambiguous time (fall back)', async () => {
      const t = await render({ now: '2026-10-24T22:30:00.000Z' });
      await t.type('timers-alarm-time', '02:30');
      await t.click(t.q('timers-alarm-set'));
      expect(t.text('timers-alarm-note')).toContain('existe deux fois');
    });

    it('asks for a time when none is chosen', async () => {
      const t = await render();
      await t.click(t.q('timers-alarm-set'));
      expect(t.text('timers-alarm-error')).toBe("Choisissez une heure pour l'alarme.");
      expect(t.reminders.calls.create).toBe(0);
    });

    it('reports a refusal from the commands', async () => {
      const t = await render();
      // The reminder store is created on first use and reads at once: let that read pass.
      TestBed.inject(ReminderStore);
      await t.settle();
      t.reminders.failNext(new DataError('forbidden', 'Too many reminders'));
      await t.type('timers-alarm-time', '07:00');
      await t.click(t.q('timers-alarm-set'));
      expect(t.text('timers-alarm-error')).toContain('Trop de rappels');
      expect(t.text('timers-alarm-message')).toBe('');
    });
  });

  describe('review fixes', () => {
    const typeInto = async (t: Awaited<ReturnType<typeof render>>, id: string, value: string) => {
      const input = t.q<HTMLInputElement>(id);
      if (!input) throw new Error(id);
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await t.settle();
      return input;
    };

    async function openDetail(label = 'Rédaction') {
      const t = await render();
      await t.type('timers-label', label);
      await t.click(t.q('timers-start-stopwatch'));
      await t.click(t.q('timers-row-open'));
      return t;
    }

    it('keeps the draft as typed, trailing space included, after the debounced save', async () => {
      const t = await openDetail();
      const input = await typeInto(t, 'stopwatch-detail-label', 'a ');
      await t.settle(STOPWATCH_DETAIL_SAVE_DEBOUNCE_MS);
      expect(t.sessions.items[0].label).toBe('a');
      expect(input.value).toBe('a ');
      expect(t.q<HTMLInputElement>('stopwatch-detail-label')?.value).toBe('a ');
      await typeInto(t, 'stopwatch-detail-label', input.value + 'b');
      await t.settle(STOPWATCH_DETAIL_SAVE_DEBOUNCE_MS);
      expect(t.sessions.items[0].label).toBe('a b');
      expect(t.q<HTMLInputElement>('stopwatch-detail-label')?.value).toBe('a b');
    });

    it('writes the draft when the pending writes are flushed', async () => {
      const t = await openDetail();
      await typeInto(t, 'stopwatch-detail-label', 'Urgent');
      expect(t.sessions.calls.rename).toBe(0);
      await TestBed.inject(PendingWrites).flushAll();
      expect(t.sessions.items[0].label).toBe('Urgent');
    });

    it('does not write again on destruction after a failure was reported', async () => {
      const t = await openDetail();
      t.sessions.failNext(new DataError('busy', 'busy'));
      await typeInto(t, 'stopwatch-detail-label', 'Relecture');
      await t.settle(STOPWATCH_DETAIL_SAVE_DEBOUNCE_MS);
      expect(t.sessions.calls.rename).toBe(1);
      t.fixture.destroy();
      await t.settle();
      expect(t.sessions.calls.rename).toBe(1);
    });

    it('does not show "cannot read" after a failed rename once the panel is closed', async () => {
      const t = await openDetail();
      vi.spyOn(t.sessions, 'rename').mockRejectedValue(new DataError('busy', 'busy'));
      await typeInto(t, 'stopwatch-detail-label', 'Relecture');
      await t.settle(STOPWATCH_DETAIL_SAVE_DEBOUNCE_MS);
      await t.click(t.q('stopwatch-detail-back'));
      await t.click(t.q('stopwatch-detail-back'));
      expect(t.q('stopwatch-detail')).toBeNull();
      expect(t.q('timers-load-error')).toBeNull();
    });

    it('keeps the last typed value when a blur arrives during a save', async () => {
      const t = await openDetail();
      const real = t.sessions.rename.bind(t.sessions);
      let release = () => undefined as void;
      let first = true;
      const spy = vi.spyOn(t.sessions, 'rename').mockImplementation(async (id, label) => {
        if (first) {
          first = false;
          await new Promise<void>((resolve) => (release = resolve));
        }
        return real(id, label);
      });
      await typeInto(t, 'stopwatch-detail-label', 'a');
      await t.settle(STOPWATCH_DETAIL_SAVE_DEBOUNCE_MS);
      expect(spy).toHaveBeenCalledTimes(1);
      const input = await typeInto(t, 'stopwatch-detail-label', 'ab');
      input.dispatchEvent(new Event('blur'));
      release();
      await t.settle();
      await t.settle();
      expect(t.sessions.items[0].label).toBe('ab');
    });

    it('clears a failed action message after a successful re-read', async () => {
      const t = await render();
      t.sessions.failNext(new DataError('forbidden', 'Too many sessions'));
      await t.click(t.q('timers-start-stopwatch'));
      expect(t.q('timers-action-error')).not.toBeNull();
      expect(t.q('timers-load-error')).toBeNull();
      window.dispatchEvent(new Event('focus'));
      await t.elapse(300);
      expect(t.q('timers-action-error')).toBeNull();
    });

    it('shows "cannot read" for a failed read', async () => {
      const t = await render({
        prepare: (sessions) => sessions.failNext(new DataError('busy', 'busy')),
      });
      expect(t.q('timers-load-error')).not.toBeNull();
    });

    it('uses text-xl (24 px) for the countdown value', async () => {
      const t = await render();
      await t.click(t.q('timers-start-stopwatch'));
      expect(t.q('timers-row-clock')?.className).toContain('text-xl');
      expect(t.q('timers-row-clock')?.className).not.toContain('text-2xl');
    });

    it('prefixes the detail ids with the widget instance', async () => {
      const t = await openDetail();
      expect(t.q('stopwatch-detail-label')?.id).toBe('stopwatch-detail-label-inst-1');
    });

    it('moves the focus to the next row after Arrêter, else to the heading', async () => {
      const t = await render();
      await t.click(t.q('timers-start-stopwatch'));
      await t.click(t.q('timers-start-stopwatch'));
      expect(t.all('timers-row')).toHaveLength(2);
      await t.click(t.all('timers-row-stop')[0]);
      expect(t.all('timers-row')).toHaveLength(1);
      expect(t.el.contains(document.activeElement)).toBe(true);
      expect(document.activeElement).toBe(t.q('timers-row-open'));
      await t.click(t.q('timers-row-stop'));
      expect(document.activeElement?.id).toBe('timers-running-inst-1');
    });

    it('reports a failed stop (not_found) and keeps the focus on the button', async () => {
      const t = await render();
      await t.click(t.q('timers-start-stopwatch'));
      const stop = t.q('timers-row-stop');
      stop?.focus();
      t.sessions.failNext(new DataError('not_found', 'gone'));
      await t.click(stop);
      expect(t.text('timers-action-error')).toContain("Ce minuteur n'existe plus.");
      expect(t.q('timers-load-error')).toBeNull();
    });

    it('treats unreadable text in a number field as an error, not zero', async () => {
      const t = await render();
      const input = t.q<HTMLInputElement>('timers-minutes');
      if (!input) throw new Error('minutes');
      Object.defineProperty(input, 'validity', { value: { badInput: true }, configurable: true });
      await typeInto(t, 'timers-minutes', '');
      await t.type('timers-seconds', '30');
      await t.click(t.q('timers-start'));
      expect(t.text('timers-duration-error')).toContain('de 0 à 1440');
      expect(t.sessions.calls.start).toBe(0);
    });

    it('links the duration error to both fields', async () => {
      const t = await render();
      await t.type('timers-minutes', '0');
      await t.type('timers-seconds', '0');
      await t.click(t.q('timers-start'));
      const id = t.q('timers-duration-error')?.id;
      expect(id).toBeTruthy();
      expect(t.q('timers-minutes')?.getAttribute('aria-describedby')).toBe(id);
      expect(t.q('timers-seconds')?.getAttribute('aria-describedby')).toBe(id);
    });

    it('shows an error when "Voir plus" fails, then recovers', async () => {
      const t = await render({
        prepare: (sessions) => {
          for (let i = 0; i < 101; i++) {
            const start = new Date(Date.parse('2026-11-01T00:00:00.000Z') + i * 10 * MIN);
            sessions.items.push(
              finished(`s${String(i).padStart(3, '0')}`, '', start.toISOString(), 1),
            );
          }
        },
      });
      await t.click(t.q('timers-history'));
      t.sessions.failNext(new DataError('busy', 'busy'));
      await t.click(t.q('timer-history-more'));
      expect(t.text('timer-history-error')).toBe(
        'Homebase est occupé : réessayez dans un instant.',
      );
      expect(t.all('timer-history-row')).toHaveLength(100);
      // The failed page is not a load failure of the widget itself.
      expect(t.q('timers-load-error')).toBeNull();
      await t.click(t.q('timer-history-more'));
      expect(t.q('timer-history-error')).toBeNull();
      expect(t.all('timer-history-row')).toHaveLength(101);
    });

    it('keeps the focus in the history panel when a deletion fails', async () => {
      const t = await render({
        prepare: (sessions) =>
          sessions.items.push(finished('a', 'Thé', '2026-11-16T08:00:00.000Z', 5)),
      });
      await t.click(t.q('timers-history'));
      await t.click(t.q('timer-history-remove'));
      t.sessions.failNext(new DataError('busy', 'busy'));
      await t.click(t.q('timer-history-confirm-yes'));
      expect(t.q('timer-history-error')).not.toBeNull();
      expect(t.q('timer-history')?.contains(document.activeElement)).toBe(true);
    });

    describe('alarm', () => {
      it('uses the instant returned by the command for the message', async () => {
        const t = await render();
        await t.type('timers-alarm-time', '07:00');
        await t.click(t.q('timers-alarm-set'));
        expect(t.reminders.items[0].nextFireAt).toBe('2026-11-17T06:00:00.000Z');
        expect(t.text('timers-alarm-text')).toBe('Alarme réglée pour demain à 07:00');
      });

      it('reschedules once for the next day when nothing is ahead, then confirms', async () => {
        const t = await render();
        TestBed.inject(ReminderStore);
        await t.settle();
        t.reminders.unscheduled = 1;
        await t.type('timers-alarm-time', '18:30');
        await t.click(t.q('timers-alarm-set'));
        expect(t.reminders.calls.create).toBe(1);
        expect(t.reminders.calls.update).toBe(1);
        expect(t.reminders.items[0].startLocal).toBe('2026-11-17T18:30:00');
        expect(t.text('timers-alarm-text')).toBe('Alarme réglée pour demain à 18:30');
        expect(t.q('timers-alarm-error')).toBeNull();
      });

      it('shows an error when the second attempt is not scheduled either', async () => {
        const t = await render();
        TestBed.inject(ReminderStore);
        await t.settle();
        t.reminders.unscheduled = 2;
        await t.type('timers-alarm-time', '18:30');
        await t.click(t.q('timers-alarm-set'));
        expect(t.reminders.calls.update).toBe(1);
        expect(t.text('timers-alarm-error')).toContain('aucune occurrence à venir');
        expect(t.text('timers-alarm-text')).toBe('');
        expect(t.reminders.items).toHaveLength(0);
      });

      it('removes the created reminder when the retry update fails', async () => {
        const t = await render();
        TestBed.inject(ReminderStore);
        await t.settle();
        t.reminders.unscheduled = 1;
        vi.spyOn(t.reminders, 'update').mockRejectedValue(new DataError('busy', 'busy'));
        await t.type('timers-alarm-time', '18:30');
        await t.click(t.q('timers-alarm-set'));
        expect(t.q('timers-alarm-error')).not.toBeNull();
        expect(t.reminders.items).toHaveLength(0);
      });

      it('links the time field to its error with aria-describedby', async () => {
        const t = await render();
        const input = t.q('timers-alarm-time')!;
        expect(input.getAttribute('aria-describedby')).toBeNull();
        await t.type('timers-alarm-time', '');
        await t.click(t.q('timers-alarm-set'));
        const error = t.q('timers-alarm-error')!;
        expect(error.id).not.toBe('');
        expect(input.getAttribute('aria-describedby')).toBe(error.id);
      });

      it('explains an invalid_input refusal of the label', async () => {
        const t = await render();
        TestBed.inject(ReminderStore);
        await t.settle();
        t.reminders.failNext(
          new DataError('invalid_input', 'title', {
            cause: { kind: 'invalid_input', field: 'title' },
          }),
        );
        await t.type('timers-alarm-time', '07:00');
        await t.click(t.q('timers-alarm-set'));
        expect(t.text('timers-alarm-error')).toContain('Le libellé est trop long');
      });

      it.each([
        ['Europe/Paris', '2026-11-17T18:00:00'],
        ['America/Los_Angeles', '2026-11-16T18:00:00'],
        ['Asia/Tokyo', '2026-11-17T18:00:00'],
      ])('follows the user time zone: %s', async (zone, startLocal) => {
        // 23:30Z on the 16th: 00:30 on the 17th in Paris, 15:30 on the 16th in Los Angeles.
        const t = await render({ now: '2026-11-16T23:30:00.000Z', zone });
        await t.type('timers-alarm-time', '18:00');
        await t.click(t.q('timers-alarm-set'));
        expect(t.reminders.items[0]).toMatchObject({ startLocal, timeZone: zone });
      });
    });
  });
});
