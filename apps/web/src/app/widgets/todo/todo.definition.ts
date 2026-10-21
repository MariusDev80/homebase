import { defineWidget } from '../../core/widgets';
import { TODO_CONFIG_VERSION, TodoConfig, todoConfigSchema, todoDefaults } from './todo.config';

export const todoWidget = defineWidget<TodoConfig>({
  type: 'todo',
  titleKey: 'widgets.todo.title',
  descriptionKey: 'widgets.todo.description',
  icon: 'pi pi-check-square',
  loadComponent: () => import('./todo.component').then((m) => m.TodoComponent),
  size: { min: { w: 2, h: 2 }, default: { w: 4, h: 4 }, max: { w: 12, h: 12 } },
  config: {
    version: TODO_CONFIG_VERSION,
    schema: todoConfigSchema,
    defaults: todoDefaults,
    migrations: {},
  },
  permissions: [],
  // The list and its tasks are deleted with the widget (ADR-001 amendment: removeConfirmKey).
  removeConfirmKey: 'widgets.todo.removeConfirm',
});
