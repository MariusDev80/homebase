import type { Clock } from '../../data';
import { Temporal } from './temporal';
import { parseInstant } from './time-format';

export { CLOCK } from '../../data';

/** The current instant, read from the injected clock (never from the system directly). */
export function nowInstant(clock: Clock): Temporal.Instant {
  return parseInstant(clock.nowIso());
}
