import * as v from 'valibot';

/**
 * Preferences and references only: the list and its tasks live in the `todo_lists` and
 * `todos` tables, owned by the widget instance.
 */
export const todoConfigSchema = v.object({
  listId: v.nullable(v.pipe(v.string(), v.minLength(1), v.maxLength(64))),
  showCompleted: v.boolean(),
});
export type TodoConfig = v.InferOutput<typeof todoConfigSchema>;
export const TODO_CONFIG_VERSION = 1;
export const todoDefaults = (): TodoConfig => ({ listId: null, showCompleted: true });
