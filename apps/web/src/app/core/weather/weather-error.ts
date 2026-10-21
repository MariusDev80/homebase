import * as v from 'valibot';

export type WeatherErrorKind =
  // From the Rust commands (spec section 4.3).
  | 'invalid_input'
  | 'client_unavailable'
  | 'forbidden'
  | 'network'
  | 'timeout'
  | 'upstream_status'
  | 'too_large'
  | 'invalid_response'
  // Front only.
  | 'unavailable'
  | 'throttled'
  | 'unknown';

export interface WeatherErrorDetails {
  readonly status?: number;
  readonly field?: string;
  readonly retryAfterMs?: number;
}

export class WeatherError extends Error {
  readonly kind: WeatherErrorKind;
  /** Set for `upstream_status`. */
  readonly status: number | null;
  /** Set for `invalid_input`. */
  readonly field: string | null;
  /** Set for `throttled`. */
  readonly retryAfterMs: number | null;

  constructor(kind: WeatherErrorKind, details: WeatherErrorDetails = {}) {
    super(`Weather request failed (${kind})`);
    this.name = 'WeatherError';
    this.kind = kind;
    this.status = details.status ?? null;
    this.field = details.field ?? null;
    this.retryAfterMs = details.retryAfterMs ?? null;
  }
}

const rustErrorSchema = v.variant('kind', [
  v.object({ kind: v.literal('invalid_input'), field: v.pipe(v.string(), v.maxLength(64)) }),
  v.object({
    kind: v.literal('upstream_status'),
    status: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(999)),
  }),
  v.object({ kind: v.literal('client_unavailable') }),
  v.object({ kind: v.literal('forbidden') }),
  v.object({ kind: v.literal('network') }),
  v.object({ kind: v.literal('timeout') }),
  v.object({ kind: v.literal('too_large') }),
  v.object({ kind: v.literal('invalid_response') }),
]);

/** WeatherError as is; a payload matching the Rust error shape becomes a WeatherError; anything else is `unknown`. */
export function toWeatherError(error: unknown): WeatherError {
  if (error instanceof WeatherError) {
    return error;
  }
  const parsed = v.safeParse(rustErrorSchema, error);
  if (!parsed.success) {
    return new WeatherError('unknown');
  }
  const payload = parsed.output;
  switch (payload.kind) {
    case 'invalid_input':
      return new WeatherError('invalid_input', { field: payload.field });
    case 'upstream_status':
      return new WeatherError('upstream_status', { status: payload.status });
    default:
      return new WeatherError(payload.kind);
  }
}
