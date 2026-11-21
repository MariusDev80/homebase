import { InjectionToken } from '@angular/core';

const LINK_ATTRIBUTE = 'data-hb-style';
const LINK_ID = 'calendar-lib';
/** angular.json: the `fullcalendar/skeleton.css` entry (bundleName `calendar-lib`, inject false). */
export const CALENDAR_LIB_HREF = 'calendar-lib.css';
const LOAD_TIMEOUT_MS = 10_000;

export type CalendarStylesLoader = (doc: Document) => Promise<void>;

const pending = new WeakMap<
  Document,
  { readonly promise: Promise<void>; readonly link: HTMLLinkElement }
>();

/**
 * Inserts the library stylesheet once per document (a single `<link>` however many widgets), and
 * resolves when it has loaded. Rejects on `error` or after 10 s; a failure is forgotten so that
 * the next call tries again. The element is created with `createElement`, never from a string.
 */
export function ensureCalendarStyles(
  doc: Document,
  timeoutMs: number = LOAD_TIMEOUT_MS,
): Promise<void> {
  const known = pending.get(doc);
  if (known?.link.isConnected) return known.promise;
  const link = doc.createElement('link');
  const promise = new Promise<void>((resolve, reject) => {
    let clear: () => void = () => undefined;
    const settle = (error: Error | null): void => {
      clear();
      if (error === null) {
        resolve();
        return;
      }
      link.remove();
      if (pending.get(doc)?.link === link) pending.delete(doc);
      reject(error);
    };
    link.rel = 'stylesheet';
    link.href = CALENDAR_LIB_HREF;
    link.id = LINK_ID;
    link.setAttribute(LINK_ATTRIBUTE, LINK_ID);
    link.addEventListener('load', () => settle(null), { once: true });
    link.addEventListener('error', () => settle(new Error('Calendar stylesheet failed')), {
      once: true,
    });
    const timer = setTimeout(() => settle(new Error('Calendar stylesheet timed out')), timeoutMs);
    clear = () => clearTimeout(timer);
    doc.head.appendChild(link);
  });
  pending.set(doc, { promise, link });
  return promise;
}

export const CALENDAR_STYLES_LOADER = new InjectionToken<CalendarStylesLoader>(
  'CALENDAR_STYLES_LOADER',
  { providedIn: 'root', factory: () => (doc) => ensureCalendarStyles(doc) },
);
