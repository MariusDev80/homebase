import { Component } from '@angular/core';
import * as v from 'valibot';
import { injectWidgetContext } from '../widgets/widget-context';
import { defineWidget } from '../widgets/widget-definition';
import type { WidgetDefinition } from '../widgets/widget-definition';

/** Renders the label of its configuration, to prove the widget context is wired. */
@Component({
  selector: 'app-fixture-widget',
  template: '<span data-testid="fixture-label">{{ ctx.config().label }}</span>',
})
export class FixtureWidgetComponent {
  protected readonly ctx = injectWidgetContext<{ label: string }>();
}

const labelSchema = v.object({ label: v.pipe(v.string(), v.minLength(1)) });
type LabelConfig = v.InferOutput<typeof labelSchema>;

/** A valid, minimal definition; override fields per test. */
export function fixtureDefinition(
  overrides: Partial<WidgetDefinition<LabelConfig>> = {},
): WidgetDefinition<LabelConfig> {
  return defineWidget<LabelConfig>({
    type: 'fixture',
    titleKey: 'widgets.hello.title',
    descriptionKey: 'widgets.hello.description',
    icon: 'pi pi-star',
    loadComponent: () => Promise.resolve(FixtureWidgetComponent),
    size: { min: { w: 1, h: 1 }, default: { w: 2, h: 2 }, max: { w: 4, h: 4 } },
    config: {
      version: 1,
      schema: labelSchema,
      defaults: () => ({ label: 'default' }),
      migrations: {},
    },
    permissions: [],
    ...overrides,
  });
}

/** v1 `{ title }` -> v2 `{ name }` -> v3 `{ label }`. */
const v3Schema = v.object({ label: v.pipe(v.string(), v.minLength(1)) });
export type MigratedConfig = v.InferOutput<typeof v3Schema>;

export const migratedDefinition = defineWidget<MigratedConfig>({
  type: 'migrated',
  titleKey: 'widgets.hello.title',
  descriptionKey: 'widgets.hello.description',
  icon: 'pi pi-cog',
  loadComponent: () => Promise.resolve(FixtureWidgetComponent),
  size: { min: { w: 1, h: 1 }, default: { w: 2, h: 2 }, max: { w: 4, h: 4 } },
  config: {
    version: 3,
    schema: v3Schema,
    defaults: () => ({ label: 'default' }),
    migrations: {
      1: (previous) => ({ name: (previous as { title: string }).title }),
      2: (previous) => ({ label: (previous as { name: string }).name }),
    },
  },
  permissions: [],
});
