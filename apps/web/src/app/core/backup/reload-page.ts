import { InjectionToken } from '@angular/core';

/** Reloads the application (after a configuration import). Replaceable in tests. */
export const RELOAD_PAGE = new InjectionToken<() => void>('RELOAD_PAGE', {
  providedIn: 'root',
  factory: () => () => location.reload(),
});
