import type { TimeSession, TimeSessionKind } from '../../data';
import {
  completedWorkCount,
  completedWorkSinceLongBreak,
  cycleProgress,
  kindOfPhase,
  phaseOfKind,
  suggestNextPhase,
} from './pomodoro-cycle';

const ZONE = 'Europe/Paris';
const TODAY = '2026-11-16';

let counter = 0;
function session(
  kind: TimeSessionKind,
  startedAt: string,
  endReason: 'completed' | 'stopped' | null = 'completed',
): TimeSession {
  const id = `s${String(++counter).padStart(3, '0')}`;
  return {
    id,
    kind,
    label: '',
    startedAt,
    endsAt: startedAt,
    endedAt: endReason === null ? null : startedAt,
    endReason,
    createdAt: startedAt,
    updatedAt: startedAt,
  };
}

const work = (hour: number, reason: 'completed' | 'stopped' | null = 'completed') =>
  session('pomodoro_work', `2026-11-16T${String(hour).padStart(2, '0')}:00:00.000Z`, reason);
const shortBreak = (hour: number) =>
  session('pomodoro_short_break', `2026-11-16T${String(hour).padStart(2, '0')}:30:00.000Z`);
const longBreak = (hour: number) =>
  session('pomodoro_long_break', `2026-11-16T${String(hour).padStart(2, '0')}:30:00.000Z`);

const suggest = (sessions: TimeSession[], every = 4) =>
  suggestNextPhase(sessions, TODAY, ZONE, every);

describe('pomodoro-cycle', () => {
  it('maps kinds and phases both ways', () => {
    expect(phaseOfKind('pomodoro_short_break')).toBe('short_break');
    expect(phaseOfKind('countdown')).toBeNull();
    expect(phaseOfKind('stopwatch')).toBeNull();
    expect(kindOfPhase('long_break')).toBe('pomodoro_long_break');
    expect(kindOfPhase(phaseOfKind('pomodoro_work') ?? 'work')).toBe('pomodoro_work');
  });

  it('proposes work when there is no session', () => {
    expect(suggest([])).toBe('work');
  });

  it('proposes a short break after completed work number 1, 2 and 3', () => {
    expect(suggest([work(7)])).toBe('short_break');
    expect(suggest([work(7), shortBreak(7), work(8)])).toBe('short_break');
    expect(suggest([work(7), shortBreak(7), work(8), shortBreak(8), work(9)])).toBe('short_break');
  });

  it('proposes a long break after completed work number 4', () => {
    const four = [work(6), shortBreak(6), work(7), shortBreak(7), work(8), shortBreak(8), work(9)];
    expect(suggest(four)).toBe('long_break');
  });

  it('follows the configured cycle length', () => {
    expect(suggest([work(7), shortBreak(7), work(8)], 2)).toBe('long_break');
    expect(suggest([work(7), shortBreak(7), work(8)], 3)).toBe('short_break');
  });

  it('proposes work after any break, completed or not', () => {
    expect(suggest([work(7), shortBreak(7)])).toBe('work');
    expect(
      suggest([work(7), session('pomodoro_short_break', '2026-11-16T07:30:00.000Z', 'stopped')]),
    ).toBe('work');
    expect(suggest([work(7), longBreak(7)])).toBe('work');
  });

  it('proposes work again after a stopped work', () => {
    expect(suggest([work(7), shortBreak(7), work(8, 'stopped')])).toBe('work');
  });

  it('counts the works since the last long break only', () => {
    // 4 works, long break, then 1 work: the next break is short.
    const sessions = [work(5), work(6), work(7), work(8), longBreak(8), work(9)];
    expect(completedWorkSinceLongBreak(sessions, TODAY, ZONE)).toBe(1);
    expect(suggest(sessions)).toBe('short_break');
    // 4 more works after the long break: long again.
    const more = [...sessions, work(10), work(11), work(12)];
    expect(suggest(more)).toBe('long_break');
  });

  it('ignores stopped works in the count', () => {
    const sessions = [work(6), work(7, 'stopped'), work(8), work(9)];
    expect(completedWorkSinceLongBreak(sessions, TODAY, ZONE)).toBe(3);
  });

  it('ignores sessions that are not pomodoros and sessions still running', () => {
    const sessions = [
      session('countdown', '2026-11-16T07:00:00.000Z'),
      session('stopwatch', '2026-11-16T08:00:00.000Z', 'stopped'),
      work(9, null),
    ];
    expect(suggest(sessions)).toBe('work');
    expect(completedWorkCount(sessions, TODAY, ZONE)).toBe(0);
  });

  it('counts only today for the cycle, but the last session decides the phase', () => {
    const yesterday = [
      session('pomodoro_work', '2026-11-15T09:00:00.000Z'),
      session('pomodoro_work', '2026-11-15T10:00:00.000Z'),
      session('pomodoro_work', '2026-11-15T11:00:00.000Z'),
      session('pomodoro_work', '2026-11-15T12:00:00.000Z'),
    ];
    // The last session (yesterday) is a completed work: its break is still proposed.
    expect(suggest(yesterday)).toBe('short_break');
    expect(completedWorkCount(yesterday, TODAY, ZONE)).toBe(0);
    expect(completedWorkCount([...yesterday, work(7)], TODAY, ZONE)).toBe(1);
  });

  it('cuts the day at local midnight, not at UTC midnight', () => {
    // 23:30Z on the 15th is 00:30 on the 16th in Paris: today. 22:30Z on the 15th is 23:30: yesterday.
    const afterMidnight = session('pomodoro_work', '2026-11-15T23:30:00.000Z');
    const beforeMidnight = session('pomodoro_work', '2026-11-15T22:30:00.000Z');
    expect(completedWorkCount([afterMidnight, beforeMidnight], TODAY, ZONE)).toBe(1);
    expect(suggest([afterMidnight])).toBe('short_break');
    expect(suggest([beforeMidnight])).toBe('short_break');
    expect(completedWorkSinceLongBreak([beforeMidnight], TODAY, ZONE)).toBe(0);
    // Same instants, another zone: 23:30Z on the 15th is still the 15th in Los Angeles.
    expect(completedWorkCount([afterMidnight], TODAY, 'America/Los_Angeles')).toBe(0);
  });

  it('straddles midnight: a cycle begun yesterday restarts today', () => {
    const sessions = [
      session('pomodoro_work', '2026-11-15T21:00:00.000Z'),
      session('pomodoro_work', '2026-11-15T22:00:00.000Z'),
      session('pomodoro_work', '2026-11-15T22:40:00.000Z'),
      session('pomodoro_work', '2026-11-15T23:10:00.000Z'),
    ];
    // Only the last one started today (00:10 in Paris).
    expect(completedWorkCount(sessions, TODAY, ZONE)).toBe(1);
    expect(suggest(sessions)).toBe('short_break');
  });

  it('shows full cycle dots until the long break starts', () => {
    const progress = (sessions: TimeSession[]) => cycleProgress(sessions, TODAY, ZONE, 4);
    expect(progress([])).toBe(0);
    expect(progress([work(7), work(8)])).toBe(2);
    expect(progress([work(5), work(6), work(7), work(8)])).toBe(4);
    expect(progress([work(5), work(6), work(7), work(8), longBreak(8)])).toBe(0);
    expect(progress([work(3), work(4), work(5), work(6), work(7)])).toBe(1);
  });
});
