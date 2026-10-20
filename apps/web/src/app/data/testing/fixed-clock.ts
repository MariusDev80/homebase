import { Clock, IdGenerator } from '../clock';

/** Adjustable clock for tests. */
export class FixedClock implements Clock {
  constructor(private current = '2026-01-01T00:00:00.000Z') {}

  nowIso(): string {
    return this.current;
  }

  set(iso: string): void {
    this.current = iso;
  }
}

/** Deterministic ids: 00000000-0000-4000-8000-00000000000N (N = 12-digit counter). */
export function sequentialIds(): IdGenerator {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
}
