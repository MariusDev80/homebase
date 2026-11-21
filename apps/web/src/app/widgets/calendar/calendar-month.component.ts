import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewEncapsulation,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  isDevMode,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { Calendar } from 'fullcalendar';
import dayGridPlugin from 'fullcalendar/daygrid';
import frLocale from 'fullcalendar/locales/fr';
import type { CalendarEvent } from '../../core/calendar';
import { TimeDisplay, UserTimeZone, isValidLocalDate, startOfMonth } from '../../core/time';
import { WidgetRegistry } from '../../core/widgets/widget-registry';
import { CLOCK, type LocalDateIso } from '../../data';
import { eventName } from './calendar-label';
import { CALENDAR_MAX_EVENTS_PER_DAY } from './calendar-month-limit';
import { MORE_LINK_CLASS, buildMonthOptions, toEventInputs } from './calendar-month-options';
import { CALENDAR_STYLES_LOADER } from './calendar-styles';

export interface MonthDayOpened {
  readonly day: LocalDateIso;
  /** The "+N" element, to give the focus back to it. */
  readonly trigger: HTMLElement | null;
}

export interface MonthEventOpened {
  readonly eventId: string;
  readonly trigger: HTMLElement;
}

/**
 * The only runtime importer of `fullcalendar` (lazy chunk, loaded when the Month is first shown).
 * Titles are rendered by the library as plain text (no custom content, no link).
 */
@Component({
  selector: 'app-calendar-month',
  template: '<div #host class="hb-fc h-full min-h-0" data-testid="calendar-month-host"></div>',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styles: `
    .hb-fc {
      color: var(--hb-fg);
      font-size: var(--hb-text-xs);
    }
    .hb-fc :focus-visible {
      outline: 2px solid var(--hb-focus);
      outline-offset: -2px;
    }
  `,
  host: { class: 'block h-full min-h-0' },
})
export class CalendarMonthComponent {
  private readonly doc = inject(DOCUMENT);
  private readonly clock = inject(CLOCK);
  private readonly zone = inject(UserTimeZone);
  private readonly transloco = inject(TranslocoService);
  private readonly display = inject(TimeDisplay);
  private readonly registry = inject(WidgetRegistry);
  private readonly stylesLoader = inject(CALENDAR_STYLES_LOADER);
  private readonly maxEventsPerDay = inject(CALENDAR_MAX_EVENTS_PER_DAY);
  private readonly hostEl = viewChild.required<ElementRef<HTMLElement>>('host');

  /** Any day of the month to show. */
  readonly anchor = input.required<LocalDateIso>();
  readonly events = input.required<readonly CalendarEvent[]>();
  readonly today = input.required<LocalDateIso>();
  private readonly eventsById = computed(
    () => new Map(this.events().map((event) => [event.id, event] as const)),
  );

  readonly dayOpened = output<MonthDayOpened>();
  readonly eventOpened = output<MonthEventOpened>();
  /** The library stylesheet could not be loaded. */
  readonly failed = output();

  private calendar: Calendar | null = null;
  private readonly ready = signal(false);
  private listenerHost: HTMLElement | null = null;
  private destroyed = false;
  private createdFor: LocalDateIso | null = null;

  /**
   * The "+N" link is caught in the capture phase, before FullCalendar: its moreLinkClick opens the
   * popover for any falsy return value, so returning nothing is not enough (spec T2).
   */
  private readonly captureMore = (event: Event): void => {
    if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest<HTMLElement>('.' + MORE_LINK_CLASS);
    if (!link || !this.hostEl().nativeElement.contains(link)) return;
    event.preventDefault();
    event.stopPropagation();
    const day = link.closest('[data-date]')?.getAttribute('data-date') ?? '';
    if (!isValidLocalDate(day)) {
      console.warn('Calendar "+N" link gave an invalid day');
      return;
    }
    this.dayOpened.emit({ day, trigger: link });
  };

  constructor() {
    afterNextRender(() => void this.start());
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.listenerHost?.removeEventListener('click', this.captureMore, true);
      this.listenerHost?.removeEventListener('keydown', this.captureMore, true);
      this.calendar?.destroy();
      this.calendar = null;
    });
    effect(() => {
      const events = this.events();
      if (this.ready()) this.calendar?.setOption('events', toEventInputs(events));
    });
    effect(() => {
      const zone = this.zone.id();
      if (this.ready() && this.calendar?.getOption('timeZone') !== zone) {
        this.calendar?.setOption('timeZone', zone);
      }
    });
    effect(() => {
      const anchor = this.anchor();
      if (this.ready()) this.calendar?.gotoDate(startOfMonth(anchor));
    });
    // P1/P4: FullCalendar reads `now` at creation only (setOption does not move "today"), so a new
    // day recreates the calendar.
    effect(() => {
      const today = this.today();
      if (this.ready() && today !== this.createdFor) untracked(() => this.create());
    });
  }

  private async start(): Promise<void> {
    try {
      await this.stylesLoader(this.doc);
    } catch {
      if (!this.destroyed) this.failed.emit();
      return;
    }
    if (this.destroyed) return;
    this.listenerHost = this.hostEl().nativeElement;
    this.listenerHost.addEventListener('click', this.captureMore, true);
    this.listenerHost.addEventListener('keydown', this.captureMore, true);
    this.create();
    this.ready.set(true);
  }

  private create(): void {
    this.calendar?.destroy();
    this.calendar = null;
    this.createdFor = this.today();
    const options = untracked(() =>
      buildMonthOptions({
        monthStart: startOfMonth(this.anchor()),
        timeZone: this.zone.id(),
        nowIso: this.clock.nowIso(),
        maxEventsPerDay: this.maxEventsPerDay,
        events: this.events(),
        moreHint: (count) => this.transloco.translate('widgets.calendar.moreHint', { count }),
        onMoreLink: (info) => {
          // Safety net: the capture listener normally takes the "+N" first.
          if (isDevMode()) {
            console.warn('Calendar "+N" safety net used: the capture listener missed the event');
          }
          const trigger = info.jsEvent.currentTarget ?? info.jsEvent.target;
          const day = calendar.formatIso(info.date, true);
          if (!isValidLocalDate(day)) {
            console.warn('Calendar "+N" link gave an invalid day');
            return;
          }
          this.dayOpened.emit({ day, trigger: trigger instanceof HTMLElement ? trigger : null });
        },
        onEventClick: (info) => {
          this.eventOpened.emit({ eventId: info.event.id, trigger: info.el });
        },
        eventName: (id) =>
          untracked(() => {
            const found = this.eventsById().get(id);
            if (!found) return null;
            return eventName(
              found,
              this.display,
              this.zone.id(),
              (key, params) => this.transloco.translate(key, params),
              this.registry.get(found.sourceType)?.titleKey,
            );
          }),
      }),
    );
    const calendar = new Calendar(this.hostEl().nativeElement, {
      plugins: [dayGridPlugin],
      locales: [frLocale],
      locale: 'fr',
      ...options,
    });
    calendar.render();
    this.calendar = calendar;
  }
}
