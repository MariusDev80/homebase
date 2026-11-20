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
import { ReminderStore } from '../../core/reminders';
import {
  CLOCK,
  INTERVAL_MAX,
  RECURRENCE_ENGINE,
  TimeDisplay,
  UserTimeZone,
  addDays,
  addDuration,
  isValidLocalDate,
  toLocalDate,
} from '../../core/time';
import type { Weekday } from '../../core/time';
import { injectWidgetContext } from '../../core/widgets';
import { SCHEDULE_LIMITS } from '../../data';
import type { InstantIso, Reminder } from '../../data';
import {
  WEEKDAYS,
  dayOfMonth,
  fieldShown,
  formToInput,
  formWarnings,
  inputToForm,
  mergeExdates,
  newFormState,
  problemOf,
  repeatOptions,
  scheduleOf,
  weekdayOf,
} from './reminder-form';
import type { EndChoice, FormErrors, FormField, FormState, RepeatChoice } from './reminder-form';
import { createLabelFormat } from './reminder-format';
import { nthLabel, recurrenceLabel } from './reminder-label';
import type { RemindersConfig } from './reminders.config';

/** `not-ringing`: saved, but the scheduler found nothing to ring (the parent warns). */
export type ReminderDetailResult = 'saved' | 'deleted' | 'skipped' | 'cancelled' | 'not-ringing';

/** The preview range is bounded by the engine (400 days). */
const PREVIEW_RANGE_MS = 400 * 86_400_000;
const PREVIEW_COUNT = 3;
/** Wait for the typing to pause before asking the engine. */
const PREVIEW_DELAY_MS = 200;
const DEFAULT_TIME = '09:00';
const FIELD_ORDER: readonly FormField[] = [
  'title',
  'date',
  'time',
  'repeat',
  'interval',
  'weekdays',
  'count',
  'until',
];

/** Form panel of a reminder (spec 4.8): explicit Save / Cancel (M12), nothing is written before. */
@Component({
  selector: 'app-reminder-detail',
  imports: [TranslocoPipe],
  templateUrl: './reminder-detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-0 flex-1 flex-col' },
})
export class ReminderDetailComponent {
  /** The reminder as it was when the panel opened; null = new reminder. */
  readonly reminder = input<Reminder | null>(null);
  readonly closed = output<ReminderDetailResult>();

  private readonly ctx = injectWidgetContext<RemindersConfig>();
  private readonly store = inject(ReminderStore);
  private readonly userZone = inject(UserTimeZone);
  private readonly clock = inject(CLOCK);
  private readonly engine = inject(RECURRENCE_ENGINE);
  private readonly display = inject(TimeDisplay);
  private readonly transloco = inject(TranslocoService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly fmt = createLabelFormat(this.transloco, this.display);

  protected readonly instanceId = this.ctx.instanceId;
  protected readonly titleMax = SCHEDULE_LIMITS.titleMaxChars;
  protected readonly weekdays = WEEKDAYS;
  protected readonly ends: readonly EndChoice[] = ['never', 'count', 'until'];

  protected readonly state = signal<FormState>(newFormState('2000-01-01', DEFAULT_TIME));
  /** The form as opened: the "past date" check and the unsaved-changes guard compare to it. */
  private readonly initial = signal<FormState | null>(null);
  protected readonly errors = signal<FormErrors>({});
  /** i18n key of an error that belongs to no field (command refused, unavailable...). */
  protected readonly formError = signal<string | null>(null);
  /** i18n key of an error on a rule the form cannot edit (shown under the rule text). */
  protected readonly customError = signal<string | null>(null);
  /** i18n key of a note on the skip button (the next occurrence moved, or none is left). */
  protected readonly skipNote = signal<string | null>(null);
  protected readonly unreadable = signal(false);
  protected readonly busy = signal(false);
  protected readonly confirmingDelete = signal(false);
  protected readonly confirmingDiscard = signal(false);
  protected readonly previewTimes = signal<readonly InstantIso[]>([]);

  /** The occurrence the user saw when opening (or last confirmed) for the skip button. */
  private seenNextKey: string | null = null;

  /** A reminder keeps its zone; a new one takes the user's. */
  protected readonly zone = computed(() => this.reminder()?.timeZone ?? this.userZone.id());
  protected readonly isNew = computed(() => this.reminder() === null);
  protected readonly dirty = computed(() => {
    const initial = this.initial();
    return initial !== null && JSON.stringify(initial) !== JSON.stringify(this.state());
  });
  protected readonly canSkip = computed(() => {
    const r = this.reminder();
    return r !== null && r.rrule !== null && r.status === 'scheduled';
  });
  /** The next occurrence the skip button would skip, read from the store (not from the opening). */
  protected readonly skipKey = computed(() => {
    const id = this.reminder()?.id;
    return this.store.reminders().find((r) => r.id === id)?.nextFireKey ?? null;
  });
  protected readonly skipLabel = computed(() => {
    const key = this.skipKey();
    if (key === null) return this.t('widgets.reminders.skipNext');
    try {
      const date = this.display.formatLocalDate(key.slice(0, 10), 'weekday-day-month');
      return this.t('widgets.reminders.skipNextAt', { when: `${date}, ${key.slice(11, 16)}` });
    } catch {
      return this.t('widgets.reminders.skipNext');
    }
  });
  protected readonly choices = computed(() => {
    const options = repeatOptions(this.state().date);
    return this.state().repeat === 'custom' ? [...options, 'custom' as const] : options;
  });
  protected readonly recurring = computed(() => fieldShown(this.state(), 'interval'));
  protected readonly intervalUnit = computed(() => {
    switch (this.state().repeat) {
      case 'daily':
        return 'DAILY';
      case 'weekly':
        return 'WEEKLY';
      case 'yearly':
        return 'YEARLY';
      default:
        return 'MONTHLY';
    }
  });
  protected readonly intervalMax = computed(() => INTERVAL_MAX[this.intervalUnit()]);
  protected readonly warnings = computed(() => {
    try {
      return formWarnings(this.state(), this.zone()).map((w) => this.t(w.key, w.params));
    } catch {
      return [];
    }
  });
  protected readonly customLabel = computed(() => {
    const s = this.state();
    try {
      return recurrenceLabel(s.customRule, `${s.date}T${s.time}:00`, this.zone(), this.fmt);
    } catch {
      return this.t('widgets.reminders.label.custom');
    }
  });
  protected readonly previewLabels = computed(() =>
    this.previewTimes().map((at) => {
      try {
        return this.display.formatInstant(at, 'date-time');
      } catch {
        return at;
      }
    }),
  );
  protected readonly zoneText = computed(() =>
    this.t('widgets.reminders.zone', { zone: this.zone() }),
  );

  /** Everything the engine needs to preview; null when the form is not (yet) schedulable. */
  private readonly schedule = computed(() => {
    try {
      const result = scheduleOf(this.state(), this.zone(), this.clock.nowIso(), this.initial());
      return 'schedule' in result ? result.schedule : null;
    } catch {
      return null;
    }
  });
  /** Changes only when the anchor, rule or exceptions change: typing a title does not count. */
  private readonly previewKey = computed(
    () => {
      const s = this.schedule();
      if (s === null || !s.enabled) return null;
      return JSON.stringify([s.startLocal, s.timeZone, s.rrule, s.exdates]);
    },
    { equal: (a, b) => a === b },
  );

  private previewSeq = 0;

  constructor() {
    // The state is read once: later re-reads of the store must not overwrite what is typed.
    effect(() => {
      const r = this.reminder();
      untracked(() => {
        let state: FormState;
        let unreadable = false;
        try {
          state = r === null ? this.blankState() : inputToForm(r);
        } catch {
          unreadable = true;
          state = { ...this.blankState(), title: r?.title ?? '', enabled: r?.enabled ?? true };
        }
        this.state.set(state);
        this.initial.set(state);
        this.unreadable.set(unreadable);
        this.seenNextKey = r?.nextFireKey ?? null;
        this.errors.set({});
        this.formError.set(null);
        this.customError.set(null);
        this.skipNote.set(null);
        this.confirmingDelete.set(false);
        this.confirmingDiscard.set(false);
      });
    });
    effect((onCleanup) => {
      const key = this.previewKey();
      if (key === null) {
        untracked(() => {
          this.previewSeq++;
          this.previewTimes.set([]);
        });
        return;
      }
      const timer = setTimeout(() => {
        const schedule = untracked(() => this.schedule());
        void this.loadPreview(schedule);
      }, PREVIEW_DELAY_MS);
      onCleanup(() => clearTimeout(timer));
    });
    afterNextRender(() => this.focusField('title'), { injector: this.injector });
  }

  private blankState(): FormState {
    const tomorrow = addDays(toLocalDate(this.clock.nowIso(), this.userZone.id()), 1);
    return newFormState(tomorrow, DEFAULT_TIME);
  }

  private async loadPreview(
    schedule: ReturnType<ReminderDetailComponent['schedule']>,
  ): Promise<void> {
    const mine = ++this.previewSeq;
    if (schedule === null) {
      this.previewTimes.set([]);
      return;
    }
    try {
      const now = this.clock.nowIso();
      const result = await this.engine.expand(
        {
          anchor: {
            kind: 'date-time',
            startLocal: schedule.startLocal,
            timeZone: schedule.timeZone,
          },
          rrule: schedule.rrule,
          exdates: schedule.exdates,
        },
        {
          from: now,
          to: addDuration(now, PREVIEW_RANGE_MS),
          timeZone: this.userZone.id(),
          limit: PREVIEW_COUNT,
        },
      );
      if (mine !== this.previewSeq) return;
      this.previewTimes.set(
        result.occurrences.flatMap((o) => (o.kind === 'date-time' ? [o.start] : [])),
      );
    } catch {
      if (mine === this.previewSeq) this.previewTimes.set([]);
    }
  }

  protected id(name: string): string {
    return `reminder-${name}-${this.instanceId}`;
  }

  protected repeatLabel(choice: RepeatChoice): string {
    const s = this.state();
    const p = 'widgets.reminders.repeat.';
    switch (choice) {
      case 'none':
        return this.t(p + 'none');
      case 'daily':
        return this.t(p + 'daily');
      case 'weekly':
        return this.t(p + 'weekly');
      case 'yearly':
        return this.t(p + 'yearly');
      case 'custom':
        return this.t(p + 'custom');
      case 'monthly-last':
        return this.t(p + 'monthlyLast');
      case 'monthly-day':
        return this.t(p + 'monthlyDay', {
          day: isValidLocalDate(s.date) ? dayOfMonth(s.date) : '',
        });
      case 'monthly-nth':
        return isValidLocalDate(s.date)
          ? this.t(p + 'monthlyNth', nthLabel(s.date, this.fmt))
          : this.t(p + 'monthlyDay', { day: '' });
    }
  }

  private patch(change: Partial<FormState>, ...fields: FormField[]): void {
    this.state.update((s) => ({ ...s, ...change }));
    if (fields.length > 0) {
      this.errors.update((e) => {
        const next = { ...e };
        for (const field of fields) delete next[field];
        return next;
      });
    }
    this.formError.set(null);
    this.customError.set(null);
    this.confirmingDelete.set(false);
    this.confirmingDiscard.set(false);
  }

  private text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected onTitle(event: Event): void {
    this.patch({ title: this.text(event) }, 'title');
  }

  protected onDate(event: Event): void {
    const old = this.state();
    const date = this.text(event);
    const change: { -readonly [K in keyof FormState]?: FormState[K] } = { date };
    if (isValidLocalDate(date)) {
      const followed =
        old.weekdays.length === 1 &&
        isValidLocalDate(old.date) &&
        old.weekdays[0] === weekdayOf(old.date);
      if (followed) change.weekdays = [weekdayOf(date)];
      if (old.repeat !== 'custom' && !repeatOptions(date).includes(old.repeat)) {
        change.repeat = 'monthly-day';
      }
      if (old.until < date) change.until = date;
    }
    this.patch(change, 'date', 'until');
  }

  protected onTime(event: Event): void {
    this.patch({ time: this.text(event) }, 'time');
  }

  protected onRepeat(event: Event): void {
    this.patch({ repeat: this.text(event) as RepeatChoice }, 'repeat');
  }

  protected onInterval(event: Event): void {
    this.patch({ interval: this.text(event) }, 'interval');
  }

  protected onWeekday(day: Weekday, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const without = this.state().weekdays.filter((d) => d !== day);
    this.patch({ weekdays: checked ? [...without, day] : without }, 'weekdays');
  }

  protected onEnd(event: Event): void {
    this.patch({ end: this.text(event) as EndChoice });
  }

  protected onCount(event: Event): void {
    this.patch({ count: this.text(event) }, 'count');
  }

  protected onUntil(event: Event): void {
    this.patch({ until: this.text(event) }, 'until');
  }

  protected onEnabled(event: Event): void {
    this.patch({ enabled: (event.target as HTMLInputElement).checked });
  }

  protected async save(): Promise<void> {
    if (this.busy()) return;
    this.formError.set(null);
    this.customError.set(null);
    this.busy.set(true);
    try {
      const result = formToInput(this.state(), this.zone(), this.clock.nowIso(), this.initial());
      if ('errors' in result) {
        this.showErrors(result.errors);
        return;
      }
      this.errors.set({});
      const checked = await this.engine.validate({
        anchor: {
          kind: 'date-time',
          startLocal: result.input.startLocal,
          timeZone: result.input.timeZone,
        },
        rrule: result.input.rrule,
        exdates: result.input.exdates,
      });
      const existing = this.reminder();
      // The exceptions skipped since the panel opened must survive this save.
      const current = existing && this.store.reminders().find((r) => r.id === existing.id);
      const checkedExdates = checked.exdates as typeof result.input.exdates;
      const input = {
        ...result.input,
        rrule: checked.rrule,
        exdates: current ? mergeExdates(current.exdates, checkedExdates) : checkedExdates,
      };
      const saved =
        existing === null
          ? await this.store.create(input)
          : await this.store.update(existing.id, input);
      this.closed.emit(saved.enabled && saved.status !== 'scheduled' ? 'not-ringing' : 'saved');
    } catch (error) {
      this.showProblem(error);
    } finally {
      this.busy.set(false);
    }
  }

  /** Cancel / Escape / Back: asks first when something was typed. */
  protected cancel(): void {
    if (this.busy()) return;
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

  protected async skipNext(): Promise<void> {
    const r = this.reminder();
    if (r === null || this.busy()) return;
    this.formError.set(null);
    const current = this.store.reminders().find((x) => x.id === r.id);
    const key = current?.nextFireKey ?? null;
    if (current === undefined || key === null) {
      this.skipNote.set('widgets.reminders.skipNone');
      return;
    }
    if (key !== this.seenNextKey) {
      // The occurrence moved since the user last looked: show the new target, ask again.
      this.seenNextKey = key;
      this.skipNote.set('widgets.reminders.skipChanged');
      return;
    }
    this.skipNote.set(null);
    this.busy.set(true);
    try {
      await this.store.skipNext(current);
      this.closed.emit('skipped');
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
    const r = this.reminder();
    if (r === null || this.busy()) return;
    this.formError.set(null);
    this.busy.set(true);
    try {
      await this.store.remove(r.id);
      this.closed.emit('deleted');
    } catch (error) {
      this.confirmingDelete.set(false);
      this.showProblem(error);
    } finally {
      this.busy.set(false);
    }
  }

  /** Field errors of the form; one on a field that is not on screen goes to the form or the rule. */
  private showErrors(errors: FormErrors): void {
    const shown: FormErrors = {};
    for (const field of FIELD_ORDER) {
      const key = errors[field];
      if (key === undefined) continue;
      if (fieldShown(this.state(), field)) shown[field] = key;
      else this.routeHidden(key);
    }
    this.errors.set(shown);
    const first = FIELD_ORDER.find((f) => shown[f] !== undefined);
    if (first !== undefined) this.focusField(first);
  }

  private routeHidden(key: string): void {
    if (this.state().repeat === 'custom') this.customError.set(key);
    else this.formError.set(key);
  }

  private showProblem(error: unknown): void {
    const problem = problemOf(error);
    if (problem.field === 'form') {
      this.formError.set(problem.key);
    } else if (!fieldShown(this.state(), problem.field)) {
      this.routeHidden(problem.key);
    } else {
      const { field, key } = problem;
      this.errors.update((e) => ({ ...e, [field]: key }));
      this.focusField(field);
    }
  }

  private focusField(field: FormField): void {
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
