import { ApplicationInitStatus, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CalendarAggregator } from '../../../core/calendar';
import type { CalendarEvent, CalendarRange } from '../../../core/calendar';
import { provideAppI18n } from '../../../core/i18n';
import { FakeSettingsRepository } from '../../../core/testing/fake-settings.repository';
import { SYSTEM_TIME_ZONE_READER, UserTimeZone } from '../../../core/time';
import { ManualClock } from '../../../core/time/testing/manual-clock';
import { WIDGET_CONTEXT, provideWidget } from '../../../core/widgets';
import type { GridSize, WidgetContext } from '../../../core/widgets';
import { CLOCK, SETTINGS_REPOSITORY } from '../../../data';
import { CALENDAR_MAX_EVENTS_PER_DAY } from '../calendar-month-limit';
import { CALENDAR_STYLES_LOADER } from '../calendar-styles';
import type { CalendarStylesLoader } from '../calendar-styles';
import { CalendarComponent } from '../calendar.component';
import type { CalendarConfig } from '../calendar.config';
import { calendarWidget } from '../calendar.definition';
import { CALENDAR_FIXTURES } from './calendar-fixtures';

export interface CalendarResult {
  readonly events: readonly CalendarEvent[];
  readonly failedSources: readonly string[];
  readonly truncated: boolean;
  readonly unavailable: boolean;
}

export interface MountOptions {
  readonly zone?: string;
  readonly config?: CalendarConfig;
  readonly events?: readonly CalendarEvent[];
  readonly maxEventsPerDay?: number | true;
  readonly styles?: CalendarStylesLoader;
  readonly now?: string;
  /** Replaces the real-timer wait of `settle` (tests that use fake timers). */
  readonly tick?: () => Promise<unknown>;
  /** Replaces the aggregator (e.g. to make it fail). */
  readonly listEvents?: (range: CalendarRange) => Promise<CalendarResult>;
  readonly flags?: {
    readonly failedSources?: readonly string[];
    readonly truncated?: boolean;
    readonly unavailable?: boolean;
  };
}

export async function mountCalendar(options: MountOptions = {}) {
  const zone = options.zone ?? 'Europe/Paris';
  const clock = new ManualClock(options.now ?? '2026-11-18T10:00:00.000Z');
  const config = signal<CalendarConfig>(options.config ?? { view: 'month', agendaDays: 7 });
  const events = options.events ?? CALENDAR_FIXTURES;
  const context: WidgetContext<CalendarConfig> = {
    instanceId: 'cal-test',
    type: 'calendar',
    config: config.asReadonly(),
    size: signal<GridSize>({ w: 6, h: 5 }).asReadonly(),
    permissions: new Set(),
    updateConfig: (next) => {
      config.set(next);
      return Promise.resolve();
    },
  };
  TestBed.configureTestingModule({
    imports: [CalendarComponent],
    providers: [
      provideAppI18n(),
      provideWidget(calendarWidget),
      { provide: CLOCK, useValue: clock },
      { provide: SETTINGS_REPOSITORY, useValue: new FakeSettingsRepository() },
      { provide: SYSTEM_TIME_ZONE_READER, useValue: () => zone },
      { provide: WIDGET_CONTEXT, useValue: context },
      { provide: CALENDAR_MAX_EVENTS_PER_DAY, useValue: options.maxEventsPerDay ?? 2 },
      {
        provide: CALENDAR_STYLES_LOADER,
        useValue: options.styles ?? (() => Promise.resolve()),
      },
      {
        provide: CalendarAggregator,
        useValue: {
          listEvents:
            options.listEvents ??
            ((range: CalendarRange) =>
              Promise.resolve({
                events: events.filter((e) =>
                  e.time.kind === 'timed'
                    ? e.time.start >= range.from && e.time.start < range.to
                    : true,
                ),
                failedSources: options.flags?.failedSources ?? [],
                truncated: options.flags?.truncated ?? false,
                unavailable: options.flags?.unavailable ?? false,
              })),
        },
      },
    ],
  });
  await TestBed.compileComponents();
  await TestBed.inject(ApplicationInitStatus).donePromise;
  await TestBed.inject(UserTimeZone).setPreference(zone);
  const fixture = TestBed.createComponent(CalendarComponent);
  fixture.componentInstance.onResize(700, 400);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) {
      if (options.tick) {
        await options.tick();
      } else {
        await fixture.whenStable();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      fixture.detectChanges();
    }
  };
  await settle();
  return { fixture, el, clock, config, settle };
}
