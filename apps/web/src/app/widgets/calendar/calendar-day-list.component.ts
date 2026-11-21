import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { CalendarEvent } from '../../core/calendar';
import { TimeDisplay, UserTimeZone, addDays, compareLocalDates } from '../../core/time';
import { WidgetRegistry } from '../../core/widgets/widget-registry';
import type { LocalDateIso } from '../../data';
import { groupByDay, withToday } from './calendar-days';
import { timeLabel } from './calendar-label';
import { TONE_CLASS } from './calendar-tone';

export interface DayListSelection {
  readonly event: CalendarEvent;
  /** The row, to give the focus back to it. */
  readonly trigger: HTMLElement;
}

/** The Agenda (several days) and the content of the Day panel (one day): spec calendar T1. */
@Component({
  selector: 'app-calendar-day-list',
  imports: [TranslocoPipe],
  templateUrl: './calendar-day-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarDayListComponent {
  private readonly display = inject(TimeDisplay);
  private readonly zone = inject(UserTimeZone);
  private readonly registry = inject(WidgetRegistry);
  private readonly transloco = inject(TranslocoService);

  readonly events = input.required<readonly CalendarEvent[]>();
  readonly firstOn = input.required<LocalDateIso>();
  readonly lastOn = input.required<LocalDateIso>();
  readonly today = input.required<LocalDateIso>();
  /** The Day panel draws its own title, so it hides the day headers. */
  readonly showHeaders = input(true);
  /** Show today even when it has no event (L14). Off in the Day panel. */
  readonly emptyToday = input(true);
  readonly instanceId = input('agenda');

  readonly eventSelected = output<DayListSelection>();

  protected readonly groups = computed(() => {
    const groups = groupByDay(this.events(), this.firstOn(), this.lastOn(), this.zone.id());
    return this.emptyToday()
      ? withToday(groups, this.today(), this.firstOn(), this.lastOn())
      : groups;
  });

  protected readonly rows = computed(() =>
    this.groups().map((group) => {
      const day = group.day;
      const tomorrow = addDays(this.today(), 1);
      return {
        day,
        headingId: `${this.instanceId()}-day-${day}`,
        short: this.display.formatLocalDate(day, 'weekday-day-month'),
        long: this.display.formatLocalDate(day, 'weekday-long'),
        isToday: day === this.today(),
        isTomorrow: day === tomorrow,
        isPast: compareLocalDates(day, this.today()) < 0,
        events: group.events.map((event) => ({
          event,
          time: this.timeOf(event),
          icon: this.registry.get(event.sourceType)?.icon ?? 'pi pi-calendar',
          toneClass: TONE_CLASS[event.tone],
          overdue: event.tone === 'danger',
        })),
      };
    }),
  );

  protected readonly rangeText = computed(() => ({
    from: this.display.formatLocalDate(this.firstOn(), 'day-month'),
    to: this.display.formatLocalDate(this.lastOn(), 'day-month'),
  }));

  protected select(event: CalendarEvent, domEvent: Event): void {
    const trigger = domEvent.currentTarget;
    if (trigger instanceof HTMLElement) this.eventSelected.emit({ event, trigger });
  }

  private timeOf(event: CalendarEvent): string {
    return timeLabel(event, {
      time: (instant) => this.display.formatInstant(instant, 'time'),
      allDay: () => this.transloco.translate('widgets.calendar.allDay'),
    });
  }
}
