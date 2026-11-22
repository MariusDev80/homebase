import * as v from 'valibot';
import { habitsConfigSchema } from './habits.config';
import { habitsWidget } from './habits.definition';

describe('habitsWidget', () => {
  it('declares the contract of the spec (4.7)', () => {
    expect(habitsWidget.type).toBe('habits');
    expect(habitsWidget.icon).toBe('pi pi-check-square');
    expect(habitsWidget.size).toEqual({
      min: { w: 3, h: 3 },
      default: { w: 4, h: 4 },
      max: { w: 8, h: 8 },
    });
    expect(habitsWidget.permissions).toEqual(['notifications']);
    expect(habitsWidget.config.version).toBe(1);
  });

  it('has an empty v1 config that validates', () => {
    const defaults = habitsWidget.config.defaults();
    expect(defaults).toEqual({});
    expect(v.safeParse(habitsConfigSchema, defaults).success).toBe(true);
  });

  it('loads its component lazily', async () => {
    const component = await habitsWidget.loadComponent();
    expect(component.name).toMatch(/HabitsComponent$/);
  });
});

describe('habitsWidget calendar source (CA-CO3-5)', () => {
  it('exposes its calendar source through a dynamic import', async () => {
    expect(habitsWidget.loadCalendarSource).toBeDefined();
    const source = await habitsWidget.loadCalendarSource?.();
    expect(source?.name).toMatch(/HabitsCalendarSource$/);
  });
});
