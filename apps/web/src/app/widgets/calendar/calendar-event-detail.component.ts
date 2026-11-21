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
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { CalendarEvent } from '../../core/calendar';
import { TimeDisplay, UserTimeZone, zoneCity } from '../../core/time';
import { WidgetRegistry } from '../../core/widgets/widget-registry';
import { eventDateText, recurringKey, sourceLabel } from './calendar-label';
import type { CalendarTranslate } from './calendar-label';
import { TONE_CLASS } from './calendar-tone';

/**
 * The event sheet (spec calendar 4.7, D4): covers the body of the card like the Day panel. Escape
 * and "Retour" close it; the host gives the focus back. Read-only: no action.
 */
@Component({
  selector: 'app-calendar-event-detail',
  imports: [TranslocoPipe],
  templateUrl: './calendar-event-detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'absolute inset-0 z-[2] overflow-y-auto bg-canvas',
    'data-testid': 'calendar-event-detail',
    '(keydown.escape)': 'onEscape($event)',
  },
})
export class CalendarEventDetailComponent {
  private readonly display = inject(TimeDisplay);
  private readonly zone = inject(UserTimeZone);
  private readonly registry = inject(WidgetRegistry);
  private readonly transloco = inject(TranslocoService);
  private readonly back = viewChild.required<ElementRef<HTMLButtonElement>>('back');

  readonly event = input.required<CalendarEvent>();

  readonly closed = output();

  private readonly t: CalendarTranslate = (key, params) => this.transloco.translate(key, params);

  protected readonly definition = computed(() => this.registry.get(this.event().sourceType));
  protected readonly icon = computed(() => this.definition()?.icon ?? 'pi pi-calendar');
  protected readonly toneClass = computed(() => TONE_CLASS[this.event().tone]);
  protected readonly source = computed(() =>
    sourceLabel(this.event(), this.t, this.definition()?.titleKey),
  );
  protected readonly date = computed(() =>
    eventDateText(this.event(), this.display, this.zone.id(), this.t),
  );
  protected readonly status = computed(() => this.event().status ?? null);
  protected readonly recurring = computed(() => recurringKey(this.event()));

  /** "à 09:00", plus "(09:00 Paris)" when the event was set in another zone; null when all-day. */
  protected readonly time = computed(() => {
    const time = this.event().time;
    if (time.kind !== 'timed') return null;
    const local = this.display.formatInstant(time.start, 'time');
    const at = this.t('widgets.calendar.at', { time: local });
    if (time.timeZone === this.zone.id()) return at;
    try {
      const own = this.t('widgets.calendar.zoneTime', {
        time: this.display.formatInstant(time.start, 'time', time.timeZone),
        city: zoneCity(time.timeZone),
      });
      return this.t('widgets.calendar.atWithZone', { at, zone: own });
    } catch {
      // An unreadable zone of the event: the time in the display zone is enough.
      return at;
    }
  });

  constructor() {
    afterNextRender(() => this.back().nativeElement.focus());
  }

  protected onEscape(event: Event): void {
    if ((event as KeyboardEvent).isComposing) return;
    event.stopPropagation();
    this.closed.emit();
  }
}
