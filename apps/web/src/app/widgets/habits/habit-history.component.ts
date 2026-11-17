import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { HabitStore, WEEKDAYS, currentStreak, ratePercent, successRate } from '../../core/habits';
import { TimeDisplay, Today, addDays, compareLocalDates, startOfIsoWeek } from '../../core/time';
import type { Habit, LocalDateIso } from '../../data';
import {
  activeDay,
  cellClass,
  focusCell,
  linearMove,
  makeCell,
  shiftWeeks,
  tabStopDay,
} from './habit-cell';
import type { Cell } from './habit-cell';
import { problemOf } from './habit-form';
import { historyStreakText, rateText } from './habit-label';
import type { HabitLabelFormat } from './habit-label';

/** Weeks shown: the current one and the 4 before it (spec habits 4.7). */
export const HISTORY_WEEKS = 5;

const EMPTY_DAYS: ReadonlySet<LocalDateIso> = new Set();

/** History of a habit (spec habits 4.7): 5 weeks Monday to Sunday, streak and success rate. */
@Component({
  selector: 'app-habit-history',
  imports: [TranslocoPipe],
  templateUrl: './habit-history.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-w-0 flex-col gap-2' },
})
export class HabitHistoryComponent {
  readonly habit = input.required<Habit>();

  private readonly store = inject(HabitStore);
  private readonly today = inject(Today);
  private readonly display = inject(TimeDisplay);
  private readonly transloco = inject(TranslocoService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly fmt: HabitLabelFormat = this.makeFormat();

  protected readonly weekdays = WEEKDAYS;
  /** i18n key of the last failed check. */
  protected readonly error = signal<string | null>(null);
  /** `day` of the checks waiting for Rust's answer. */
  private readonly pending = signal<ReadonlySet<LocalDateIso>>(new Set());
  /** Day that holds the single tab stop of the whole grid (default: today). */
  private readonly roving = signal<LocalDateIso | undefined>(undefined);

  private failedAt: unknown = null;

  constructor() {
    // A successful re-read after a failed check clears its message (as in the strip).
    effect(() => {
      const checks = this.store.checks();
      untracked(() => {
        if (checks !== this.failedAt) this.error.set(null);
      });
    });
  }

  private readonly checked = computed(() => this.store.checks().get(this.habit().id) ?? EMPTY_DAYS);

  /** Weeks in rows, oldest first; future days are not part of the grid. */
  protected readonly weeks = computed<readonly (readonly Cell[])[]>(() => {
    const habit = this.habit();
    const checked = this.checked();
    const today = this.today.date();
    const first = addDays(startOfIsoWeek(today), -7 * (HISTORY_WEEKS - 1));
    return Array.from({ length: HISTORY_WEEKS }, (_, week) =>
      Array.from({ length: 7 }, (_unused, d) => addDays(first, 7 * week + d))
        .filter((day) => compareLocalDates(day, today) <= 0)
        .map((day) => makeCell(habit, day, today, checked, this.fmt)),
    );
  });

  private readonly usable = computed(() =>
    this.weeks()
      .flat()
      .filter((c) => !c.beforeStart),
  );

  protected readonly streakText = computed(() =>
    historyStreakText(
      currentStreak(this.habit(), this.checked(), this.today.date(), this.store.windowStart()),
      this.fmt,
    ),
  );
  protected readonly rate = computed(() => {
    const rate = successRate(this.habit(), this.checked(), this.today.date());
    return rateText(
      this.habit().schedule.kind === 'days' ? 'days' : 'weeks',
      rate,
      ratePercent(rate),
      this.fmt,
    );
  });

  protected cellClass(cell: Cell): string {
    return cellClass(cell);
  }

  protected cellPending(cell: Cell): boolean {
    return this.pending().has(cell.day);
  }

  protected tabIndexOf(cell: Cell): number {
    const day = tabStopDay(this.usable(), this.roving(), this.today.date());
    return cell.day === day && !cell.beforeStart ? 0 : -1;
  }

  protected setRoving(cell: Cell): void {
    this.roving.set(cell.day);
  }

  /** Leaving the grid gives the tab stop back to today. */
  protected onFocusOut(event: FocusEvent): void {
    const group = event.currentTarget as HTMLElement;
    if (event.relatedTarget instanceof Node && group.contains(event.relatedTarget)) return;
    this.roving.set(undefined);
  }

  /** Arrows move by day (left/right) or by week (up/down); Home and End go to the ends. */
  protected onKeydown(event: KeyboardEvent): void {
    const usable = this.usable();
    if (usable.length === 0) return;
    const active = activeDay(event);
    const index = usable.findIndex((c) => c.day === active);
    let target: LocalDateIso | undefined;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      if (active === undefined) return;
      const wanted = shiftWeeks(active, event.key === 'ArrowUp' ? -1 : 1);
      target = usable.find((c) => c.day === wanted)?.day ?? active;
    } else {
      const next = linearMove(event.key, index, usable.length);
      if (next === null) return;
      target = usable[next].day;
    }
    event.preventDefault();
    focusCell(this.host.nativeElement, this.key(target), false, this.injector);
  }

  protected async toggle(cell: Cell): Promise<void> {
    if (this.pending().has(cell.day) || cell.beforeStart) return;
    const habitId = this.habit().id;
    this.setRoving(cell);
    this.pending.update((p) => new Set(p).add(cell.day));
    this.error.set(null);
    try {
      await this.store.setCheck(habitId, cell.day, !cell.done);
    } catch (error) {
      this.failedAt = this.store.checks();
      this.error.set(problemOf(error).key);
    } finally {
      this.pending.update((p) => {
        const next = new Set(p);
        next.delete(cell.day);
        return next;
      });
    }
    // A disabled button loses the focus: give it back once the cell is enabled again.
    focusCell(this.host.nativeElement, this.key(cell.day), true, this.injector);
  }

  private key(day: LocalDateIso): string {
    return `history|${this.habit().id}|${day}`;
  }

  protected initial(code: (typeof WEEKDAYS)[number]): string {
    return this.fmt.t(`widgets.habits.weekdaysShort.${code}`);
  }

  private makeFormat(): HabitLabelFormat {
    const transloco = this.transloco;
    const display = this.display;
    return {
      t: (key, params) => transloco.translate(key, params),
      formatLongDate: (date) => display.formatLocalDate(date, 'weekday-long'),
      get lang() {
        return transloco.getActiveLang();
      },
    };
  }

  protected cellKey(cell: Cell): string {
    return this.key(cell.day);
  }
}
