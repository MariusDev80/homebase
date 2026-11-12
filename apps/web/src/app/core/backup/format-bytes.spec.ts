import { formatBytes } from './format-bytes';

describe('formatBytes', () => {
  const text = (bytes: number): string => formatBytes(bytes).replaceAll(/\s/g, ' ');

  it('uses base 1024 units', () => {
    expect(text(0)).toBe('0 o');
    expect(text(1023)).toBe('1023 o');
    expect(text(1024)).toBe('1 Kio');
    expect(text(1536)).toBe('1,5 Kio');
    expect(text(10 * 1024)).toBe('10 Kio');
    expect(text(5 * 1024 * 1024)).toBe('5 Mio');
    expect(text(3 * 1024 ** 3)).toBe('3 Gio');
  });

  it('caps at the largest unit and rejects invalid values', () => {
    expect(text(2048 * 1024 ** 4)).toBe('2048 Tio');
    expect(formatBytes(-1)).toBe('');
    expect(formatBytes(Number.NaN)).toBe('');
  });
});
