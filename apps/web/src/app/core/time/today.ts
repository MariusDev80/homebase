import { DOCUMENT } from '@angular/common';
import {
  DestroyRef,
  Injectable,
  Signal,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import type { LocalDateIso } from '../../data';
import { CLOCK } from './clock';
import { addDays } from './local-date';
import { UserTimeZone } from './time-zone';
import { durationBetween, startOfDay, todayIn } from './zoned';

const MAX_TIMER_MS = 15 * 60 * 1000;
const MIN_TIMER_MS = 1000;

/** The current calendar date in the user's time zone (ADR-003 sections 3.2 and 8.2). */
@Injectable({ providedIn: 'root' })
export class Today {
  private readonly clock = inject(CLOCK);
  private readonly zone = inject(UserTimeZone);
  private readonly doc = inject(DOCUMENT);
  /** Bumped to force a re-read of the clock; the value itself is irrelevant. */
  private readonly tick = signal(0);
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** Recomputed at the next local midnight (timer capped at 15 min), on focus/visibility and on zone change. */
  readonly date: Signal<LocalDateIso> = computed(() => {
    this.tick();
    return todayIn(this.clock, this.zone.id());
  });

  constructor() {
    const refresh = (): void => {
      this.tick.update((n) => n + 1);
      this.schedule();
    };
    const onVisibility = (): void => {
      if (this.doc.visibilityState !== 'hidden') refresh();
    };
    const win = this.doc.defaultView;
    this.doc.addEventListener('visibilitychange', onVisibility);
    win?.addEventListener('focus', refresh);
    inject(DestroyRef).onDestroy(() => {
      this.doc.removeEventListener('visibilitychange', onVisibility);
      win?.removeEventListener('focus', refresh);
      clearTimeout(this.timer);
    });
    this.schedule();
    // A zone change moves the next local midnight: re-arm the timer.
    effect(() => {
      this.zone.id();
      untracked(() => this.schedule());
    });
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.tick.update((n) => n + 1);
      this.schedule();
    }, this.delayMs());
  }

  private delayMs(): number {
    try {
      const now = this.clock.nowIso();
      const midnight = startOfDay(addDays(this.date(), 1), this.zone.id());
      return Math.min(MAX_TIMER_MS, Math.max(MIN_TIMER_MS, durationBetween(now, midnight)));
    } catch {
      return MAX_TIMER_MS;
    }
  }
}
