import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  Signal,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { HabitStore, currentStreak, weekProgress, weekdayCode } from '../../core/habits';
import { TimeDisplay, Today, UserTimeZone, addDays } from '../../core/time';
import { injectWidgetContext } from '../../core/widgets';
import type { Habit, LocalDateIso } from '../../data';
import { activeDay, cellClass, focusCell, linearMove, makeCell, tabStopDay } from './habit-cell';
import type { Cell } from './habit-cell';
import { HabitDetailComponent } from './habit-detail.component';
import type { HabitDetailResult } from './habit-detail.component';
import { problemOf } from './habit-form';
import { reminderLabel, scheduleLabel, streakTexts, weekProgressLabel } from './habit-label';
import type { HabitLabelFormat } from './habit-label';
import type { HabitsConfig } from './habits.config';

const ANNOUNCE: Record<Exclude<HabitDetailResult, 'cancelled'>, string> = {
  saved: 'widgets.habits.saved',
  archived: 'widgets.habits.announce.archived',
  deleted: 'widgets.habits.announce.deleted',
};

const STRIP_DAYS = 7;
const EMPTY_DAYS: ReadonlySet<LocalDateIso> = new Set();

export interface RowView {
  readonly habit: Habit;
  readonly cells: readonly Cell[];
  readonly form: string;
  readonly reminder: string | null;
  /** The reminder exists but is disabled (archived then restored, or switched off). */
  readonly reminderOff: boolean;
  readonly streak: string;
  readonly streakSr: string;
  readonly progress: string | null;
}

function sameHabit(a: Habit | null, b: Habit | null): boolean {
  return a === b || (a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b));
}

@Component({
  selector: 'app-habits-widget',
  imports: [TranslocoPipe, HabitDetailComponent],
  templateUrl: './habits.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full min-h-0 flex-col gap-2 focus:outline-none', tabindex: '-1' },
})
export class HabitsComponent {
  protected readonly ctx = injectWidgetContext<HabitsConfig>();
  protected readonly store = inject(HabitStore);
  private readonly today = inject(Today);
  private readonly userZone = inject(UserTimeZone);
  private readonly display = inject(TimeDisplay);
  private readonly transloco = inject(TranslocoService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly fmt: HabitLabelFormat = this.makeFormat();

  protected readonly headingId = `habits-heading-${this.ctx.instanceId}`;
  protected readonly archivedId = `habits-archived-${this.ctx.instanceId}`;
  protected readonly view = signal<'main' | 'form'>('main');
  protected readonly editing = signal<Habit | null>(null);
  protected readonly archivedOpen = signal(false);
  protected readonly busy = signal(false);
  /** i18n key of the last failed action (check, restore, delete), distinct from read errors. */
  protected readonly actionError = signal<string | null>(null);
  protected readonly announcement = signal('');
  protected readonly confirmingDelete = signal<string | null>(null);
  /** `habitId|day` of the checks waiting for Rust's answer. */
  private readonly pending = signal<ReadonlySet<string>>(new Set());
  /** Day that holds the single tab stop of each row (default: today). */
  private readonly roving = signal<Readonly<Record<string, LocalDateIso>>>({});

  protected readonly unavailable = computed(() => this.store.error()?.kind === 'unavailable');
  protected readonly loadError = computed(() => this.store.error() !== null && !this.unavailable());
  protected readonly actionMessage = computed(() =>
    this.unavailable() ? null : this.actionError(),
  );

  /** Header of the strip: the 7 last days, today on the right. */
  protected readonly days = computed<readonly LocalDateIso[]>(() => {
    const today = this.today.date();
    return Array.from({ length: STRIP_DAYS }, (_, i) => addDays(today, i - (STRIP_DAYS - 1)));
  });
  protected readonly header = computed(() =>
    this.days().map((day) => ({
      day,
      initial: this.fmt.t(`widgets.habits.weekdaysShort.${weekdayCode(day)}`),
      today: day === this.today.date(),
    })),
  );

  private readonly byId = computed(() => new Map(this.store.habits().map((h) => [h.id, h])));
  /** One memoised computed per habit: a check re-computes only the row it belongs to. */
  private readonly rowSignals = new Map<string, Signal<RowView | null>>();

  protected readonly rows = computed<readonly RowView[]>(() => {
    const byId = this.byId();
    for (const id of this.rowSignals.keys()) if (!byId.has(id)) this.rowSignals.delete(id);
    return this.store
      .habits()
      .filter((h) => h.archivedAt === null)
      .flatMap((h) => {
        const row = this.rowSignal(h.id)();
        return row === null ? [] : [row];
      });
  });
  protected readonly archived = computed(() =>
    this.store.habits().filter((h) => h.archivedAt !== null),
  );
  protected readonly isEmpty = computed(() => this.store.habits().length === 0);

  private failedAt: readonly Habit[] | null = null;
  private openerKey = 'new';

  constructor() {
    // A successful re-read after a failed action clears its message.
    effect(() => {
      const list = this.store.habits();
      untracked(() => {
        if (list !== this.failedAt) this.actionError.set(null);
      });
    });
  }

  private rowSignal(id: string): Signal<RowView | null> {
    let row = this.rowSignals.get(id);
    if (row === undefined) {
      const habit = computed(() => this.byId().get(id) ?? null, { equal: sameHabit });
      // The store keeps the same Set while a habit's days do not change.
      const checked = computed(() => this.store.checks().get(id) ?? EMPTY_DAYS);
      row = computed(() => {
        const h = habit();
        return h === null
          ? null
          : this.buildRow(h, checked(), this.today.date(), this.store.windowStart());
      });
      this.rowSignals.set(id, row);
    }
    return row;
  }

  private buildRow(
    habit: Habit,
    checked: ReadonlySet<LocalDateIso>,
    today: LocalDateIso,
    windowStart: LocalDateIso,
  ): RowView {
    const cells = Array.from({ length: STRIP_DAYS }, (_, i) =>
      makeCell(habit, addDays(today, i - (STRIP_DAYS - 1)), today, checked, this.fmt),
    );
    const streak = streakTexts(currentStreak(habit, checked, today, windowStart), this.fmt);
    const progress = weekProgress(habit, checked, today);
    return {
      habit,
      cells,
      form: scheduleLabel(habit.schedule, this.fmt),
      reminder:
        habit.reminder === null
          ? null
          : reminderLabel(habit.reminder, this.userZone.id(), this.fmt),
      reminderOff: habit.reminder !== null && !habit.reminder.enabled,
      streak: streak.text,
      streakSr: streak.sr,
      progress: progress === null ? null : weekProgressLabel(progress, this.fmt),
    };
  }

  protected cellPending(row: RowView, cell: Cell): boolean {
    return this.pending().has(`${row.habit.id}|${cell.day}`);
  }

  protected cellClass(cell: Cell): string {
    return cellClass(cell);
  }

  protected tabIndexOf(row: RowView, cell: Cell): number {
    const day = tabStopDay(row.cells, this.roving()[row.habit.id], this.today.date());
    return cell.day === day && !cell.beforeStart ? 0 : -1;
  }

  protected setRoving(row: RowView, cell: Cell): void {
    this.roving.update((r) => ({ ...r, [row.habit.id]: cell.day }));
  }

  /** Leaving the row gives the tab stop back to today. */
  protected onFocusOut(event: FocusEvent, row: RowView): void {
    const group = event.currentTarget as HTMLElement;
    if (event.relatedTarget instanceof Node && group.contains(event.relatedTarget)) return;
    this.roving.update((r) => {
      if (!(row.habit.id in r)) return r;
      const next = { ...r };
      delete next[row.habit.id];
      return next;
    });
  }

  /** Arrows, Home and End move between the cells of a row; Space and Enter click natively. */
  protected onKeydown(event: KeyboardEvent, row: RowView): void {
    const usable = row.cells.filter((c) => !c.beforeStart);
    if (usable.length === 0) return;
    const index = usable.findIndex((c) => c.day === activeDay(event));
    const next = linearMove(event.key, index, usable.length);
    if (next === null) return;
    event.preventDefault();
    this.focusCell(row.habit.id, usable[next].day, false);
  }

  protected async toggle(row: RowView, cell: Cell): Promise<void> {
    const key = `${row.habit.id}|${cell.day}`;
    if (this.pending().has(key) || cell.beforeStart) return;
    this.setRoving(row, cell);
    this.pending.update((p) => new Set(p).add(key));
    this.actionError.set(null);
    try {
      await this.store.setCheck(row.habit.id, cell.day, !cell.done);
    } catch (error) {
      this.failedAt = this.store.habits();
      this.actionError.set(problemOf(error).key);
    } finally {
      this.pending.update((p) => {
        const next = new Set(p);
        next.delete(key);
        return next;
      });
    }
    // A disabled button loses the focus: give it back once the cell is enabled again.
    this.focusCell(row.habit.id, cell.day, true);
  }

  private focusCell(habitId: string, day: LocalDateIso, afterRender: boolean): void {
    focusCell(this.host.nativeElement, `strip|${habitId}|${day}`, afterRender, this.injector);
  }

  protected openNew(): void {
    this.openForm(null, 'new');
  }

  protected openDetail(habit: Habit): void {
    this.openForm(habit, `detail-${habit.id}`);
  }

  private openForm(habit: Habit | null, key: string): void {
    this.openerKey = key;
    this.announcement.set('');
    this.confirmingDelete.set(null);
    this.editing.set(habit);
    this.view.set('form');
  }

  protected closeForm(result: HabitDetailResult): void {
    this.view.set('main');
    this.editing.set(null);
    if (result === 'cancelled') {
      this.announcement.set('');
    } else {
      this.announcement.set(this.t(ANNOUNCE[result]));
    }
    this.focus(result === 'saved' || result === 'cancelled' ? this.openerKey : null);
  }

  protected toggleArchived(): void {
    this.archivedOpen.update((open) => !open);
  }

  protected askDelete(id: string): void {
    this.confirmingDelete.set(id);
  }

  protected cancelDelete(): void {
    this.confirmingDelete.set(null);
  }

  protected async restore(habit: Habit): Promise<void> {
    await this.run(
      () => this.store.setArchived(habit.id, false),
      'widgets.habits.announce.restored',
    );
  }

  protected async remove(habit: Habit): Promise<void> {
    await this.run(() => this.store.remove(habit.id), 'widgets.habits.announce.deleted');
    this.confirmingDelete.set(null);
  }

  private async run(action: () => Promise<unknown>, announceKey: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.actionError.set(null);
    try {
      await action();
      this.announcement.set(this.t(announceKey));
    } catch (error) {
      this.failedAt = this.store.habits();
      this.actionError.set(problemOf(error).key);
    } finally {
      this.busy.set(false);
    }
    this.focus(null);
  }

  /** Returns the focus to the control that opened the form, else to the heading. */
  private focus(key: string | null): void {
    afterNextRender(
      () => {
        const host = this.host.nativeElement;
        const target =
          (key === null ? null : host.querySelector<HTMLElement>(`[data-focus-key="${key}"]`)) ??
          host.querySelector<HTMLElement>(`#${CSS.escape(this.headingId)}`) ??
          host;
        target.focus();
      },
      { injector: this.injector },
    );
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

  protected t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(key, params);
  }
}
