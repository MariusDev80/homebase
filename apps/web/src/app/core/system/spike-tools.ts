import { InjectionToken, isDevMode } from '@angular/core';

/**
 * Debug-only spike tools (test notification). The matching Rust command is only registered and
 * authorised in debug builds; the production Angular build (release exe) hides the UI.
 */
export const SPIKE_TOOLS_ENABLED = new InjectionToken<boolean>('SPIKE_TOOLS_ENABLED', {
  providedIn: 'root',
  factory: () => isDevMode(),
});
