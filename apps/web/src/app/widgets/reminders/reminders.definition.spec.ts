import * as v from 'valibot';
import { remindersWidget } from './reminders.definition';
import { remindersConfigSchema } from './reminders.config';

describe('remindersWidget', () => {
  it('declares the contract of the spec (4.8)', () => {
    expect(remindersWidget.type).toBe('reminders');
    expect(remindersWidget.icon).toBe('pi pi-bell');
    expect(remindersWidget.size).toEqual({
      min: { w: 3, h: 3 },
      default: { w: 4, h: 5 },
      max: { w: 8, h: 8 },
    });
    expect(remindersWidget.permissions).toEqual(['notifications']);
    expect(remindersWidget.config.version).toBe(1);
  });

  it('has an empty v1 config that validates', () => {
    const defaults = remindersWidget.config.defaults();
    expect(defaults).toEqual({});
    expect(v.safeParse(remindersConfigSchema, defaults).success).toBe(true);
  });

  it('loads its component lazily', async () => {
    const component = await remindersWidget.loadComponent();
    expect(component.name).toMatch(/RemindersComponent$/);
  });
});
