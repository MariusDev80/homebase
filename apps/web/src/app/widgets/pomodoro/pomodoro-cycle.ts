import type { LocalDateIso, TimeSession, TimeSessionKind } from '../../data';
import { toLocalDate } from '../../core/time';

export type PomodoroPhase = 'work' | 'short_break' | 'long_break';

export const POMODORO_PHASES: readonly PomodoroPhase[] = ['work', 'short_break', 'long_break'];

export function phaseOfKind(kind: TimeSessionKind): PomodoroPhase | null {
  switch (kind) {
    case 'pomodoro_work':
      return 'work';
    case 'pomodoro_short_break':
      return 'short_break';
    case 'pomodoro_long_break':
      return 'long_break';
    default:
      return null;
  }
}

export function kindOfPhase(phase: PomodoroPhase): TimeSessionKind {
  switch (phase) {
    case 'work':
      return 'pomodoro_work';
    case 'short_break':
      return 'pomodoro_short_break';
    case 'long_break':
      return 'pomodoro_long_break';
  }
}

/** Pomodoro sessions that ended, oldest first (any day). */
function endedSessions(sessions: readonly TimeSession[]): TimeSession[] {
  return sessions
    .filter((s) => phaseOfKind(s.kind) !== null && s.endedAt !== null)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
}

/** Pomodoro sessions that ended, started on "today" in the user's zone, oldest first. */
function endedToday(
  sessions: readonly TimeSession[],
  today: LocalDateIso,
  timeZone: string,
): TimeSession[] {
  return endedSessions(sessions).filter((s) => toLocalDate(s.startedAt, timeZone) === today);
}

/** Work sessions completed today (started today, local day of the user's zone). */
export function completedWorkCount(
  sessions: readonly TimeSession[],
  today: LocalDateIso,
  timeZone: string,
): number {
  return endedToday(sessions, today, timeZone).filter(
    (s) => s.kind === 'pomodoro_work' && s.endReason === 'completed',
  ).length;
}

/** Work sessions completed today since the start of today's last long break. */
export function completedWorkSinceLongBreak(
  sessions: readonly TimeSession[],
  today: LocalDateIso,
  timeZone: string,
): number {
  const ended = endedToday(sessions, today, timeZone);
  const lastLong = ended.map((s) => s.kind).lastIndexOf('pomodoro_long_break');
  return ended
    .slice(lastLong + 1)
    .filter((s) => s.kind === 'pomodoro_work' && s.endReason === 'completed').length;
}

/**
 * The phase to propose when none is running. The LAST pomodoro session decides, whatever its day
 * (a work ended just after midnight still earns its break): none, a break or a stopped work gives
 * "work"; a completed work gives a short break, or a long break every "every"-th completed work
 * of today since today's last long break (the position in the cycle is per local day).
 */
export function suggestNextPhase(
  sessions: readonly TimeSession[],
  today: LocalDateIso,
  timeZone: string,
  every: number,
): PomodoroPhase {
  const last = endedSessions(sessions).at(-1);
  if (last === undefined || last.kind !== 'pomodoro_work' || last.endReason !== 'completed') {
    return 'work';
  }
  const count = completedWorkSinceLongBreak(sessions, today, timeZone);
  return count > 0 && count % every === 0 ? 'long_break' : 'short_break';
}

/** Filled dots of the cycle (0..every): a full cycle stays full until the long break starts. */
export function cycleProgress(
  sessions: readonly TimeSession[],
  today: LocalDateIso,
  timeZone: string,
  every: number,
): number {
  const count = completedWorkSinceLongBreak(sessions, today, timeZone);
  return count === 0 ? 0 : ((count - 1) % every) + 1;
}
