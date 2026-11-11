// The only access point to temporal-polyfill (ADR-003 section 3.4, amended 2026-10-21).
// WebView2 ships a native Temporal, so the polyfill is loaded lazily and only when
// globalThis.Temporal is missing. main.ts awaits installTemporal() before bootstrapping; the test
// setup installs the polyfill as a global instead (src/test-setup.ts).
import type * as Poly from 'temporal-polyfill';

type Spec = typeof Poly.Temporal;

/** Live binding: set by installTemporal() before the app (or the specs) start. */
export let Temporal = (globalThis as { Temporal?: Spec }).Temporal as Spec;

// Type-only namespace merged with the binding, so `Temporal.Instant` works as a type and a value.
// eslint-disable-next-line @typescript-eslint/no-namespace
export declare namespace Temporal {
  type Instant = Poly.Temporal.Instant;
  type PlainDate = Poly.Temporal.PlainDate;
  type PlainDateTime = Poly.Temporal.PlainDateTime;
  type PlainYearMonth = Poly.Temporal.PlainYearMonth;
  type ZonedDateTime = Poly.Temporal.ZonedDateTime;
}

/** Loads the polyfill only if the runtime has no native Temporal. Idempotent. */
export async function installTemporal(): Promise<void> {
  if (Temporal) return;
  Temporal = (await import('temporal-polyfill')).Temporal;
}
