import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  output,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { CALENDAR_AGENDA_DAYS } from './calendar.config';
import type { CalendarAgendaDays, CalendarViewKind } from './calendar.config';

/** The own toolbar of the widget (ADR-004 D8): navigation, title, view and number of days. */
@Component({
  selector: 'app-calendar-toolbar',
  imports: [TranslocoPipe],
  templateUrl: './calendar-toolbar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class CalendarToolbarComponent {
  private readonly titleEl = viewChild.required<ElementRef<HTMLElement>>('titleRef');
  private readonly monthButton = viewChild<ElementRef<HTMLElement>>('monthButton');

  readonly instanceId = input.required<string>();
  readonly title = input.required<string>();
  /** The effective view (it can be Agenda while the configuration says Month). */
  readonly view = input.required<CalendarViewKind>();
  /** The card is big enough for the Month (T6): otherwise the view choice is hidden. */
  readonly monthAllowed = input.required<boolean>();
  /** Under 20rem the choice of the number of days is hidden. */
  readonly daysAllowed = input.required<boolean>();
  readonly agendaDays = input.required<CalendarAgendaDays>();

  readonly previous = output();
  readonly next = output();
  readonly today = output();
  readonly viewChange = output<CalendarViewKind>();
  readonly agendaDaysChange = output<CalendarAgendaDays>();

  protected readonly dayChoices = CALENDAR_AGENDA_DAYS;
  protected readonly daysId = computed(() => `calendar-days-${this.instanceId()}`);
  protected readonly isMonth = computed(() => this.view() === 'month');

  focusMonthButton(): void {
    this.monthButton()?.nativeElement.focus();
  }

  focusTitle(): void {
    this.titleEl().nativeElement.focus();
  }

  protected onDays(value: string): void {
    const days = Number(value);
    const choice = CALENDAR_AGENDA_DAYS.find((candidate) => candidate === days);
    if (choice !== undefined) this.agendaDaysChange.emit(choice);
  }
}
