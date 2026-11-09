import { CARD_TINTS, TINT_DEFAULT, TINT_VALUE_PATTERN, knownTint } from './dashboard-theme';

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
