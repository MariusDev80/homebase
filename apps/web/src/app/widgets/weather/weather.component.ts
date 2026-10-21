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
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  CLOCK,
  TimeDisplay,
  UserTimeZone,
  durationBetween,
  normalizeTimeZone,
  toLocalDate,
} from '../../core/time';
import { UrlOpener } from '../../core/system';
import {
  WEATHER_MAX_AGE_MS,
  WeatherError,
  WeatherService,
  toWeatherError,
} from '../../core/weather';
import type { ForecastOptions, WeatherPlace, WeatherSnapshot } from '../../core/weather';
import { injectWidgetContext } from '../../core/widgets';
import type { InstantIso } from '../../data';
import { WEATHER_TONE_CLASS, describeWeather } from './weather-codes';
import type { WeatherIconName } from './weather-codes';
import { ageMessage, dayKind, locationLabel, roundValue, visibleDays } from './weather-format';
import { WeatherIconComponent } from './weather-icon.component';
import { WeatherLocationPickerComponent } from './weather-location-picker.component';
import { toWeatherLocation } from './weather.config';
import type { WeatherConfig } from './weather.config';

const ATTRIBUTION_URL = 'https://open-meteo.com/';
const NOW_TICK_MS = 60 * 1000;
const MIN_REFRESH_MS = 60 * 1000;
/** Retry delays after consecutive failures; the last one repeats. */
const RETRY_STEPS_MS = [60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 30 * 60_000];
const DAY_OPTIONS = [1, 2, 3, 4, 5, 6, 7];

type WeatherView =
  | { readonly kind: 'no-location' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: WeatherError }
  | {
      readonly kind: 'data';
      readonly snapshot: WeatherSnapshot;
      readonly refreshError: WeatherError | null;
    };

interface DayRow {
  readonly date: string;
  readonly dayLabel: string;
  readonly icon: WeatherIconName;
  readonly toneClass: string;
  readonly condition: string;
  readonly rangeText: string;
  readonly rangeSr: string;
  readonly precipitation: number | null;
}

interface WeatherModel {
  readonly location: string;
  readonly icon: WeatherIconName;
  readonly toneClass: string;
  readonly condition: string;
  readonly temperature: number;
  readonly feelsLike: number | null;
  readonly humidity: number | null;
  readonly wind: number | null;
  readonly rows: readonly DayRow[];
  readonly age: string;
  readonly banner: string | null;
}

type OpenerKey = 'settings' | 'choose';

@Component({
  selector: 'app-weather-widget',
  imports: [TranslocoPipe, WeatherIconComponent, WeatherLocationPickerComponent],
  templateUrl: './weather.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'flex h-full min-h-0 flex-col gap-2 focus:outline-none',
    tabindex: '-1',
    '(window:online)': 'onOnline()',
    '(window:focus)': 'onResume()',
    '(document:visibilitychange)': 'onVisibility()',
  },
})
export class WeatherComponent {
  protected readonly ctx = injectWidgetContext<WeatherConfig>();
  private readonly service = inject(WeatherService);
  private readonly urlOpener = inject(UrlOpener);
  private readonly clock = inject(CLOCK);
  private readonly timeDisplay = inject(TimeDisplay);
  private readonly userZone = inject(UserTimeZone);
  private readonly transloco = inject(TranslocoService);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly view = signal<WeatherView>({ kind: 'no-location' });
  protected readonly refreshing = signal(false);
  protected readonly now = signal<InstantIso>(this.clock.nowIso());
  protected readonly panelOpen = signal(false);
  protected readonly saving = signal(false);
  protected readonly saveError = signal(false);
  protected readonly daysError = signal(false);
  protected readonly linkError = signal(false);

  protected readonly dayOptions = DAY_OPTIONS;
  protected readonly daysId = `weather-days-${this.ctx.instanceId}`;
  protected readonly days = computed(() => this.ctx.config().days);
  protected readonly compact = computed(() => this.ctx.size().w <= 2 || this.ctx.size().h <= 2);
  protected readonly showDetails = computed(() => !this.compact() && this.ctx.size().w >= 4);

  private readonly locationKey = computed(() => {
    const location = this.ctx.config().location;
    return location === null ? null : `${location.latitude},${location.longitude}`;
  });

  protected readonly errorText = computed(() => {
    const view = this.view();
    return view.kind === 'error' ? this.errorMessage(view.error, false) : '';
  });

  protected readonly model = computed<WeatherModel | null>(() => {
    const view = this.view();
    const location = this.ctx.config().location;
    if (view.kind !== 'data' || location === null) return null;
    const { snapshot } = view;
    const forecast = snapshot.forecast;
    const now = this.now();
    const zone = normalizeTimeZone(forecast.timeZone) ?? this.userZone.id();
    const today = toLocalDate(now, zone);
    const current = forecast.current;
    const description = describeWeather(current.weatherCode, current.isDay);
    const rounded = (value: number | null): number | null =>
      value === null ? null : roundValue(value);
    const rows = visibleDays(forecast.daily, today, this.days()).map((day): DayRow => {
      const desc = describeWeather(day.weatherCode, true);
      const kind = dayKind(day.date, today);
      const max = rounded(day.temperatureMaxC);
      const min = rounded(day.temperatureMinC);
      return {
        date: day.date,
        dayLabel:
          kind === 'today'
            ? this.t('time.today')
            : kind === 'tomorrow'
              ? this.t('time.tomorrow')
              : this.timeDisplay.formatLocalDate(day.date, 'weekday-short'),
        icon: desc.icon,
        toneClass: WEATHER_TONE_CLASS[desc.tone],
        condition: this.t(desc.labelKey),
        rangeText: `${this.degrees(max, false)} / ${this.degrees(min, false)}`,
        rangeSr: this.t('widgets.weather.dayRangeSr', {
          max: this.degrees(max, true),
          min: this.degrees(min, true),
        }),
        precipitation: rounded(day.precipitationProbabilityPct),
      };
    });
    return {
      location: locationLabel(location),
      icon: description.icon,
      toneClass: WEATHER_TONE_CLASS[description.tone],
      condition: this.t(description.labelKey),
      temperature: roundValue(current.temperatureC),
      feelsLike: rounded(current.apparentTemperatureC),
      humidity: rounded(current.relativeHumidityPct),
      wind: rounded(current.windSpeedKmh),
      rows,
      age: this.ageText(snapshot.fetchedAt, now),
      banner: view.refreshError === null ? null : this.errorMessage(view.refreshError, true),
    };
  });

  private timer: ReturnType<typeof setTimeout> | undefined;
  private tickTimer: ReturnType<typeof setTimeout> | undefined;
  private sequence = 0;
  /** Only the latest refresh call processes its outcome (deduplicated calls share one promise). */
  private callId = 0;
  private failures = 0;
  private destroyed = false;
  private opener: OpenerKey = 'settings';

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.sequence++;
      clearTimeout(this.timer);
      clearTimeout(this.tickTimer);
    });
    this.scheduleTick();
    effect(() => {
      this.locationKey();
      untracked(() => this.onLocationChanged());
    });
  }

  protected openPanel(opener: OpenerKey): void {
    this.opener = opener;
    this.saveError.set(false);
    this.daysError.set(false);
    this.panelOpen.set(true);
  }

  protected closePanel(): void {
    if (!this.panelOpen()) return;
    this.panelOpen.set(false);
    this.saveError.set(false);
    afterNextRender(
      () => {
        const host = this.host.nativeElement;
        const target =
          host.querySelector<HTMLElement>(`[data-focus-key="${this.opener}"]`) ??
          host.querySelector<HTMLElement>('[data-focus-key="settings"]') ??
          host;
        target.focus();
      },
      { injector: this.injector },
    );
  }

  protected async onPicked(place: WeatherPlace): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    this.saveError.set(false);
    try {
      await this.ctx.updateConfig({ ...this.ctx.config(), location: toWeatherLocation(place) });
      this.closePanel();
    } catch {
      this.saveError.set(true);
    } finally {
      this.saving.set(false);
    }
  }

  protected onDaysChange(event: Event): void {
    const days = Number((event.target as HTMLSelectElement).value);
    this.daysError.set(false);
    this.ctx.updateConfig({ ...this.ctx.config(), days }).catch(() => this.daysError.set(true));
  }

  protected onRefresh(): void {
    if (this.refreshing()) return;
    void this.refresh({ force: true });
  }

  protected async openAttribution(): Promise<void> {
    this.linkError.set(false);
    try {
      await this.urlOpener.open(this.ctx, ATTRIBUTION_URL);
    } catch {
      this.linkError.set(true);
    }
  }

  protected onOnline(): void {
    this.now.set(this.clock.nowIso());
    if (this.view().kind === 'no-location' || this.destroyed) return;
    void this.refresh({ ignoreRetryDelay: true });
  }

  protected onVisibility(): void {
    if (this.document.visibilityState === 'hidden') return;
    this.onResume();
  }

  protected onResume(): void {
    this.now.set(this.clock.nowIso());
    if (this.destroyed || this.refreshing()) return;
    const view = this.view();
    const needsRefresh =
      view.kind === 'error' ||
      (view.kind === 'data' && (view.refreshError !== null || this.isStale(view.snapshot)));
    if (needsRefresh) void this.refresh({});
  }

  private isStale(snapshot: WeatherSnapshot): boolean {
    const age = durationBetween(snapshot.fetchedAt, this.clock.nowIso());
    return age < 0 || age >= WEATHER_MAX_AGE_MS;
  }

  private onLocationChanged(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.sequence++;
    this.failures = 0;
    this.refreshing.set(false);
    const location = this.ctx.config().location;
    if (location === null) {
      this.view.set({ kind: 'no-location' });
      return;
    }
    const cached = this.service.cached(this.ctx, location);
    this.view.set(
      cached ? { kind: 'data', snapshot: cached, refreshError: null } : { kind: 'loading' },
    );
    void this.refresh({ ignoreRetryDelay: true });
  }

  private async refresh(options: ForecastOptions): Promise<void> {
    const location = this.ctx.config().location;
    if (location === null || this.destroyed) return;
    const sequence = this.sequence;
    const call = ++this.callId;
    this.refreshing.set(true);
    try {
      const snapshot = await this.service.forecast(this.ctx, location, options);
      if (this.isObsolete(sequence, call)) return;
      this.failures = 0;
      this.view.set({ kind: 'data', snapshot, refreshError: null });
      const age = durationBetween(snapshot.fetchedAt, this.clock.nowIso());
      this.schedule(Math.max(MIN_REFRESH_MS, WEATHER_MAX_AGE_MS - age));
    } catch (error) {
      if (this.isObsolete(sequence, call)) return;
      const failure = toWeatherError(error);
      if (failure.kind === 'throttled') return;
      this.failures++;
      const cached = this.service.cached(this.ctx, location);
      this.view.set(
        cached
          ? { kind: 'data', snapshot: cached, refreshError: failure }
          : { kind: 'error', error: failure },
      );
      this.schedule(RETRY_STEPS_MS[Math.min(this.failures, RETRY_STEPS_MS.length) - 1]);
    } finally {
      if (!this.isObsolete(sequence, call)) this.refreshing.set(false);
    }
  }

  private isObsolete(sequence: number, call: number): boolean {
    return this.destroyed || sequence !== this.sequence || call !== this.callId;
  }

  private schedule(delayMs: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.refresh({ ignoreRetryDelay: true });
    }, delayMs);
  }

  private scheduleTick(): void {
    this.tickTimer = setTimeout(() => {
      this.now.set(this.clock.nowIso());
      this.scheduleTick();
    }, NOW_TICK_MS);
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(key, params);
  }

  private degrees(value: number | null, screenReader: boolean): string {
    if (value === null) {
      return this.t(screenReader ? 'widgets.weather.noValueSr' : 'widgets.weather.noValue');
    }
    return this.t(screenReader ? 'widgets.weather.degreesSr' : 'widgets.weather.degrees', {
      value,
    });
  }

  private ageText(fetchedAt: InstantIso, now: InstantIso): string {
    const message = ageMessage(fetchedAt, now);
    switch (message.kind) {
      case 'just-now':
        return this.t('widgets.weather.updatedJustNow');
      case 'minutes':
        return this.t('widgets.weather.updatedMinutesAgo', { minutes: message.minutes });
      case 'hours':
        return this.t('widgets.weather.updatedHoursAgo', { hours: message.hours });
      case 'date':
        return this.t('widgets.weather.updatedOn', {
          date: this.timeDisplay.formatInstant(fetchedAt, 'date-time'),
        });
    }
  }

  /** Never shows the original error text (spec section 8.7). */
  private errorMessage(error: WeatherError, hasData: boolean): string {
    const prefix = 'widgets.weather.';
    if (hasData) {
      return this.t(
        prefix + (error.kind === 'network' || error.kind === 'timeout' ? 'offline' : 'staleError'),
      );
    }
    switch (error.kind) {
      case 'network':
        return this.t(prefix + 'errors.network');
      case 'timeout':
        return this.t(prefix + 'errors.timeout');
      case 'upstream_status':
        return error.status === 429
          ? this.t(prefix + 'errors.rateLimited')
          : this.t(prefix + 'errors.upstream', { status: error.status });
      case 'too_large':
      case 'invalid_response':
        return this.t(prefix + 'errors.invalidResponse');
      case 'unavailable':
        return this.t(prefix + 'errors.unavailable');
      case 'client_unavailable':
        return this.t(prefix + 'errors.clientUnavailable');
      case 'forbidden':
        return this.t(prefix + 'errors.internal');
      default:
        return this.t(prefix + 'errors.unknown');
    }
  }
}
