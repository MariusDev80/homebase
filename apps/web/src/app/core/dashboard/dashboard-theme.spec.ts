import {
  CARD_TINTS,
  DASHBOARD_THEME_SPEC,
  DEFAULT_CARD_THEME,
  TINT_DEFAULT,
  TINT_VALUE_PATTERN,
  bodyTint,
  cardThemeStyle,
  headerTint,
  knownTint,
  resolveCardTheme,
  tintSwatchStyle,
  withTint,
} from './dashboard-theme';
import type { CardTheme } from './dashboard-theme';
import type { JsonObject } from '../../data';
import { serializeConfig } from '../widgets/widget-config';

describe('CARD_TINTS', () => {
  it('lists 12 unique lowercase ASCII ids, none of them the default value', () => {
    expect(CARD_TINTS).toHaveLength(12);
    expect(new Set(CARD_TINTS).size).toBe(12);
    for (const tint of CARD_TINTS) {
      expect(tint).toMatch(/^[a-z]+$/);
      expect(TINT_VALUE_PATTERN.test(tint)).toBe(true);
      expect(tint).not.toBe(TINT_DEFAULT);
    }
  });
});

describe('knownTint', () => {
  it('returns a listed tint', () => {
    expect(knownTint('rose')).toBe('rose');
  });

  it.each([TINT_DEFAULT, 'coral', '__proto__', 'constructor', '', 'Rose'])(
    'returns null for %j',
    (value) => {
      expect(knownTint(value)).toBeNull();
    },
  );
});

const theme = (cardBody: string, cardHeader: string): CardTheme => ({ cardBody, cardHeader });

describe('resolveCardTheme', () => {
  it('fills the defaults of an empty v1 object (S1)', () => {
    expect(resolveCardTheme({}, 1)).toEqual({ status: 'ok', theme: DEFAULT_CARD_THEME });
  });

  it('accepts a known tint and keeps an unknown but well-formed one', () => {
    expect(resolveCardTheme({ cardBody: 'rose', cardHeader: 'default' }, 1)).toEqual({
      status: 'ok',
      theme: theme('rose', 'default'),
    });
    expect(resolveCardTheme({ cardBody: 'coral' }, 1)).toEqual({
      status: 'ok',
      theme: theme('coral', 'default'),
    });
  });

  it.each<[string, JsonObject]>([
    ['uppercase', { cardBody: 'Rose' }],
    ['empty', { cardBody: '' }],
    ['not a string', { cardBody: 3 }],
    ['extra key', { cardBody: 'rose', extra: 'x' }],
  ])('is invalid for %s', (_name, data) => {
    expect(resolveCardTheme(data, 1)).toEqual({ status: 'invalid' });
  });

  it('is future for a newer version, invalid for a bad one', () => {
    expect(resolveCardTheme({}, 2)).toEqual({ status: 'future' });
    expect(resolveCardTheme({}, 0)).toEqual({ status: 'invalid' });
    expect(resolveCardTheme({}, 1.5)).toEqual({ status: 'invalid' });
  });

  it('never mutates the stored object', () => {
    const stored: JsonObject = {};
    resolveCardTheme(stored, 1);
    expect(stored).toEqual({});
  });
});

describe('effective tints (D5)', () => {
  it('lets a default or unknown header follow the body', () => {
    expect(headerTint(theme('rose', 'default'))).toBe('rose');
    expect(headerTint(theme('rose', 'coral'))).toBe('rose');
    expect(headerTint(theme('rose', 'sky'))).toBe('sky');
    expect(bodyTint(theme('rose', 'sky'))).toBe('rose');
  });

  it('is null when everything is default or unknown', () => {
    expect(bodyTint(DEFAULT_CARD_THEME)).toBeNull();
    expect(headerTint(DEFAULT_CARD_THEME)).toBeNull();
    expect(headerTint(theme('coral', 'coral'))).toBeNull();
  });

  it('shows a tinted header over a default body', () => {
    expect(bodyTint(theme('default', 'sky'))).toBeNull();
    expect(headerTint(theme('default', 'sky'))).toBe('sky');
  });
});

describe('withTint', () => {
  it('returns a copy and never mutates its input', () => {
    const before = theme('default', 'default');
    const after = withTint(before, 'cardBody', 'rose');
    expect(after).toEqual(theme('rose', 'default'));
    expect(before).toEqual(DEFAULT_CARD_THEME);
    expect(withTint(after, 'cardBody', null)).toEqual(DEFAULT_CARD_THEME);
  });
});

describe('cardThemeStyle', () => {
  it('is empty for null, defaults and unknown tints', () => {
    expect(cardThemeStyle(null)).toEqual({});
    expect(cardThemeStyle(DEFAULT_CARD_THEME)).toEqual({});
    expect(cardThemeStyle(theme('coral', 'coral'))).toEqual({});
  });

  it('tints body, header and frame from a body tint', () => {
    expect(cardThemeStyle(theme('rose', 'default'))).toEqual({
      '--hb-card-body-bg': 'var(--hb-tint-rose-body)',
      '--hb-card-body-muted': 'var(--hb-tint-rose-muted)',
      '--hb-card-body-accent': 'var(--hb-on-tint-accent)',
      '--hb-card-body-danger': 'var(--hb-on-tint-danger)',
      '--hb-card-body-success': 'var(--hb-on-tint-success)',
      '--hb-card-body-attention': 'var(--hb-on-tint-attention)',
      '--hb-card-body-border': 'var(--hb-tint-rose-border)',
      '--hb-card-header-bg': 'var(--hb-tint-rose-header)',
      '--hb-card-header-muted': 'var(--hb-tint-rose-muted)',
      '--hb-card-header-border': 'var(--hb-tint-rose-border)',
    });
  });

  it('frames a default body with the border of the header tint, nothing else on the body', () => {
    expect(cardThemeStyle(theme('default', 'sky'))).toEqual({
      '--hb-card-body-border': 'var(--hb-tint-sky-border)',
      '--hb-card-header-bg': 'var(--hb-tint-sky-header)',
      '--hb-card-header-muted': 'var(--hb-tint-sky-muted)',
      '--hb-card-header-border': 'var(--hb-tint-sky-border)',
    });
  });

  it('keeps each border with two different tints', () => {
    const style = cardThemeStyle(theme('rose', 'sky'));
    expect(style['--hb-card-body-border']).toBe('var(--hb-tint-rose-border)');
    expect(style['--hb-card-header-border']).toBe('var(--hb-tint-sky-border)');
    expect(style['--hb-card-header-bg']).toBe('var(--hb-tint-sky-header)');
  });

  it('only ever emits var() references to listed tints', () => {
    for (const tint of CARD_TINTS) {
      for (const value of Object.values(cardThemeStyle(theme(tint, tint)))) {
        expect(value).toMatch(/^var\(--hb-(tint-[a-z]+-[a-z]+|on-tint-[a-z]+)\)$/);
      }
    }
  });
});

describe('tintSwatchStyle', () => {
  it('uses the default tokens without a tint', () => {
    expect(tintSwatchStyle(null)).toEqual({
      '--hb-swatch-top': 'var(--hb-bg-subtle)',
      '--hb-swatch-fill': 'var(--hb-bg)',
      '--hb-swatch-border': 'var(--hb-border)',
      '--hb-swatch-ink': 'var(--hb-fg-muted)',
    });
  });

  it('uses the header and body colors of a tint', () => {
    expect(tintSwatchStyle('mint')).toEqual({
      '--hb-swatch-top': 'var(--hb-tint-mint-header)',
      '--hb-swatch-fill': 'var(--hb-tint-mint-body)',
      '--hb-swatch-border': 'var(--hb-tint-mint-border)',
      '--hb-swatch-ink': 'var(--hb-tint-mint-muted)',
    });
  });
});

describe('DASHBOARD_THEME_SPEC', () => {
  it('serializes the defaults well under the 4096 characters of the column', () => {
    expect(serializeConfig(DASHBOARD_THEME_SPEC, DEFAULT_CARD_THEME).ok).toBe(true);
    expect(JSON.stringify(DEFAULT_CARD_THEME).length).toBeLessThanOrEqual(4096);
  });

  it('refuses a malformed value', () => {
    expect(serializeConfig(DASHBOARD_THEME_SPEC, { cardBody: 'Rose' }).ok).toBe(false);
  });
});
