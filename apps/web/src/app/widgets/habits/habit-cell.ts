import { DestroyRef, Injector, afterNextRender } from '@angular/core';
import { isExpected, weekdayCode } from '../../core/habits';
import { addDays, compareLocalDates } from '../../core/time';
import type { HabitSchedule, LocalDateIso, WeekdayCode } from '../../data';
import { cellLabel } from './habit-label';
import type { HabitLabelFormat } from './habit-label';

// Cells shared by the 7-day strip and the 5-week history (spec habits 4.7): same facts, same
// classes, same accessible name, same focus handling.

export interface Cell {
  readonly day: LocalDateIso;
  readonly weekday: WeekdayCode;
  readonly done: boolean;
  readonly expected: boolean;
  /** Before the start date: cannot be checked. */
  readonly beforeStart: boolean;
  readonly today: boolean;
  readonly label: string;
}

/** The parts of a habit a cell needs. */
export interface CellHabit {
  readonly title: string;
  readonly schedule: HabitSchedule;
  readonly startOn: LocalDateIso;
}

export function makeCell(
  habit: CellHabit,
  day: LocalDateIso,
  today: LocalDateIso,
  checked: ReadonlySet<LocalDateIso>,
  fmt: HabitLabelFormat,
): Cell {
  const expected = isExpected(habit.schedule, day);
  const beforeStart = compareLocalDates(day, habit.startOn) < 0;
  return {
    day,
    weekday: weekdayCode(day),
    done: checked.has(day),
    expected,
    beforeStart,
    today: day === today,
    label: cellLabel(habit.title, day, { expected, today: day === today, beforeStart }, fmt),
  };
}

/** Classes of a cell: done = filled and checked, unplanned = dashed (still checkable), today = accent. */
export function cellClass(cell: Cell): string {
  const base =
    'inline-flex h-6 w-6 flex-none cursor-pointer items-center justify-center rounded-box border p-0 text-xs disabled:cursor-not-allowed disabled:opacity-40';
  const border = cell.today ? 'border-accent' : 'border-default';
  if (cell.done) {
    return `${base} ${border} bg-success-emphasis text-fg-on-emphasis`;
  }
  return cell.expected
    ? `${base} ${border} bg-transparent`
    : `${base} ${border} border-dashed bg-canvas-subtle`;
}

/**
 * The day holding the single tab stop: the stored one if still usable, else today, else the last
 * usable cell. With no usable cell (every day before the start date) nothing is focusable.
 */
export function tabStopDay(
  cells: readonly Cell[],
  stored: LocalDateIso | undefined,
  today: LocalDateIso,
): LocalDateIso {
  const usable = cells.filter((c) => !c.beforeStart);
  return (
    usable.find((c) => c.day === stored)?.day ??
    usable.find((c) => c.day === today)?.day ??
    usable.at(-1)?.day ??
    today
  );
}

/** The `data-day` of the cell that holds the event target, if any. */
export function activeDay(event: Event): string | undefined {
  return (event.target as HTMLElement).closest<HTMLElement>('[data-day]')?.dataset['day'];
}

/** Next cell of a flat chronological list for ArrowLeft/Right/Home/End; null for other keys. */
export function linearMove(key: string, index: number, length: number): number | null {
  switch (key) {
    case 'ArrowLeft':
      return Math.max(0, index - 1);
    case 'ArrowRight':
      return Math.min(length - 1, index + 1);
    case 'Home':
      return 0;
    case 'End':
      return length - 1;
    default:
      return null;
  }
}

/** Moves a day by whole weeks (used by ArrowUp/ArrowDown of the history). */
export function shiftWeeks(day: LocalDateIso, weeks: number): LocalDateIso {
  return addDays(day, 7 * weeks);
}

/**
 * Focuses the cell `data-cell="<key>"`. After a check the button was disabled and lost the focus:
 * wait for the next render, and do not steal the focus from something the user moved to meanwhile.
 */
export function focusCell(
  host: HTMLElement,
  key: string,
  afterRender: boolean,
  injector: Injector,
): void {
  const run = (): void => {
    const target = Array.from(host.querySelectorAll<HTMLElement>('[data-cell]')).find(
      (e) => e.dataset['cell'] === key,
    );
    if (target === undefined) return;
    const active = document.activeElement;
    if (!afterRender || active === null || active === document.body || active === target) {
      target.focus();
    }
  };
  // The component may be gone when the answer arrives: no render hook then (NG0911).
  if (afterRender) {
    if (injector.get(DestroyRef).destroyed) return;
    afterNextRender(run, { injector });
  } else run();
}
