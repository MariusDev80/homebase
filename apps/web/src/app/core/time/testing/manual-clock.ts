import type { Clock, InstantIso } from '../../../data';
import { normalizeInstant } from '../time-format';
import { addDuration } from '../zoned';

/** Test clock: fixed until `set` / `advance` is called. */
export class ManualClock implements Clock {
  private current: InstantIso;

  constructor(initial: InstantIso = '2026-01-01T00:00:00.000Z') {
    this.current = normalizeInstant(initial);
  }

  nowIso(): InstantIso {
    return this.current;
  }

  set(instant: InstantIso): void {
    this.current = normalizeInstant(instant);
  }

  advance(durationMs: number): void {
    this.current = addDuration(this.current, durationMs);
  }
}
