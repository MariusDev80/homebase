import * as v from 'valibot';
import type { WeatherPlace } from '../../core/weather';

const text = (max: number) => v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(max));

export const weatherLocationSchema = v.object({
  name: text(200),
  region: v.nullable(text(200)),
  country: v.nullable(text(200)),
  latitude: v.pipe(v.number(), v.finite(), v.minValue(-90), v.maxValue(90)),
  longitude: v.pipe(v.number(), v.finite(), v.minValue(-180), v.maxValue(180)),
});

export const weatherConfigSchema = v.object({
  location: v.nullable(weatherLocationSchema),
  days: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(7)),
});

export type WeatherConfig = v.InferOutput<typeof weatherConfigSchema>;
export type WeatherLocation = NonNullable<WeatherConfig['location']>;
export const WEATHER_CONFIG_VERSION = 1;
export const weatherDefaults = (): WeatherConfig => ({ location: null, days: 5 });

/** Keeps only what the widget stores: no GeoNames id, no time zone. */
export function toWeatherLocation(place: WeatherPlace): WeatherLocation {
  return {
    name: place.name,
    region: place.region,
    country: place.country,
    latitude: place.latitude,
    longitude: place.longitude,
  };
}
