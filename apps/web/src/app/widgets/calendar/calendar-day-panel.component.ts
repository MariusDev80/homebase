import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { CalendarEvent } from '../../core/calendar';
import { TimeDisplay } from '../../core/time';
import type { LocalDateIso } from '../../data';
import { CalendarDayListComponent } from './calendar-day-list.component';
import type { DayListSelection } from './calendar-day-list.component';

let nextTitleId = 0;

/**
 * The Day panel (spec calendar T2): replaces the body of the card, scrolls inside it. Escape and
 * "Retour" close it; the host gives the focus back.
 */
@Component({
  selector: 'app-calendar-day-panel',
  imports: [TranslocoPipe, CalendarDayListComponent],
  templateUrl: './calendar-day-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'absolute inset-0 overflow-y-auto bg-canvas',
    role: 'region',
    '[attr.aria-labelledby]': 'titleId',
    'data-testid': 'calendar-day-panel',
    '(keydown.escape)': 'onEscape($event)',
  },
})
export class CalendarDayPanelComponent {
  protected readonly titleId = `calendar-day-panel-title-${nextTitleId++}`;
  private readonly display = inject(TimeDisplay);
  private readonly back = viewChild.required<ElementRef<HTMLButtonElement>>('back');

  readonly day = input.required<LocalDateIso>();
  /** Already filtered to this day by the host. */
  readonly events = input.required<readonly CalendarEvent[]>();
  readonly today = input.required<LocalDateIso>();

  readonly closed = output();
  readonly eventSelected = output<DayListSelection>();

  protected readonly title = computed(() =>
    this.display.formatLocalDate(this.day(), 'weekday-long'),
  );

  constructor() {
    afterNextRender(() => this.back().nativeElement.focus());
  }

  protected onEscape(event: Event): void {
    if ((event as KeyboardEvent).isComposing) return;
    event.stopPropagation();
    this.closed.emit();
  }
}
