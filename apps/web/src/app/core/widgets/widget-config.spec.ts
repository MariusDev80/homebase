import type { StandardSchemaV1 } from '@standard-schema/spec';
import * as v from 'valibot';
import type { JsonObject } from '../../data';
import { fixtureDefinition, migratedDefinition } from '../testing/fixture-definitions';
import { MAX_CONFIG_CHARS, resolveConfig, serializeConfig } from './widget-config';
import type { WidgetConfigSpec } from './widget-definition';

const spec = fixtureDefinition().config;

describe('resolveConfig', () => {
  it('returns ok without migration (migratedFrom null)', () => {
    expect(resolveConfig(spec, 1, { label: 'x' })).toEqual({
      status: 'ok',
      config: { label: 'x' },
      migratedFrom: null,
    });
  });

  it.each([0, -1, 1.5])('rejects version %s', (version) => {
    const result = resolveConfig(spec, version, { label: 'x' });
    expect(result).toMatchObject({ status: 'invalid', reason: 'invalid-version' });
  });

  it('flags a future version', () => {
    expect(resolveConfig(spec, 2, { label: 'x' })).toMatchObject({
      status: 'invalid',
      reason: 'future-version',
    });
  });

  it('applies migrations 1 -> 2 -> 3 in order', () => {
    const result = resolveConfig(migratedDefinition.config, 1, { title: 'hi' });
    expect(result).toEqual({ status: 'ok', config: { label: 'hi' }, migratedFrom: 1 });
  });

  it('starts from the stored version', () => {
    const result = resolveConfig(migratedDefinition.config, 2, { name: 'hi' });
    expect(result).toEqual({ status: 'ok', config: { label: 'hi' }, migratedFrom: 2 });
  });

  it('does not mutate the stored object', () => {
    const stored: JsonObject = { title: 'hi' };
    resolveConfig(migratedDefinition.config, 1, stored);
    expect(stored).toEqual({ title: 'hi' });
  });

  it('reports a throwing migration', () => {
    const broken: WidgetConfigSpec<JsonObject> = {
      ...spec,
      version: 2,
      migrations: {
        1: () => {
          throw new Error('boom');
        },
      },
    };
    expect(resolveConfig(broken, 1, {})).toMatchObject({
      status: 'invalid',
      reason: 'migration-failed',
    });
  });

  it('reports a migration producing an invalid result', () => {
    const wrong: WidgetConfigSpec<{ label: string }> = {
      ...spec,
      version: 2,
      migrations: { 1: () => ({ label: 42 }) },
    };
    expect(resolveConfig(wrong, 1, {})).toMatchObject({
      status: 'invalid',
      reason: 'schema-mismatch',
    });
  });

  it('removes unknown keys', () => {
    expect(resolveConfig(spec, 1, { label: 'x', extra: 1 })).toMatchObject({
      config: { label: 'x' },
    });
  });

  it('does not pollute prototypes through __proto__', () => {
    const stored = JSON.parse('{"__proto__":{"polluted":true},"label":"x"}') as JsonObject;
    const result = resolveConfig(spec, 1, stored);
    expect(result.status).toBe('ok');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    if (result.status === 'ok') {
      expect(Object.hasOwn(result.config, '__proto__')).toBe(false);
    }
  });

  it('reports an asynchronous schema', () => {
    const asyncSchema: StandardSchemaV1<unknown, JsonObject> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: () => Promise.resolve({ value: {} }),
      },
    };
    const asyncSpec: WidgetConfigSpec<JsonObject> = { ...spec, schema: asyncSchema };
    expect(resolveConfig(asyncSpec, 1, {})).toMatchObject({
      status: 'invalid',
      reason: 'async-schema',
    });
  });

  it('formats issues as "path: message"', () => {
    const result = resolveConfig(spec, 1, { label: '' });
    expect(result.status === 'invalid' && result.issues[0]).toMatch(/^label: /);
  });
});

describe('serializeConfig', () => {
  const trimSpec: WidgetConfigSpec<{ label: string }> = {
    ...spec,
    schema: v.object({ label: v.pipe(v.string(), v.trim(), v.minLength(1)) }),
  };

  it('returns the transformed output with the current version', () => {
    expect(serializeConfig(trimSpec, { label: '  hi  ' })).toEqual({
      ok: true,
      version: 1,
      config: { label: 'hi' },
    });
  });

  it('rejects invalid values', () => {
    expect(serializeConfig(trimSpec, { label: '   ' })).toMatchObject({
      ok: false,
      reason: 'schema-mismatch',
    });
  });

  it('rejects values larger than the limit', () => {
    const result = serializeConfig(trimSpec, { label: 'a'.repeat(MAX_CONFIG_CHARS + 1) });
    expect(result).toMatchObject({ ok: false, reason: 'too-large' });
  });
});
