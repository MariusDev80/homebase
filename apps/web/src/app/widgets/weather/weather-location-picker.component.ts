import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UrlOpener } from '../../core/system';
import { WeatherService } from '../../core/weather';
import type { WeatherPlace } from '../../core/weather';
import { injectWidgetContext } from '../../core/widgets';
import { placeLabels } from './weather-format';
import type { WeatherConfig } from './weather.config';

export const PLACE_SEARCH_DEBOUNCE_MS = 300;
const QUERY_MIN_CHARS = 2;
const QUERY_MAX_CHARS = 100;
const GEONAMES_URL = 'https://www.geonames.org/';

type SearchState = 'idle' | 'too-short' | 'searching' | 'results' | 'empty' | 'error';

@Component({
  selector: 'app-weather-location-picker',
  imports: [TranslocoPipe],
  templateUrl: './weather-location-picker.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-0 flex-col gap-2' },
})
export class WeatherLocationPickerComponent {
  readonly disabled = input(false);
  readonly picked = output<WeatherPlace>();
  readonly cancelled = output<void>();

  protected readonly ctx = injectWidgetContext<WeatherConfig>();
  private readonly service = inject(WeatherService);
  private readonly urlOpener = inject(UrlOpener);
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');

  protected readonly inputId = `weather-search-${this.ctx.instanceId}`;
  protected readonly hintId = `${this.inputId}-hint`;
  protected readonly maxLength = QUERY_MAX_CHARS;
  protected readonly state = signal<SearchState>('idle');
  protected readonly places = signal<readonly WeatherPlace[]>([]);
  protected readonly linkError = signal(false);
  protected readonly entries = computed(() => {
    const places = this.places();
    const labels = placeLabels(places);
    return places.map((place, index) => ({ place, label: labels[index] }));
  });

  private timer: ReturnType<typeof setTimeout> | undefined;
  private token = 0;

  constructor() {
    afterNextRender(() => this.field().nativeElement.focus());
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.timer);
      this.token++;
    });
  }

  protected onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value.trim();
    clearTimeout(this.timer);
    this.timer = undefined;
    this.token++;
    const length = [...value].length;
    if (length < QUERY_MIN_CHARS) {
      this.places.set([]);
      this.state.set(length === 0 ? 'idle' : 'too-short');
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.search(value);
    }, PLACE_SEARCH_DEBOUNCE_MS);
  }

  protected onEscape(): void {
    this.cancelled.emit();
  }

  protected async openGeonames(): Promise<void> {
    this.linkError.set(false);
    try {
      await this.urlOpener.open(this.ctx, GEONAMES_URL);
    } catch {
      this.linkError.set(true);
    }
  }

  private async search(query: string): Promise<void> {
    const token = ++this.token;
    this.state.set('searching');
    try {
      const places = await this.service.searchPlaces(this.ctx, query);
      if (token !== this.token) return;
      this.places.set(places);
      this.state.set(places.length > 0 ? 'results' : 'empty');
    } catch {
      if (token !== this.token) return;
      this.places.set([]);
      this.state.set('error');
    }
  }
}
