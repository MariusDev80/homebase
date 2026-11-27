import { stringifyJson } from './wire';

describe('stringifyJson', () => {
  it('serializes JSON values', () => {
    expect(stringifyJson({ a: [1, 'b', null] })).toBe('{"a":[1,"b",null]}');
  });

  it.each([
    ['undefined', undefined],
    ['a function', () => 1],
    ['a symbol', Symbol('x')],
    ['a BigInt', { n: 1n }],
    [
      'a cycle',
      (() => {
        const c: Record<string, unknown> = {};
        c['self'] = c;
        return c;
      })(),
    ],
  ])('is invalid_input for %s', (_name, value) => {
    expect(() => stringifyJson(value)).toThrowError(
      expect.objectContaining({ kind: 'invalid_input' }),
    );
  });
});
