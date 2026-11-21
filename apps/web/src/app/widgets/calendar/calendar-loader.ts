import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { CalendarAggregator, type CalendarEvent, type CalendarRange } from '../../core/calendar';
import { rangeLocalDates } from '../../core/calendar/calendar-range';
import type { LocalDateIso } from '../../data';

export interface LoadedDays {
  readonly firstOn: LocalDateIso;
  readonly lastOn: LocalDateIso;
}

/**
 * Loads the aggregated events of the visible range (spec calendar T5). Navigation loads at once,
 * other triggers are debounced by the caller through `delayMs`. A response that is not the latest
 * is ignored (L11); the previous data stay visible until the new one arrives.
 */
@Injectable()
export class CalendarLoader {
  private readonly aggregator = inject(CalendarAggregator);
  private counter = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;

  readonly events = signal<readonly CalendarEvent[]>([]);
  /** The days that `events` cover (what was requested last successfully). */
  readonly loaded = signal<LoadedDays | null>(null);
  readonly failedSources = signal<readonly string[]>([]);
  readonly truncated = signal(false);
  readonly unavailable = signal(false);
  /** First load only. */
  readonly loading = signal(true);
  /** A request is in flight (aria-busy). */
  readonly busy = signal(false);
  readonly error = signal(false);

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      clearTimeout(this.timer);
    });
  }

  request(range: CalendarRange, delayMs: number): void {
    const id = ++this.counter;
    clearTimeout(this.timer);
    this.busy.set(true);
    if (delayMs <= 0) {
      void this.run(id, range);
      return;
    }
    this.timer = setTimeout(() => void this.run(id, range), delayMs);
  }

  private async run(id: number, range: CalendarRange): Promise<void> {
    try {
      const result = await this.aggregator.listEvents(range);
      if (this.destroyed || id !== this.counter) return;
      this.events.set(result.events);
      this.loaded.set(rangeLocalDates(range));
      this.failedSources.set(result.failedSources);
      this.truncated.set(result.truncated);
      this.unavailable.set(result.unavailable);
      this.error.set(false);
    } catch {
      if (this.destroyed || id !== this.counter) return;
      this.error.set(true);
    } finally {
      if (!this.destroyed && id === this.counter) {
        this.loading.set(false);
        this.busy.set(false);
      }
    }
  }
}
