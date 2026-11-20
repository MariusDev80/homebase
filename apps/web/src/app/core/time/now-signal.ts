import { DOCUMENT } from '@angular/common';
import { DestroyRef, Signal, inject, signal } from '@angular/core';
import type { InstantIso } from '../../data';
import { CLOCK } from './clock';
import { parseInstant } from './time-format';

/**
 * The current instant, refreshed every `periodMs` on a multiple of the period (so a 1 s display
 * flips on the second). Nothing runs while the window is hidden (spec timers-reminders D7: the
 * deadline is held by Rust, the display is recomputed from the clock on return). Call in an
 * injection context.
 */
export function createNowSignal(
  periodMs: 1000 | 60000,
  destroyRef: DestroyRef,
): Signal<InstantIso> {
  const clock = inject(CLOCK);
  const doc = inject(DOCUMENT);
  const win = doc.defaultView;
  const now = signal<InstantIso>(clock.nowIso());
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stop = (): void => {
    clearTimeout(timer);
    timer = undefined;
  };
  const schedule = (): void => {
    stop();
    if (doc.visibilityState === 'hidden') return;
    const delay = periodMs - (parseInstant(clock.nowIso()).epochMilliseconds % periodMs);
    timer = setTimeout(() => {
      now.set(clock.nowIso());
      schedule();
    }, delay);
  };
  const resume = (): void => {
    if (doc.visibilityState === 'hidden') {
      stop();
      return;
    }
    now.set(clock.nowIso());
    schedule();
  };

  doc.addEventListener('visibilitychange', resume);
  win?.addEventListener('focus', resume);
  destroyRef.onDestroy(() => {
    stop();
    doc.removeEventListener('visibilitychange', resume);
    win?.removeEventListener('focus', resume);
  });
  schedule();
  return now.asReadonly();
}
