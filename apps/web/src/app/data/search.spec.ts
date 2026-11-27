import { excerptAround, hbTrim } from './search';

describe('search helpers', () => {
  it('builds a short excerpt around the first match with ellipses', () => {
    const body = `${'a '.repeat(50)}NEEDLE${' b'.repeat(80)}`;
    const excerpt = excerptAround(body, 'needle');
    expect(excerpt.startsWith('…')).toBe(true);
    expect(excerpt.endsWith('…')).toBe(true);
    expect(excerpt).toContain('NEEDLE');
    expect(excerpt.length).toBeLessThan(110);
  });

  it('collapses whitespace and falls back to the start of the body without a match', () => {
    expect(excerptAround('line one\n\n  line two', 'zzz')).toBe('line one line two');
    expect(excerptAround('', 'x')).toBe('');
  });

  it('keeps a window with ellipses on both sides for a match in the middle of a long body', () => {
    const body = `${'x'.repeat(100)}NEEDLE${'y'.repeat(200)}`;
    const excerpt = excerptAround(body, 'needle');
    expect(excerpt).toBe(`…${'x'.repeat(30)}NEEDLE${'y'.repeat(64)}…`);
  });

  it('adds no suffix when the match is at the end of the body', () => {
    const body = `${'a'.repeat(100)}NEEDLE`;
    const excerpt = excerptAround(body, 'needle');
    expect(excerpt).toBe(`…${'a'.repeat(30)}NEEDLE`);
    expect(excerpt.endsWith('…')).toBe(false);
  });

  it('falls back to the start of the body when lower-casing changes its length', () => {
    // 'İ'.toLowerCase() is two code units, so indexes in the lowered body do not map to the body.
    const body = `İ${'a'.repeat(100)}NEEDLE${'b'.repeat(50)}`;
    expect(body.toLowerCase().length).not.toBe(body.length);
    expect(excerptAround(body, 'needle')).toBe(`İ${'a'.repeat(99)}…`);
  });
});

describe('hbTrim', () => {
  it('trims like Rust hb_trim, including U+0085 that String.trim keeps', () => {
    expect('a\u0085'.trim()).toBe('a\u0085');
    expect(hbTrim('\u0085 needle \u0085')).toBe('needle');
    expect(hbTrim(' ﻿　a b \t\n')).toBe('a b');
    expect(hbTrim('  \u0085 ')).toBe('');
    expect(hbTrim('a​b')).toBe('a​b');
  });

  it('gives the excerpt term a query ending with U+0085', () => {
    const body = `${'a'.repeat(40)}needle tail`;
    expect(excerptAround(body, hbTrim('needle\u0085'))).toContain('…');
    expect(excerptAround(body, 'needle\u0085')).not.toContain('…');
  });
});
