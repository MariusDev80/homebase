import * as v from 'valibot';
import { isValidLocalDate } from '../time';
import { WeatherError } from './weather-error';
import type { WeatherForecast, WeatherPlace } from './weather.types';

const finite = () => v.pipe(v.number(), v.finite());
const nullableNumber = () => v.nullable(finite());
const weatherCode = () => v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(99));
const text = () => v.pipe(v.string(), v.minLength(1), v.maxLength(200));

const currentSchema = v.object({
  temperatureC: v.pipe(finite(), v.minValue(-100), v.maxValue(100)),
  apparentTemperatureC: nullableNumber(),
  relativeHumidityPct: nullableNumber(),
  windSpeedKmh: nullableNumber(),
  weatherCode: weatherCode(),
  isDay: v.boolean(),
});

const daySchema = v.object({
  date: v.pipe(v.string(), v.check(isValidLocalDate)),
  weatherCode: v.nullable(weatherCode()),
  temperatureMaxC: nullableNumber(),
  temperatureMinC: nullableNumber(),
  precipitationProbabilityPct: nullableNumber(),
});

const forecastSchema = v.object({
  timeZone: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
  current: currentSchema,
  daily: v.pipe(
    v.array(daySchema),
    v.minLength(1),
    v.maxLength(16),
    v.check((days) => days.every((day, i) => i === 0 || days[i - 1].date < day.date)),
  ),
});

const placeSchema = v.object({
  id: v.pipe(v.number(), v.integer(), v.minValue(0)),
  name: text(),
  region: v.nullable(text()),
  country: v.nullable(text()),
  latitude: v.pipe(finite(), v.minValue(-90), v.maxValue(90)),
  longitude: v.pipe(finite(), v.minValue(-180), v.maxValue(180)),
});

const placesSchema = v.pipe(
  v.array(placeSchema),
  v.maxLength(10),
  v.check((places) => new Set(places.map((place) => place.id)).size === places.length),
);

/** Defence in depth: the Rust side has already validated the payload. */
export function parseForecastPayload(raw: unknown): WeatherForecast {
  const result = v.safeParse(forecastSchema, raw);
  if (!result.success) {
    throw new WeatherError('invalid_response');
  }
  return result.output;
}

export function parsePlacesPayload(raw: unknown): readonly WeatherPlace[] {
  const result = v.safeParse(placesSchema, raw);
  if (!result.success) {
    throw new WeatherError('invalid_response');
  }
  return result.output;
}
