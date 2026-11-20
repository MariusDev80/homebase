import { codePointLength, hbTrim } from './hb-trim';

describe('hbTrim', () => {
  // Same vectors as `hb_trim_vectors` in apps/desktop/src-tauri/src/backup/names.rs.
  const vectors: readonly (readonly [string, string])[] = [
    ['  a  ', 'a'],
    ['\u00A0a\u00A0', 'a'],
    ['\uFEFFa\uFEFF', 'a'],
    ['\u0085a\u0085', 'a'],
    ['\u3000a\u3000', 'a'],
    ['\t\n\u000B\u000C\ra\r\u000C\u000B\n\t', 'a'],
    ['\u1680\u2000\u200Aa\u2028\u2029\u202F\u205F', 'a'],
    ['a b', 'a b'],
    ['a\u00A0b', 'a\u00A0b'],
    ['a\uFEFFb', 'a\uFEFFb'],
    [' \uFEFF a \u3000', 'a'],
    ['   ', ''],
    ['', ''],
    ['\u200Ba', '\u200Ba'],
  ];

  it.each(vectors)('hbTrim(%j) = %j', (input, expected) => {
    expect(hbTrim(input)).toBe(expected);
  });

  it('removes U+0085 and U+FEFF, which JS trim() does not both handle', () => {
    expect('\u0085a'.trim()).toBe('\u0085a');
    expect(hbTrim('\u0085a')).toBe('a');
    expect(hbTrim('\uFEFFAccueil')).toBe('Accueil');
  });

  it('normalises a stored name once, then is idempotent', () => {
    const stored = '\u0085 Accueil\u00A0\uFEFF';
    const once = hbTrim(stored);
    expect(once).toBe('Accueil');
    expect(hbTrim(once)).toBe(once);
  });
});

describe('codePointLength', () => {
  it('counts code points, not UTF-16 units', () => {
    expect(codePointLength('')).toBe(0);
    expect(codePointLength('abc')).toBe(3);
    expect(codePointLength('é'.repeat(100))).toBe(100);
    expect(codePointLength('\u{1F600}')).toBe(1);
    expect('\u{1F600}'.length).toBe(2);
    expect(codePointLength('\u{1F600}'.repeat(101))).toBe(101);
    expect(codePointLength('é')).toBe(2);
  });
});
