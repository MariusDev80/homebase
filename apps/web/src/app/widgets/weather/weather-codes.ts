export type WeatherIconName =
  | 'sun'
  | 'moon'
  | 'cloud-sun'
  | 'cloud-moon'
  | 'cloud'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'freezing'
  | 'showers'
  | 'snow'
  | 'snowflake'
  | 'thunderstorm'
  | 'unknown';

export type WeatherTone = 'muted' | 'attention' | 'accent';

export interface WeatherDescription {
  readonly labelKey: string;
  readonly icon: WeatherIconName;
  readonly tone: WeatherTone;
}

interface Entry {
  readonly day: WeatherIconName;
  readonly night: WeatherIconName;
  readonly dayTone: WeatherTone;
  readonly nightTone: WeatherTone;
}

const same = (icon: WeatherIconName, tone: WeatherTone): Entry => ({
  day: icon,
  night: icon,
  dayTone: tone,
  nightTone: tone,
});

const CLEAR: Entry = { day: 'sun', night: 'moon', dayTone: 'attention', nightTone: 'muted' };
const PARTLY: Entry = {
  day: 'cloud-sun',
  night: 'cloud-moon',
  dayTone: 'muted',
  nightTone: 'muted',
};
const SHOWERS: Entry = { day: 'showers', night: 'rain', dayTone: 'accent', nightTone: 'accent' };

/** WMO weather codes documented by Open-Meteo (spec section 8.3). */
const ENTRIES: Readonly<Record<number, Entry>> = {
  0: CLEAR,
  1: CLEAR,
  2: PARTLY,
  3: same('cloud', 'muted'),
  45: same('fog', 'muted'),
  48: same('fog', 'muted'),
  51: same('drizzle', 'accent'),
  53: same('drizzle', 'accent'),
  55: same('drizzle', 'accent'),
  56: same('freezing', 'accent'),
  57: same('freezing', 'accent'),
  61: same('rain', 'accent'),
  63: same('rain', 'accent'),
  65: same('rain', 'accent'),
  66: same('freezing', 'accent'),
  67: same('freezing', 'accent'),
  71: same('snow', 'muted'),
  73: same('snow', 'muted'),
  75: same('snow', 'muted'),
  77: same('snowflake', 'muted'),
  80: SHOWERS,
  81: SHOWERS,
  82: SHOWERS,
  85: same('snow', 'muted'),
  86: same('snow', 'muted'),
  95: same('thunderstorm', 'attention'),
  96: same('thunderstorm', 'attention'),
  97: same('thunderstorm', 'attention'),
  99: same('thunderstorm', 'attention'),
};

/** `widgets.weather.conditions.c<code>`; an unknown or null code gives `conditions.unknown`. */
export function describeWeather(code: number | null, isDay: boolean): WeatherDescription {
  const entry = code === null || !Number.isInteger(code) ? undefined : ENTRIES[code];
  if (!entry) {
    return { labelKey: 'widgets.weather.conditions.unknown', icon: 'unknown', tone: 'muted' };
  }
  return {
    labelKey: `widgets.weather.conditions.c${code}`,
    icon: isDay ? entry.day : entry.night,
    tone: isDay ? entry.dayTone : entry.nightTone,
  };
}

export const WEATHER_TONE_CLASS: Readonly<Record<WeatherTone, string>> = {
  muted: 'text-fg-muted',
  attention: 'text-attention',
  accent: 'text-accent',
};
