import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { TimeDisplay, Today, UserTimeZone } from '../../core/time';
import { injectWidgetContext } from '../../core/widgets';
import type { LocalDateIso } from '../../data';
import { groupByDay } from './calendar-days';
import { CalendarDayListComponent } from './calendar-day-list.component';
import { CalendarDayPanelComponent } from './calendar-day-panel.component';
import { CalendarLoader } from './calendar-loader';
import { CalendarMonthComponent } from './calendar-month.component';
import type { MonthDayOpened } from './calendar-month.component';
import { CalendarToolbarComponent } from './calendar-toolbar.component';
import { navigate, viewTitle, visibleDays, visibleRange } from './calendar-view';
import type { CalendarAgendaDays, CalendarConfig, CalendarViewKind } from './calendar.config';

/** 36rem x 22rem (spec calendar T6; thresholds to confirm in MC4). */
const MONTH_MIN_WIDTH_PX = 576;
const MONTH_MIN_HEIGHT_PX = 352;
/** 20rem: under it the number of days is not offered. */
const DAYS_MIN_WIDTH_PX = 320;
const RELOAD_DELAY_MS = 300;

@Component({
  selector: 'app-calendar-widget',
  imports: [
    TranslocoPipe,
    CalendarToolbarComponent,
    CalendarDayListComponent,
    CalendarDayPanelComponent,
    CalendarMonthComponent,
  ],
  providers: [CalendarLoader],
  templateUrl: './calendar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'relative flex h-full min-h-0 flex-col gap-2' },
})
export class CalendarComponent {
  protected readonly ctx = injectWidgetContext<CalendarConfig>();
  protected readonly loader = inject(CalendarLoader);
  protected readonly today = inject(Today);
  private readonly zone = inject(UserTimeZone);
  private readonly display = inject(TimeDisplay);
  private readonly transloco = inject(TranslocoService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly doc = inject(DOCUMENT);
  private readonly hostEl = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly toolbar = viewChild(CalendarToolbarComponent);

  /** The choices live in memory: a failed save keeps them (spec 4.6). */
  protected readonly viewChoice = signal<CalendarViewKind>(this.ctx.config().view);
  protected readonly daysChoice = signal<CalendarAgendaDays>(this.ctx.config().agendaDays);
  /** Navigation anchor, not stored: the widget always opens on today. */
  protected readonly anchor = signal<LocalDateIso>(this.today.date());
  private readonly bodySize = signal({ width: 0, height: 0 });
  protected readonly monthFailed = signal(false);
  protected readonly panelDay = signal<LocalDateIso | null>(null);
  protected readonly announcement = signal('');

  protected readonly monthAllowed = computed(
    () =>
      this.bodySize().width >= MONTH_MIN_WIDTH_PX && this.bodySize().height >= MONTH_MIN_HEIGHT_PX,
  );
  protected readonly daysAllowed = computed(() => this.bodySize().width >= DAYS_MIN_WIDTH_PX);
  /** Under the size threshold (or when the Month failed) the Agenda is shown, whatever the config. */
  protected readonly view = computed<CalendarViewKind>(() =>
    this.viewChoice() === 'month' && this.monthAllowed() && !this.monthFailed()
      ? 'month'
      : 'agenda',
  );

  private readonly days = computed(() =>
    visibleDays(this.view(), this.anchor(), this.daysChoice()),
  );
  private readonly range = computed(() => visibleRange(this.days(), this.zone.id()));
  protected readonly title = computed(() =>
    viewTitle(this.view(), this.anchor(), this.daysChoice(), (date, style) =>
      this.display.formatLocalDate(date, style),
    ),
  );
  /** The days that the loaded events cover: stable while a new range is loading. */
  protected readonly shownDays = computed(() => this.loader.loaded() ?? this.days());
  protected readonly panelEvents = computed(() => {
    const day = this.panelDay();
    return day === null
      ? []
      : (groupByDay(this.loader.events(), day, day, this.zone.id())[0]?.events ?? []);
  });
  /** After a failed load the banners of a previous load would be stale. */
  protected readonly partial = computed(
    () =>
      this.loader.failedSources().length > 0 && !this.loader.unavailable() && !this.loader.error(),
  );
  protected readonly truncated = computed(() => this.loader.truncated() && !this.loader.error());
  /** The first load failed: nothing was ever loaded, so no "nothing planned" state either. */
  protected readonly neverLoaded = computed(() => this.loader.error() && !this.loader.loaded());

  private returnFocusTo: HTMLElement | null = null;
  private lastRangeKey = '';

  constructor() {
    afterNextRender(() => {
      const el = this.hostEl.nativeElement;
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver((entries) => {
        const box = entries[entries.length - 1]?.contentRect;
        if (box) this.onResize(box.width, box.height);
      });
      observer.observe(el);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });

    // Navigation (a new range) loads at once; the other triggers are debounced.
    effect(() => {
      const range = this.range();
      this.today.date();
      untracked(() => {
        const key = `${range.from}|${range.to}|${range.timeZone}`;
        const delay = key === this.lastRangeKey ? RELOAD_DELAY_MS : 0;
        this.lastRangeKey = key;
        this.loader.request(range, delay);
      });
    });

    // L17: the Day panel cannot outlive the Month (card too small, Month failed).
    effect(() => {
      if (this.panelDay() !== null && this.view() !== 'month') {
        untracked(() => {
          this.closePanel(false);
          afterNextRender(() => this.toolbar()?.focusTitle(), { injector: this.injector });
        });
      }
    });
  }

  /** Called by the ResizeObserver; public so that tests can drive the size (jsdom has no layout). */
  onResize(width: number, height: number): void {
    this.bodySize.set({ width, height });
  }

  protected previous(): void {
    this.closePanel(false);
    this.anchor.set(navigate(this.view(), this.anchor(), this.daysChoice(), -1));
  }

  protected next(): void {
    this.closePanel(false);
    this.anchor.set(navigate(this.view(), this.anchor(), this.daysChoice(), 1));
  }

  protected goToday(): void {
    this.closePanel(false);
    this.anchor.set(this.today.date());
  }

  protected chooseView(view: CalendarViewKind): void {
    // Choosing the Month again after a failure retries it.
    if (view === 'month') this.monthFailed.set(false);
    this.viewChoice.set(view);
    this.save({ view, agendaDays: this.daysChoice() });
  }

  protected chooseDays(agendaDays: CalendarAgendaDays): void {
    this.daysChoice.set(agendaDays);
    this.save({ view: this.viewChoice(), agendaDays });
  }

  protected showAgenda(): void {
    this.monthFailed.set(false);
    this.chooseView('agenda');
  }

  protected openDay(opened: MonthDayOpened): void {
    this.returnFocusTo = opened.trigger;
    this.panelDay.set(opened.day);
  }

  protected closePanel(restoreFocus = true): void {
    const trigger = this.returnFocusTo;
    this.returnFocusTo = null;
    this.panelDay.set(null);
    if (!restoreFocus) return;
    // After the render: the calendar area is no longer inert.
    afterNextRender(
      () => {
        if (trigger?.isConnected && this.doc.contains(trigger)) trigger.focus();
        else this.toolbar()?.focusMonthButton();
      },
      { injector: this.injector },
    );
  }

  private save(config: CalendarConfig): void {
    this.announcement.set('');
    this.ctx.updateConfig(config).catch(() => {
      this.announcement.set(this.transloco.translate('widgets.calendar.configNotSaved'));
    });
  }
}
