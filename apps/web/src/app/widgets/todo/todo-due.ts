import { daysBetween, parseLocalDate } from '../../core/time';
import type { LocalDateIso } from '../../data';
import type { Todo } from '../../data';

export type DueKind = 'overdue' | 'today' | 'tomorrow' | 'date';
export type DueDateStyle = 'day-month' | 'short';

/** Text of a label: a Transloco key with its parameters, or a ready-made date. */
export interface DueText {
  /** Transloco key, or null when `text` is already the text to show (a formatted date). */
  readonly key: string | null;
  readonly params: Readonly<Record<string, number>>;
  readonly text: string;
}

export interface DueLabel {
  readonly kind: DueKind;
  /** Days late, for the 'overdue' kind (>= 1), else 0. */
  readonly daysLate: number;
  /** Long form (wide rows, detail sheet). */
  readonly long: DueText;
  /** Short form (narrow rows). */
  readonly short: DueText;
}

function keyed(key: string, params: Record<string, number> = {}): DueText {
  return { key, params, text: '' };
}

/**
 * Relative label of a due date. `formatDate` is supplied by the caller (`TimeDisplay`), so that
 * this function stays pure. A completed todo is never late. Null without a due date.
 */
export function dueLabel(
  todo: Pick<Todo, 'dueOn' | 'completedAt'>,
  today: LocalDateIso,
  formatDate: (date: LocalDateIso, style: DueDateStyle) => string,
): DueLabel | null {
  const dueOn = todo.dueOn;
  if (dueOn === null) return null;
  if (todo.completedAt === null) {
    const days = daysBetween(today, dueOn);
    if (days < 0) {
      const late = -days;
      return {
        kind: 'overdue',
        daysLate: late,
        long: keyed(late === 1 ? 'widgets.todo.overdueOne' : 'widgets.todo.overdueMany', {
          count: late,
        }),
        short: keyed('widgets.todo.dueShortOverdue', { count: late }),
      };
    }
    if (days === 0) {
      const text = keyed('widgets.todo.dueToday');
      return { kind: 'today', daysLate: 0, long: text, short: text };
    }
    if (days === 1) {
      const text = keyed('widgets.todo.dueTomorrow');
      return { kind: 'tomorrow', daysLate: 0, long: text, short: text };
    }
  }
  const style: DueDateStyle =
    parseLocalDate(dueOn).year === parseLocalDate(today).year ? 'day-month' : 'short';
  const text: DueText = { key: null, params: {}, text: formatDate(dueOn, style) };
  return { kind: 'date', daysLate: 0, long: text, short: text };
}
