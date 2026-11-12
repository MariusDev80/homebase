import { DataError } from './data-error';
import type { JsonObject } from './json';
import { validTheme } from './dashboard-theme-input';

function kindOf(run: () => unknown): string {
  try {
    run();
  } catch (e) {
    if (e instanceof DataError) return e.kind;
    throw e;
  }
  return 'no error';
}

/** Object nested `depth` levels deep (`{}` = 1). */
function nested(depth: number): JsonObject {
  let value: JsonObject = {};
  for (let i = 1; i < depth; i++) value = { a: value };
  return value;
}

describe('validTheme', () => {
  it('serializes a plain object', () => {
    expect(validTheme({ cardBody: 'rose' }, 1)).toBe('{"cardBody":"rose"}');
  });

  it('accepts an object without prototype', () => {
    const theme = Object.assign(Object.create(null) as JsonObject, { cardBody: 'rose' });
    expect(validTheme(theme, 1)).toBe('{"cardBody":"rose"}');
  });

  it('refuses class instances, maps, arrays and non-objects', () => {
    class Themed {
      cardBody = 'rose';
    }
    expect(kindOf(() => validTheme(new Themed() as unknown as JsonObject, 1))).toBe(
      'invalid_input',
    );
    expect(kindOf(() => validTheme(new Map() as unknown as JsonObject, 1))).toBe('invalid_input');
    expect(kindOf(() => validTheme([] as unknown as JsonObject, 1))).toBe('invalid_input');
    expect(kindOf(() => validTheme(null as unknown as JsonObject, 1))).toBe('invalid_input');
    expect(kindOf(() => validTheme('x' as unknown as JsonObject, 1))).toBe('invalid_input');
  });

  it('refuses a cyclic object and a nested BigInt', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(kindOf(() => validTheme(cyclic as JsonObject, 1))).toBe('invalid_input');
    expect(kindOf(() => validTheme({ n: BigInt(1) } as unknown as JsonObject, 1))).toBe(
      'invalid_input',
    );
  });

  it('refuses a toJSON that does not produce an object', () => {
    const asString = Object.assign(Object.create(null) as object, { toJSON: () => 'x' });
    const asArray = { toJSON: () => [] };
    const asNothing = { toJSON: () => undefined };
    expect(kindOf(() => validTheme(asString as JsonObject, 1))).toBe('invalid_input');
    expect(kindOf(() => validTheme(asArray as unknown as JsonObject, 1))).toBe('invalid_input');
    expect(kindOf(() => validTheme(asNothing as unknown as JsonObject, 1))).toBe('invalid_input');
  });

  it('accepts a depth of 100 and refuses 101', () => {
    expect(kindOf(() => validTheme(nested(100), 1))).toBe('no error');
    expect(kindOf(() => validTheme(nested(101), 1))).toBe('invalid_input');
  });

  it('ignores brackets inside strings when measuring the depth', () => {
    expect(kindOf(() => validTheme({ s: '['.repeat(500) + '\\"' + '{'.repeat(500) }, 1))).toBe(
      'no error',
    );
  });

  it('refuses a version that is not a safe integer >= 1', () => {
    for (const version of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, 2 ** 53]) {
      expect(kindOf(() => validTheme({}, version))).toBe('invalid_input');
    }
    expect(kindOf(() => validTheme({}, Number.MAX_SAFE_INTEGER))).toBe('no error');
  });
});
