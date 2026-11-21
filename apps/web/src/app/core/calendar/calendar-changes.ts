import { Injectable, signal, type Signal } from '@angular/core';

/**
 * Tells the calendar that something it aggregates was written elsewhere (spec calendar 4.1). The
 * writers (reminder store, TODO widget, dashboard store) import it by its own path, so that they do
 * not pull the aggregator. It imports nothing but `@angular/core`.
 */
@Injectable({ providedIn: 'root' })
export class CalendarChanges {
  private readonly state = signal(0);

  /** +1 on every notification. */
  readonly version: Signal<number> = this.state.asReadonly();

  /** A write of this source type succeeded. The type is informative: every calendar reloads. */
  notify(sourceType: string): void {
    void sourceType;
    this.state.update((value) => value + 1);
  }
}
