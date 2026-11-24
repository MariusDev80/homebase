import { DestroyRef } from '@angular/core';
import type { Clock, InstantIso } from '../../data';
import { durationBetween } from './zoned';

const DUE_MARGIN_MS = 1000;
const MAX_WAIT_MS = 15 * 60 * 1000;
const MAX_BACKOFF_MS = 30 * 1000;
/** `visibilitychange` and `focus` often fire together: one re-read is enough. */
const EVENT_DEBOUNCE_MS = 250;

/**
 * Re-read policy of the stores fed by the Rust scheduler (spec timers-reminders D8, no push):
 * `refresh` runs when the window becomes visible, on focus (events closer than 250 ms count once),
 * and 1 s after the next known deadline (waits are capped at 15 min and re-armed by the next
 * `arm`). A deadline that is already past when armed (the scheduler has not settled it yet) is
 * retried with a growing delay: 1 s, 2 s, 4 s... capped at 30 s, reset when the deadline changes.
 * Nothing is scheduled while the window is hidden.
 */
export class DueRefresher {
  private target: InstantIso | null = null;
  private lateAttempts = 0;
  private lastEventRefresh: InstantIso | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly doc: Document,
    private readonly clock: Clock,
    destroyRef: DestroyRef,
    private readonly refresh: () => void,
  ) {
    const win = doc.defaultView;
    const onVisibility = (): void => {
      if (doc.visibilityState === 'hidden') this.clear();
      else {
        // A focus may already have refreshed while still hidden (no timer armed then), and the
        // debounce would swallow this event: re-arm the known deadline unconditionally.
        this.arm(this.target);
        this.refreshFromEvent();
      }
    };
    const onFocus = (): void => this.refreshFromEvent();
    doc.addEventListener('visibilitychange', onVisibility);
    win?.addEventListener('focus', onFocus);
    destroyRef.onDestroy(() => {
      this.clear();
      doc.removeEventListener('visibilitychange', onVisibility);
      win?.removeEventListener('focus', onFocus);
    });
  }

  /** Sets the next deadline to watch (null: none) and (re)arms the timer. */
  arm(nextDueAt: InstantIso | null): void {
    if (nextDueAt !== this.target) this.lateAttempts = 0;
    this.target = nextDueAt;
    this.clear();
    if (this.target === null || this.doc.visibilityState === 'hidden') return;
    let untilDue = MAX_WAIT_MS;
    try {
      untilDue = durationBetween(this.clock.nowIso(), this.target);
    } catch {
      // An unreadable deadline is re-read at the cap.
    }
    let delay: number;
    if (untilDue > 0) {
      delay = Math.min(MAX_WAIT_MS, untilDue + DUE_MARGIN_MS);
    } else {
      delay = Math.min(MAX_BACKOFF_MS, DUE_MARGIN_MS * 2 ** this.lateAttempts);
      this.lateAttempts++;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.refresh();
    }, delay);
  }

  private refreshFromEvent(): void {
    const now = this.clock.nowIso();
    if (this.lastEventRefresh !== null) {
      try {
        if (durationBetween(this.lastEventRefresh, now) < EVENT_DEBOUNCE_MS) return;
      } catch {
        // Unreadable clock: refresh anyway.
      }
    }
    this.lastEventRefresh = now;
    this.refresh();
  }

  private clear(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
