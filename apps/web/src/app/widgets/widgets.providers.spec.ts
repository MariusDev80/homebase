import { reflectComponentType } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { WidgetRegistry } from '../core/widgets';
import { provideAllWidgets } from './widgets.providers';

const SECRET_KEY = /(secret|token|passw(or)?d|api[-_.]?key|credential)/i;

function secretKeys(value: unknown, path = ''): string[] {
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const here = path ? `${path}.${key}` : key;
    const own = SECRET_KEY.test(key) && !key.endsWith('Ref') ? [here] : [];
    return [...own, ...secretKeys(child, here)];
  });
}

describe('provideAllWidgets', () => {
  let registry: WidgetRegistry;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: provideAllWidgets() });
    registry = TestBed.inject(WidgetRegistry);
  });

  it('builds a valid registry', () => {
    expect(registry.list().length).toBeGreaterThan(0);
    expect(registry.get('hello')).toBeDefined();
  });

  it('lazy-loads a component for every definition', async () => {
    for (const definition of registry.list()) {
      const component = await definition.loadComponent();
      expect(reflectComponentType(component)).not.toBeNull();
    }
  });

  it('has no secret-like key in any defaults()', () => {
    for (const definition of registry.list()) {
      expect(secretKeys(definition.config.defaults())).toEqual([]);
    }
  });
});
