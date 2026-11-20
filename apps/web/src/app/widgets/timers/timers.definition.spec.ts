import * as v from 'valibot';
import { timersWidget } from './timers.definition';
import { timersConfigSchema } from './timers.config';

describe('timersWidget', () => {
  it('declares the contract of the spec (4.8)', () => {
    expect(timersWidget.type).toBe('timers');
    expect(timersWidget.icon).toBe('pi pi-stopwatch');
    expect(timersWidget.size).toEqual({
      min: { w: 3, h: 3 },
      default: { w: 4, h: 4 },
      max: { w: 6, h: 8 },
    });
    expect(timersWidget.permissions).toEqual(['notifications']);
    expect(timersWidget.config.version).toBe(1);
  });

  it('has an empty v1 config that validates', () => {
    const defaults = timersWidget.config.defaults();
    expect(defaults).toEqual({});
    expect(v.safeParse(timersConfigSchema, defaults).success).toBe(true);
  });

  it('loads its component lazily', async () => {
    const component = await timersWidget.loadComponent();
    expect(component.name).toMatch(/TimersComponent$/);
  });
});
