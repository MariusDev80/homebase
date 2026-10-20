import { TestBed } from '@angular/core/testing';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import * as v from 'valibot';
import type { JsonObject } from '../../data';
import { fixtureDefinition } from '../testing/fixture-definitions';
import type { WidgetDefinition, WidgetPermissionKind } from './widget-definition';
import {
  WidgetRegistry,
  WidgetRegistryError,
  provideWidget,
  validateDefinition,
} from './widget-registry';

function registryWith(...definitions: WidgetDefinition[]): WidgetRegistry {
  TestBed.configureTestingModule({ providers: definitions.map((d) => provideWidget(d)) });
  return TestBed.inject(WidgetRegistry);
}

function problemsOf(overrides: Partial<WidgetDefinition<{ label: string }>>): readonly string[] {
  return validateDefinition(fixtureDefinition(overrides) as WidgetDefinition);
}

describe('validateDefinition', () => {
  it('accepts a valid definition', () => {
    expect(problemsOf({})).toEqual([]);
  });

  it.each(['Hello', 'a', 'hello_world', 'a'.repeat(33)])('rejects type %s', (type) => {
    expect(problemsOf({ type }).join()).toContain('type must match');
  });

  it.each(['<svg>', 'fa fa-x'])('rejects icon %s', (icon) => {
    expect(problemsOf({ icon }).join()).toContain('icon must match');
  });

  it('rejects empty keys', () => {
    expect(problemsOf({ titleKey: '', descriptionKey: '' })).toHaveLength(2);
  });

  it('rejects min > default', () => {
    const size = { min: { w: 3, h: 1 }, default: { w: 2, h: 2 }, max: { w: 4, h: 4 } };
    expect(problemsOf({ size }).join()).toContain('size.w');
  });

  it.each([13, 0, 1.5])('rejects max.w %s', (w) => {
    const size = { min: { w: 1, h: 1 }, default: { w: 1, h: 1 }, max: { w, h: 4 } };
    expect(problemsOf({ size }).length).toBeGreaterThan(0);
  });

  it('rejects max.h above the grid rows', () => {
    const size = { min: { w: 1, h: 1 }, default: { w: 1, h: 1 }, max: { w: 4, h: 25 } };
    expect(problemsOf({ size }).join()).toContain('size.max.h');
  });

  it('rejects a missing migration', () => {
    const config = {
      ...fixtureDefinition().config,
      version: 3,
      migrations: { 1: (p: unknown) => p },
    };
    expect(problemsOf({ config }).join()).toContain('missing key 2');
  });

  it('rejects an extra migration key', () => {
    const config = { ...fixtureDefinition().config, migrations: { 1: (p: unknown) => p } };
    expect(problemsOf({ config }).join()).toContain('unexpected key 1');
  });

  it('rejects invalid defaults', () => {
    const config = { ...fixtureDefinition().config, defaults: () => ({ label: '' }) };
    expect(problemsOf({ config }).join()).toContain('defaults() is invalid');
  });

  describe('non-JSON defaults', () => {
    const lax = v.object({ value: v.unknown() });
    const withDefaults = (value: unknown): readonly string[] =>
      validateDefinition({
        ...fixtureDefinition(),
        config: {
          version: 1,
          schema: lax as unknown as StandardSchemaV1<unknown, JsonObject>,
          defaults: () => ({ value }) as JsonObject,
          migrations: {},
        },
      } as WidgetDefinition);

    it.each([
      ['NaN', NaN],
      ['undefined', undefined],
      ['Date', new Date(0)],
    ])('rejects %s', (_name, value) => {
      expect(withDefaults(value).join()).toContain('JSON round trip');
    });

    it('accepts plain JSON', () => {
      expect(withDefaults('ok')).toEqual([]);
    });
  });

  it('rejects an asynchronous schema', () => {
    const schema: StandardSchemaV1<unknown, { label: string }> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: () => Promise.resolve({ value: { label: 'x' } }),
      },
    };
    const config = { ...fixtureDefinition().config, schema };
    expect(problemsOf({ config }).join()).toContain('synchronous');
  });

  it('rejects maxInstances 0', () => {
    expect(problemsOf({ maxInstances: 0 }).join()).toContain('maxInstances');
  });

  it('rejects duplicate and unknown permissions', () => {
    const problems = problemsOf({
      permissions: ['network', 'network', 'bogus' as unknown as WidgetPermissionKind],
    });
    expect(problems.join()).toContain('duplicate permission');
    expect(problems.join()).toContain('unknown permission');
  });
});

describe('WidgetRegistry', () => {
  it('is valid when empty', () => {
    expect(registryWith().list()).toEqual([]);
  });

  it('keeps registration order and resolves by type', () => {
    const a = fixtureDefinition({ type: 'aaa' });
    const b = fixtureDefinition({ type: 'bbb' });
    const registry = registryWith(a as WidgetDefinition, b as WidgetDefinition);
    expect(registry.list().map((d) => d.type)).toEqual(['aaa', 'bbb']);
    expect(registry.get('bbb')).toBe(b);
  });

  it('returns undefined for an unknown type', () => {
    expect(registryWith().get('nope')).toBeUndefined();
  });

  it('rejects duplicate types', () => {
    expect(() =>
      registryWith(
        fixtureDefinition() as WidgetDefinition,
        fixtureDefinition() as WidgetDefinition,
      ),
    ).toThrow(/duplicate widget type/);
  });

  it('aggregates every problem in a single error, prefixed by type', () => {
    try {
      registryWith(
        fixtureDefinition({ type: 'bad-one', icon: 'x', maxInstances: 0 }) as WidgetDefinition,
        fixtureDefinition({ type: 'bad-two', titleKey: '' }) as WidgetDefinition,
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(WidgetRegistryError);
      const problems = (error as WidgetRegistryError).problems;
      expect(problems).toHaveLength(3);
      expect(problems.every((p) => p.startsWith('bad-'))).toBe(true);
    }
  });
});
