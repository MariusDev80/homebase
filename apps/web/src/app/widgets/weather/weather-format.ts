import type { InstantIso, LocalDateIso } from '../../data';
import { compareLocalDates, daysBetween, durationBetween } from '../../core/time';
import type { WeatherDay, WeatherPlace } from '../../core/weather';
import type { WeatherLocation } from './weather.config';

export type AgeMessage =
  | { readonly kind: 'just-now' }
  | { readonly kind: 'minutes'; readonly minutes: number }
  | { readonly kind: 'hours'; readonly hours: number }
  | { readonly kind: 'date' };

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Age of a snapshot: under 60 s (negative included) = just now; then minutes, hours, finally a date. */
export function ageMessage(fetchedAt: InstantIso, now: InstantIso): AgeMessage {
  const ms = durationBetween(fetchedAt, now);
  if (ms < MINUTE_MS) return { kind: 'just-now' };
  if (ms < HOUR_MS) return { kind: 'minutes', minutes: Math.floor(ms / MINUTE_MS) };
  if (ms < DAY_MS) return { kind: 'hours', hours: Math.floor(ms / HOUR_MS) };
  return { kind: 'date' };
}

/** Math.round, with -0 normalised to 0. */
export function roundValue(value: number): number {
  const rounded = Math.round(value);
  return rounded === 0 ? 0 : rounded;
}

interface LabelParts {
  readonly name: string;
  readonly region: string | null;
  readonly country: string | null;
}

function label(parts: LabelParts): string {
  let text = parts.name;
  if (parts.region) text += `, ${parts.region}`;
  if (parts.country) text += ` (${parts.country})`;
  return text;
}

function coordinates(place: WeatherPlace): string {
  return `${place.latitude.toFixed(2)} ; ${place.longitude.toFixed(2)}`.replaceAll('.', ',');
}

/** "Name, Region (Country)"; identical labels in the list get the coordinates as a suffix. */
export function placeLabels(places: readonly WeatherPlace[]): readonly string[] {
  const labels = places.map(label);
  return labels.map((text, index) =>
    labels.indexOf(text) !== labels.lastIndexOf(text)
      ? `${text} · ${coordinates(places[index])}`
      : text,
  );
}

export function locationLabel(location: WeatherLocation): string {
  return label(location);
}

/** Days from today on (date >= today), at most `days` of them. */
export function visibleDays(
  daily: readonly WeatherDay[],
  today: LocalDateIso,
  days: number,
): readonly WeatherDay[] {
  return daily.filter((day) => compareLocalDates(day.date, today) >= 0).slice(0, days);
}

export function dayKind(date: LocalDateIso, today: LocalDateIso): 'today' | 'tomorrow' | 'weekday' {
  const offset = daysBetween(today, date);
  if (offset === 0) return 'today';
  if (offset === 1) return 'tomorrow';
  return 'weekday';
}
