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
import { CalendarChanges } from '../../core/calendar/calendar-changes';
import type { CalendarEvent } from '../../core/calendar';
import { DueRefresher, TimeDisplay, Today, UserTimeZone } from '../../core/time';
import { injectWidgetContext } from '../../core/widgets';
import { WidgetRegistry } from '../../core/widgets/widget-registry';
import { CLOCK, type LocalDateIso } from '../../data';
import { groupByDay } from './calendar-days';
import { CalendarDayListComponent } from './calendar-day-list.component';
import { CalendarDayPanelComponent } from './calendar-day-panel.component';
import type { DayListSelection } from './calendar-day-list.component';
import { CalendarEventDetailComponent } from './calendar-event-detail.component';
import { MORE_LINK_CLASS } from './calendar-month-options';
import { CalendarLoader } from './calendar-loader';
import { CalendarMonthComponent } from './calendar-month.component';
import type { MonthDayOpened, MonthEventOpened } from './calendar-month.component';
import { CalendarSourcesPanelComponent } from './calendar-sources-panel.component';
import type { SourceToggle } from './calendar-sources-panel.component';
import { CalendarToolbarComponent } from './calendar-toolbar.component';
import { navigate, viewTitle, visibleDays, visibleRange } from './calendar-view';
import type { CalendarAgendaDays, CalendarConfig, CalendarViewKind } from './calendar.config';

/** 36rem x 22rem (spec calendar T6; thresholds to confirm in MC4). */
const MONTH_MIN_WIDTH_PX = 576;
const MONTH_MIN_HEIGHT_PX = 352;
/** 20rem: under it the number of days is not offered. */
const DAYS_MIN_WIDTH_PX = 320;
const RELOAD_DELAY_MS = 300;

/** Escapes a value for a quoted attribute selector (CSS.escape when the platform has it). */
function escapeAttr(value: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(value)
    : value.replace(/["\\]/g, '\\$&');
}

@Component({
  selector: 'app-calendar-widget',
  imports: [
    TranslocoPipe,
    CalendarToolbarComponent,
    CalendarDayListComponent,
    CalendarDayPanelComponent,
    CalendarEventDetailComponent,
    CalendarMonthComponent,
    CalendarSourcesPanelComponent,
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
  private readonly changes = inject(CalendarChanges);
  private readonly registry = inject(WidgetRegistry);
  /** Focus and visibility only (no deadline to watch, hence `arm(null)`): re-reads the range. */
  private readonly refresher = new DueRefresher(this.doc, inject(CLOCK), this.destroyRef, () =>
    this.loader.request(this.range(), RELOAD_DELAY_MS, this.hiddenChoice()),
  );

  /** The choices live in memory: a failed save keeps them (spec 4.6). */
  protected readonly viewChoice = signal<CalendarViewKind>(this.ctx.config().view);
  protected readonly daysChoice = signal<CalendarAgendaDays>(this.ctx.config().agendaDays);
  /** Widget types whose events are hidden (O13); kept in memory like the other choices. */
  protected readonly hiddenChoice = signal<readonly string[]>(this.ctx.config().hiddenSources);
  protected readonly sourcesOpen = signal(false);
  /** Navigation anchor, not stored: the widget always opens on today. */
  protected readonly anchor = signal<LocalDateIso>(this.today.date());
  private readonly bodySize = signal({ width: 0, height: 0 });
  protected readonly monthFailed = signal(false);
  protected readonly panelDay = signal<LocalDateIso | null>(null);
  /** The event sheet (C3): snapshot of the event, so that a reload cannot blank it. */
  protected readonly detail = signal<CalendarEvent | null>(null);
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
  private readonly sourceTypes = computed(() =>
    this.registry
      .list()
      .filter((definition) => definition.loadCalendarSource !== undefined)
      .map((definition) => definition.type),
  );
  /** A hidden type that is no longer registered does not count. */
  protected readonly filterActive = computed(() =>
    this.sourceTypes().some((type) => this.hiddenChoice().includes(type)),
  );
  /** Every source of the registry is hidden: nothing is loaded, the empty state says why. */
  protected readonly allHidden = computed(() => {
    const types = this.sourceTypes();
    return types.length > 0 && types.every((type) => this.hiddenChoice().includes(type));
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
  private returnFocusDay: LocalDateIso | null = null;
  private detailTrigger: HTMLElement | null = null;
  private detailRoot: 'calendar-area' | 'calendar-day-panel' = 'calendar-area';
  private lastRangeKey = '';
  private lastHiddenKey = '';
  private previousToday = this.today.date();

  constructor() {
    this.refresher.arm(null);

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

    // M2: an anchor that sat on the old "today" follows the new day (midnight, zone change).
    effect(() => {
      const now = this.today.date();
      untracked(() => {
        if (this.anchor() === this.previousToday) this.anchor.set(now);
        this.previousToday = now;
      });
    });

    // Navigation (a new range) loads at once; the other triggers (today, zone, a write elsewhere)
    // are debounced.
    effect(() => {
      const range = this.range();
      this.today.date();
      this.changes.version();
      const hidden = this.hiddenChoice();
      untracked(() => {
        const key = `${range.from}|${range.to}|${range.timeZone}`;
        const hiddenKey = hidden.join(',');
        const same = key === this.lastRangeKey && hiddenKey === this.lastHiddenKey;
        this.lastRangeKey = key;
        this.lastHiddenKey = hiddenKey;
        this.loader.request(range, same ? RELOAD_DELAY_MS : 0, hidden);
      });
    });

    // m3: the open sheet follows its event when a reload changes it (kept as is when it vanished).
    effect(() => {
      const events = this.loader.events();
      untracked(() => {
        const current = this.detail();
        if (current === null) return;
        const fresh = events.find((candidate) => candidate.id === current.id);
        if (fresh && fresh !== current) this.detail.set(fresh);
      });
    });

    // L17: the Day panel cannot outlive the Month (card too small, Month failed).
    effect(() => {
      if (this.panelDay() !== null && this.view() !== 'month') {
        untracked(() => {
          // The sheet may come from the panel or the Month: it goes too, without taking the focus.
          this.closeDetail(false);
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
    this.closeOverlays();
    this.anchor.set(navigate(this.view(), this.anchor(), this.daysChoice(), -1));
  }

  protected next(): void {
    this.closeOverlays();
    this.anchor.set(navigate(this.view(), this.anchor(), this.daysChoice(), 1));
  }

  protected goToday(): void {
    this.closeOverlays();
    this.anchor.set(this.today.date());
  }

  protected chooseView(view: CalendarViewKind): void {
    this.closeDetail(false);
    // Choosing the Month again after a failure retries it.
    if (view === 'month') this.monthFailed.set(false);
    this.viewChoice.set(view);
    this.save({ view, agendaDays: this.daysChoice(), hiddenSources: [...this.hiddenChoice()] });
  }

  protected chooseDays(agendaDays: CalendarAgendaDays): void {
    this.closeDetail(false);
    this.daysChoice.set(agendaDays);
    this.save({
      view: this.viewChoice(),
      agendaDays,
      hiddenSources: [...this.hiddenChoice()],
    });
  }

  protected showAgenda(): void {
    this.monthFailed.set(false);
    this.chooseView('agenda');
  }

  protected toggleSources(): void {
    if (this.sourcesOpen()) {
      this.closeSources();
      return;
    }
    this.closeOverlays();
    this.sourcesOpen.set(true);
  }

  protected closeSources(restoreFocus = true): void {
    this.sourcesOpen.set(false);
    if (!restoreFocus) return;
    // After the render: the calendar area is no longer inert.
    afterNextRender(() => this.toolbar()?.focusSources(), { injector: this.injector });
  }

  protected toggleSource(toggle: SourceToggle): void {
    const others = this.hiddenChoice().filter((type) => type !== toggle.type);
    const hiddenSources = toggle.visible ? others : [...others, toggle.type];
    this.hiddenChoice.set(hiddenSources);
    this.save({
      view: this.viewChoice(),
      agendaDays: this.daysChoice(),
      hiddenSources: [...hiddenSources],
    });
  }

  protected openDay(opened: MonthDayOpened): void {
    this.returnFocusTo = opened.trigger;
    this.returnFocusDay = opened.day;
    this.panelDay.set(opened.day);
  }

  protected closePanel(restoreFocus = true): void {
    const trigger = this.returnFocusTo;
    const day = this.returnFocusDay;
    this.returnFocusTo = null;
    this.returnFocusDay = null;
    this.panelDay.set(null);
    if (!restoreFocus) return;
    // After the render: the calendar area is no longer inert.
    afterNextRender(
      () => {
        // A reload remounts the cells: the "+N" is found again by the day of its cell.
        const again =
          day === null
            ? null
            : this.query('calendar-area', `[data-date="${day}"] .${MORE_LINK_CLASS}`);
        if (!this.focusIfConnected(trigger) && !this.focusIfConnected(again)) {
          this.toolbar()?.focusMonthButton();
        }
      },
      { injector: this.injector },
    );
  }

  /** From an Agenda row or a Day panel row. */
  protected openEvent(selection: DayListSelection): void {
    this.detailTrigger = selection.trigger;
    this.detailRoot = this.panelDay() !== null ? 'calendar-day-panel' : 'calendar-area';
    this.detail.set(selection.event);
  }

  /** From a Month event: the event is looked up in the loaded data (it may have just vanished). */
  protected openMonthEvent(opened: MonthEventOpened): void {
    const event = this.loader.events().find((candidate) => candidate.id === opened.eventId);
    if (!event) return;
    this.detailTrigger = opened.trigger;
    this.detailRoot = 'calendar-area';
    this.detail.set(event);
  }

  protected closeDetail(restoreFocus = true): void {
    const trigger = this.detailTrigger;
    const root = this.detailRoot;
    const id = this.detail()?.id;
    this.detailTrigger = null;
    if (this.detail() === null) return;
    this.detail.set(null);
    if (!restoreFocus) return;
    // After the render: what lay under the sheet is no longer inert.
    afterNextRender(
      () => {
        // A reload remounts the Month events: the element is found again by its event id.
        const again =
          id === undefined ? null : this.query(root, `[data-event-id="${escapeAttr(id)}"]`);
        if (this.focusIfConnected(trigger) || this.focusIfConnected(again)) return;
        const back =
          this.panelDay() !== null
            ? this.query('calendar-day-panel', '[data-testid="calendar-panel-back"]')
            : null;
        if (this.focusIfConnected(back)) return;
        if (this.view() === 'month') this.toolbar()?.focusMonthButton();
        else this.toolbar()?.focusTitle();
      },
      { injector: this.injector },
    );
  }

  /** An element inside the area or the Day panel (looked up by test id, they have no other hook). */
  private query(rootTestId: string, selector: string): HTMLElement | null {
    const root = this.hostEl.nativeElement.querySelector(`[data-testid="${rootTestId}"]`);
    return root?.querySelector<HTMLElement>(selector) ?? null;
  }

  private focusIfConnected(element: HTMLElement | null): boolean {
    if (!element?.isConnected || !this.doc.contains(element)) return false;
    element.focus();
    return true;
  }

  private closeOverlays(): void {
    this.closeDetail(false);
    this.closePanel(false);
    this.closeSources(false);
  }

  private save(config: CalendarConfig): void {
    this.announcement.set('');
    const hiddenSources = [...new Set(config.hiddenSources)];
    this.ctx.updateConfig({ ...config, hiddenSources }).catch(() => {
      this.announcement.set(this.transloco.translate('widgets.calendar.configNotSaved'));
    });
  }
}
