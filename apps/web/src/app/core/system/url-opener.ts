import { Injectable, InjectionToken, inject, isDevMode } from '@angular/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { isTauriRuntime } from '../../tauri-runtime';
import { WidgetContext, assertWidgetPermission } from '../widgets';
import { WebUrlErrorReason, parseWebUrl } from './web-url';

/** Whether `window.open` may replace the Tauri opener outside Tauri (dev mode only). */
export const URL_OPENER_BROWSER_FALLBACK = new InjectionToken<boolean>(
  'URL_OPENER_BROWSER_FALLBACK',
  {
    factory: () => isDevMode(),
  },
);

export class UrlOpenerUnavailableError extends Error {
  constructor() {
    super('Opening links is only available in the desktop app');
    this.name = 'UrlOpenerUnavailableError';
  }
}

export class InvalidUrlError extends Error {
  readonly reason: WebUrlErrorReason;

  constructor(reason: WebUrlErrorReason) {
    super(`Refusing to open this URL (${reason})`);
    this.name = 'InvalidUrlError';
    this.reason = reason;
  }
}

/**
 * Opens an http(s) URL in the default browser (ADR-001 section 3.8, permission `open-url`).
 * Inside Tauri it goes through the opener plugin, whose capability is scoped to http(s).
 * Outside Tauri it falls back, in dev mode only (`npm run web:start`), to `window.open` with
 * `noopener,noreferrer`, so the page stays usable in a plain browser during development; a production build
 * outside Tauri throws UrlOpenerUnavailableError instead.
 */
@Injectable({ providedIn: 'root' })
export class UrlOpener {
  private readonly browserFallback = inject(URL_OPENER_BROWSER_FALLBACK);

  async open(ctx: Pick<WidgetContext, 'type' | 'permissions'>, url: string): Promise<void> {
    assertWidgetPermission(ctx, 'open-url');
    const parsed = parseWebUrl(url);
    if (!parsed.ok) {
      throw new InvalidUrlError(parsed.reason);
    }
    if (isTauriRuntime()) {
      await openUrl(parsed.url);
      return;
    }
    if (!this.browserFallback) {
      throw new UrlOpenerUnavailableError();
    }
    window.open(parsed.url, '_blank', 'noopener,noreferrer');
  }
}
