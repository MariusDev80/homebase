import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { HabitStore, WEEKDAYS } from '../../core/habits';
import { Today, UserTimeZone } from '../../core/time';
import { injectWidgetContext } from '../../core/widgets';
import { DataError, HABIT_LIMITS, randomUuid } from '../../data';
import type { Habit, HabitInput, WeekdayCode } from '../../data';
import {
  effectiveReminderDays,
  fieldShown,
  formToInput,
  formWarnings,
  habitToForm,
  newHabitForm,
  problemOf,
  sortedDays,
} from './habit-form';
import type { HabitField, HabitFormErrors, HabitFormState, HabitKind } from './habit-form';
import { HabitHistoryComponent } from './habit-history.component';
import type { HabitsConfig } from './habits.config';

/** What happened when the panel closed (the parent announces it). */
export type HabitDetailResult = 'saved' | 'archived' | 'deleted' | 'cancelled';

const FIELD_ORDER: readonly HabitField[] = [
  'title',
  'days',
  'target',
  'startOn',
  'reminderTime',
  'reminderDays',
];

/** Form panel of a habit (spec habits 4.7): explicit Save / Cancel (H10), nothing is written before. */
@Component({
  selector: 'app-habit-detail',
  imports: [TranslocoPipe, HabitHistoryComponent],
  templateUrl: './habit-detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-0 flex-1 flex-col' },
})
export class HabitDetailComponent {
  /** The habit as it was when the panel opened; null = new habit. */
  readonly habit = input<Habit | null>(null);
  readonly closed = output<HabitDetailResult>();

  private readonly ctx = injectWidgetContext<HabitsConfig>();
  private readonly store = inject(HabitStore);
  private readonly today = inject(Today);
  private readonly userZone = inject(UserTimeZone);
  private readonly transloco = inject(TranslocoService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * Generated once, when the panel opens (the component lives as long as the panel): every Save
   * reuses it, so a retry after a failure or a double click cannot create a duplicate (spec 4.4).
   */
  private readonly newId = randomUuid();

  protected readonly instanceId = this.ctx.instanceId;
  protected readonly titleMax = HABIT_LIMITS.titleMaxChars;
  protected readonly weekdays = WEEKDAYS;
  protected readonly kinds: readonly HabitKind[] = ['days', 'weekly'];

  protected readonly state = signal<HabitFormState>(newHabitForm('2000-01-01', 'UTC'));
  private readonly initial = signal<HabitFormState | null>(null);
  protected readonly errors = signal<HabitFormErrors>({});
  /** i18n key of an error that belongs to no visible field. */
  protected readonly formError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly confirmingDelete = signal(false);
  protected readonly confirmingDiscard = signal(false);

  protected readonly isNew = computed(() => this.habit() === null);
  /** Upper bound of the start date. */
  protected readonly todayDate = this.today.date;
  /** The habit has a reminder that is switched off in the form: say so. */
  protected readonly reminderOffNote = computed(() => {
    const s = this.state();
    return s.hadReminder && !s.reminderOn
      ? this.t('widgets.habits.reminderOff', { time: s.reminderTime })
      : null;
  });
  protected readonly dirty = computed(() => {
    const initial = this.initial();
    return initial !== null && JSON.stringify(initial) !== JSON.stringify(this.state());
  });
  protected readonly reminderDays = computed(() => effectiveReminderDays(this.state()));
  protected readonly warnings = computed(() => {
    try {
      return formWarnings(this.state(), this.today.date()).map((w) => this.t(w.key, w.params));
    } catch {
      return [];
    }
  });
  protected readonly zoneText = computed(() =>
    this.t('widgets.habits.zone', { zone: this.state().timeZone }),
  );

  constructor() {
    // The state is read once: later re-reads of the store must not overwrite what is typed.
    effect(() => {
      const h = this.habit();
      untracked(() => {
        const zone = this.userZone.id();
        const state = h === null ? newHabitForm(this.today.date(), zone) : habitToForm(h, zone);
        this.state.set(state);
        this.initial.set(state);
        this.errors.set({});
        this.formError.set(null);
        this.confirmingDelete.set(false);
        this.confirmingDiscard.set(false);
      });
    });
    afterNextRender(() => this.focusField('title'), { injector: this.injector });
  }

  protected id(name: string): string {
    return `habit-${name}-${this.instanceId}`;
  }

  private patch(change: Partial<HabitFormState>, ...fields: HabitField[]): void {
    this.state.update((s) => ({ ...s, ...change }));
    if (fields.length > 0) {
      this.errors.update((e) => {
        const next = { ...e };
        for (const field of fields) delete next[field];
        return next;
      });
    }
    this.formError.set(null);
    this.confirmingDelete.set(false);
    this.confirmingDiscard.set(false);
  }

  private text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected onTitle(event: Event): void {
    this.patch({ title: this.text(event) }, 'title');
  }

  protected onKind(kind: HabitKind): void {
    this.patch({ kind }, 'days', 'target');
  }

  protected onDay(day: WeekdayCode, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const without = this.state().days.filter((d) => d !== day);
    this.patch({ days: sortedDays(checked ? [...without, day] : without) }, 'days');
  }

  protected allDays(): void {
    this.patch({ days: WEEKDAYS }, 'days');
  }

  protected onTarget(event: Event): void {
    this.patch({ target: this.text(event) }, 'target');
  }

  protected onStartOn(event: Event): void {
    this.patch({ startOn: this.text(event) }, 'startOn');
  }

  protected onReminderOn(event: Event): void {
    this.patch(
      { reminderOn: (event.target as HTMLInputElement).checked },
      'reminderTime',
      'reminderDays',
    );
  }

  protected onReminderTime(event: Event): void {
    this.patch({ reminderTime: this.text(event) }, 'reminderTime');
  }

  protected onReminderDay(day: WeekdayCode, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const without = this.reminderDays().filter((d) => d !== day);
    this.patch({ reminderDays: sortedDays(checked ? [...without, day] : without) }, 'reminderDays');
  }

  protected async save(): Promise<void> {
    if (this.busy()) return;
    this.formError.set(null);
    const result = formToInput(this.state(), this.today.date());
    if ('errors' in result) {
      this.showErrors(result.errors);
      return;
    }
    this.errors.set({});
    this.busy.set(true);
    try {
      const existing = this.habit();
      if (existing === null) await this.store.create({ ...result.input, id: this.newId });
      else await this.store.update(existing.id, result.input);
      this.closed.emit('saved');
    } catch (error) {
      if (error instanceof DataError && error.kind === 'conflict' && this.habit() === null) {
        await this.saveOverExisting(result.input);
      } else {
        this.showProblem(error);
      }
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * `conflict` on create = an earlier attempt with this id went through. Update that habit with
   * what is typed now, so that a correction made since is not lost (spec 4.4).
   */
  private async saveOverExisting(input: HabitInput): Promise<void> {
    try {
      await this.store.update(this.newId, input);
      this.closed.emit('saved');
    } catch (error) {
      this.showProblem(error);
    }
  }

  /** Cancel / Escape / Back: asks first when something was typed. */
  protected cancel(): void {
    if (this.busy()) return;
    // Escape first backs out of a pending deletion.
    if (this.confirmingDelete()) {
      this.confirmingDelete.set(false);
      return;
    }
    if (this.dirty() && !this.confirmingDiscard()) {
      this.confirmingDiscard.set(true);
      return;
    }
    this.closed.emit('cancelled');
  }

  protected keepEditing(): void {
    this.confirmingDiscard.set(false);
    this.focusField('title');
  }

  protected async archive(): Promise<void> {
    const h = this.habit();
    if (h === null || this.busy()) return;
    this.formError.set(null);
    this.busy.set(true);
    try {
      await this.store.setArchived(h.id, true);
      this.closed.emit('archived');
    } catch (error) {
      this.showProblem(error);
    } finally {
      this.busy.set(false);
    }
  }

  protected askDelete(): void {
    this.confirmingDelete.set(true);
  }

  protected cancelDelete(): void {
    this.confirmingDelete.set(false);
  }

  protected async remove(): Promise<void> {
    const h = this.habit();
    if (h === null || this.busy()) return;
    this.formError.set(null);
    this.busy.set(true);
    try {
      await this.store.remove(h.id);
      this.closed.emit('deleted');
    } catch (error) {
      this.confirmingDelete.set(false);
      this.showProblem(error);
    } finally {
      this.busy.set(false);
    }
  }

  private showErrors(errors: HabitFormErrors): void {
    const shown: HabitFormErrors = {};
    for (const field of FIELD_ORDER) {
      const key = errors[field];
      if (key === undefined) continue;
      if (fieldShown(this.state(), field)) shown[field] = key;
      else this.formError.set(key);
    }
    this.errors.set(shown);
    const first = FIELD_ORDER.find((f) => shown[f] !== undefined);
    if (first !== undefined) this.focusField(first);
  }

  private showProblem(error: unknown): void {
    const problem = problemOf(error);
    if (problem.field === 'form' || !fieldShown(this.state(), problem.field)) {
      this.formError.set(problem.key);
      return;
    }
    const { field, key } = problem;
    this.errors.update((e) => ({ ...e, [field]: key }));
    this.focusField(field);
  }

  private focusField(field: HabitField): void {
    afterNextRender(
      () => {
        this.host.nativeElement.querySelector<HTMLElement>(`[data-field="${field}"]`)?.focus();
      },
      { injector: this.injector },
    );
  }

  protected t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(key, params);
  }
}
