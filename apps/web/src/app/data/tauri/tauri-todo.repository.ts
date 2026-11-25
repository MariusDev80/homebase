import type { IdGenerator } from '../clock';
import type { NewTodo, NewTodoList, Todo, TodoChanges, TodoList, TodoSearchHit } from '../models';
import type { TodoRepository } from '../repositories';
import { excerptAround, hbTrim } from '../search';
import type { LocalDateIso } from '../time-formats';
import { invokeCommand } from './invoke-command';
import { toTodo, toTodoList, type TodoHitWire, type TodoListWire, type TodoWire } from './wire';

/** Only the defined keys travel: absent = unchanged, JSON null = clear (dueOn, rrule). */
function wireChanges(changes: TodoChanges): Record<string, unknown> {
  const wire: Record<string, unknown> = {};
  if (changes.title !== undefined) wire['title'] = changes.title;
  if (changes.dueOn !== undefined) wire['dueOn'] = changes.dueOn;
  if (changes.description !== undefined) wire['description'] = changes.description;
  if (changes.rrule !== undefined) wire['rrule'] = changes.rrule;
  if (changes.important !== undefined) wire['important'] = changes.important;
  return wire;
}

/** TodoRepository over the `todo_*` Rust commands. */
export class TauriTodoRepository implements TodoRepository {
  constructor(private readonly newId: IdGenerator) {}

  async getListForInstance(widgetInstanceId: string): Promise<TodoList | null> {
    const row = await invokeCommand<TodoListWire | null>('todo_list_for_widget', {
      widgetInstanceId,
    });
    return row === null || row === undefined ? null : toTodoList(row);
  }

  async createList(input: NewTodoList): Promise<TodoList> {
    return toTodoList(
      await invokeCommand<TodoListWire>('todo_list_create', {
        input: {
          id: input.id ?? this.newId(),
          widgetInstanceId: input.widgetInstanceId ?? null,
          name: input.name,
        },
      }),
    );
  }

  async listTodos(listId: string): Promise<Todo[]> {
    const rows = await invokeCommand<TodoWire[]>('todo_list_items', { listId });
    return rows.map(toTodo);
  }

  async create(input: NewTodo): Promise<Todo> {
    return toTodo(
      await invokeCommand<TodoWire>('todo_create', {
        input: {
          id: input.id ?? this.newId(),
          listId: input.listId,
          title: input.title,
          dueOn: input.dueOn ?? null,
        },
      }),
    );
  }

  async update(id: string, changes: TodoChanges): Promise<Todo> {
    return toTodo(
      await invokeCommand<TodoWire>('todo_update', { id, changes: wireChanges(changes) }),
    );
  }

  async shiftRepeatDue(id: string, fromDueOn: string, toDueOn: string): Promise<Todo> {
    return toTodo(
      await invokeCommand<TodoWire>('todo_shift_repeat_due', { id, fromDueOn, toDueOn }),
    );
  }

  async setCompleted(id: string, completed: boolean): Promise<Todo> {
    return toTodo(await invokeCommand<TodoWire>('todo_set_completed', { id, completed }));
  }

  remove(id: string): Promise<boolean> {
    return invokeCommand<boolean>('todo_delete', { id });
  }

  async listDue(
    range: { readonly fromOn: LocalDateIso; readonly toOn: LocalDateIso },
    limit: number,
  ): Promise<Todo[]> {
    const rows = await invokeCommand<TodoWire[]>('todo_due', {
      fromOn: range.fromOn,
      toOn: range.toOn,
      limit,
    });
    return rows.map(toTodo);
  }

  async listOverdueBefore(beforeOn: LocalDateIso, limit: number): Promise<Todo[]> {
    const rows = await invokeCommand<TodoWire[]>('todo_overdue', { beforeOn, limit });
    return rows.map(toTodo);
  }

  async listRepeatingDueBy(toOn: LocalDateIso, limit: number): Promise<Todo[]> {
    const rows = await invokeCommand<TodoWire[]>('todo_repeating_due', { toOn, limit });
    return rows.map(toTodo);
  }

  async reorder(listId: string, ids: readonly string[]): Promise<void> {
    await invokeCommand<void>('todo_reorder', { listId, ids: [...ids] });
  }

  clearCompleted(listId: string): Promise<number> {
    return invokeCommand<number>('todo_clear_completed', { listId });
  }

  async search(query: string, limit: number): Promise<TodoSearchHit[]> {
    const rows = await invokeCommand<TodoHitWire[]>('todo_search', { query, limit });
    const term = hbTrim(query);
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      listId: r.listId,
      widgetInstanceId: r.widgetInstanceId,
      completedAt: r.completedAt,
      excerpt: excerptAround(r.description, term),
    }));
  }
}
