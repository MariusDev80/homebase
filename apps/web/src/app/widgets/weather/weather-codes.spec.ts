import fr from '../../core/i18n/fr.json';
import { describeWeather } from './weather-codes';

const CODES = [
  0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86,
  95, 96, 97, 99,
];

describe('describeWeather', () => {
  it.each(CODES)('code %s has a label present in fr.json', (code) => {
    const key = describeWeather(code, true).labelKey.replace('widgets.weather.conditions.', '');
    const conditions = fr.widgets.weather.conditions as Record<string, string>;
    expect(typeof conditions[key]).toBe('string');
    expect(conditions[key].length).toBeGreaterThan(0);
    expect(describeWeather(code, true).icon).not.toBe('unknown');
  });

  it('switches to night icons', () => {
    expect(describeWeather(0, false)).toMatchObject({ icon: 'moon', tone: 'muted' });
    expect(describeWeather(1, false).icon).toBe('moon');
    expect(describeWeather(2, false).icon).toBe('cloud-moon');
    expect(describeWeather(80, false).icon).toBe('rain');
    expect(describeWeather(80, true).icon).toBe('showers');
    expect(describeWeather(0, true)).toMatchObject({ icon: 'sun', tone: 'attention' });
  });

  it.each([4, 100, null, 3.5])('maps %s to unknown', (code) => {
    expect(describeWeather(code, true)).toEqual({
      labelKey: 'widgets.weather.conditions.unknown',
      icon: 'unknown',
      tone: 'muted',
    });
  });

  it('exposes the conditions.unknown label', () => {
    expect(fr.widgets.weather.conditions.unknown).toBe('Conditions inconnues');
  });
});
