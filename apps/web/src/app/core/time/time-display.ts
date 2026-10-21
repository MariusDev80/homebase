import { Injectable, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import type { InstantIso, LocalDateIso, TimeZoneId } from '../../data';
import { parseInstant, parseLocalDate } from './time-format';
import { UserTimeZone } from './time-zone';

export type DateStyle = 'short' | 'long' | 'weekday-long';
export type InstantStyle = 'time' | 'date' | 'date-time';

const LOCALES: Readonly<Record<string, string>> = { fr: 'fr-FR' };
const UTC = 'UTC';

const DATE_OPTIONS: Readonly<Record<DateStyle, Intl.DateTimeFormatOptions>> = {
  short: { day: 'numeric', month: 'short', year: 'numeric' },
  long: { dateStyle: 'long' },
  'weekday-long': { dateStyle: 'full' },
};

const INSTANT_OPTIONS: Readonly<Record<InstantStyle, Intl.DateTimeFormatOptions>> = {
  time: { hour: '2-digit', minute: '2-digit' },
  date: { day: 'numeric', month: 'short', year: 'numeric' },
  'date-time': {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  },
};

/** The only place that formats dates for display (ADR-003 section 3.4). */
@Injectable({ providedIn: 'root' })
export class TimeDisplay {
  private readonly transloco = inject(TranslocoService);
  private readonly userZone = inject(UserTimeZone);
  private readonly formatters = new Map<string, Intl.DateTimeFormat>();

  /** A calendar date never goes through a time zone conversion. */
  formatLocalDate(date: LocalDateIso, style: DateStyle): string {
    const midnightUtc = parseLocalDate(date).toZonedDateTime(UTC).epochMilliseconds;
    return this.formatter(`date:${style}`, DATE_OPTIONS[style], UTC).format(midnightUtc);
  }

  formatInstant(instant: InstantIso, style: InstantStyle, timeZone?: TimeZoneId): string {
    const zone = timeZone ?? this.userZone.id();
    return this.formatter(`instant:${style}`, INSTANT_OPTIONS[style], zone).format(
      parseInstant(instant).epochMilliseconds,
    );
  }

  private locale(): string {
    const lang = this.transloco.getActiveLang();
    return LOCALES[lang] ?? lang;
  }

  private formatter(
    key: string,
    options: Intl.DateTimeFormatOptions,
    timeZone: string,
  ): Intl.DateTimeFormat {
    const locale = this.locale();
    const cacheKey = `${locale}|${key}|${timeZone}`;
    let formatter = this.formatters.get(cacheKey);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone });
      this.formatters.set(cacheKey, formatter);
    }
    return formatter;
  }
}
