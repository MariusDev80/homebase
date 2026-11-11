import { Clock, IdGenerator } from '../clock';
import { DataError } from '../data-error';
import {
  NewTodo,
  NewTodoList,
  TODO_DESCRIPTION_MAX,
  TODO_RRULE_MAX,
  TODO_RRULE_MIN,
  TODO_TITLE_MAX,
  Todo,
  TodoChanges,
  TodoList,
  TodoSearchHit,
} from '../models';
import { TodoRepository } from '../repositories';
import { likeContains, validSearch } from '../search';
import { SqlExecutor } from '../sql-executor';
import { hasLocalDateShape } from '../time-formats';
import {
  TODO_COLUMNS,
  TODO_LIST_COLUMNS,
  TodoListRow,
  TodoRow,
  toTodo,
  toTodoList,
} from './row-mappers';

export const TODO_LIST_NAME_MAX = 80;
export const TODO_REORDER_MAX = 1000;

/** Exported for tests only (not re-exported by data/index.ts). */
export const REORDER_TODOS_SQL = `UPDATE todos
SET sort_order = j.pos, updated_at = $3
FROM (SELECT CAST(key AS INTEGER) AS pos, value AS id FROM json_each($1)) AS j
WHERE todos.id = j.id AND todos.list_id = $2 AND todos.sort_order <> j.pos`;

/* eslint-disable @typescript-eslint/consistent-type-definitions */
type TodoSearchRow = {
  id: string;
  title: string;
  list_id: string;
  widget_instance_id: string | null;
  completed_at: string | null;
};
/* eslint-enable @typescript-eslint/consistent-type-definitions */

const SEARCH_TODOS_SQL = `SELECT t.id, t.title, t.list_id, l.widget_instance_id, t.completed_at
FROM todos AS t JOIN todo_lists AS l ON l.id = t.list_id
WHERE t.title LIKE $1 ESCAPE '\\'
ORDER BY (t.completed_at IS NOT NULL), t.updated_at DESC, t.id
LIMIT $2`;

function validTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length < 1 || trimmed.length > TODO_TITLE_MAX) {
    throw new DataError('invalid_input', 'Todo title must be 1 to 500 characters');
  }
  return trimmed;
}

function validDueOn(dueOn: string | null): string | null {
  if (dueOn !== null && !hasLocalDateShape(dueOn)) {
    throw new DataError('invalid_input', 'Todo due date must be a YYYY-MM-DD date');
  }
  return dueOn;
}

function validDescription(description: string): string {
  if (description.length > TODO_DESCRIPTION_MAX) {
    throw new DataError(
      'invalid_input',
      `Todo description must be at most ${TODO_DESCRIPTION_MAX} characters`,
    );
  }
  return description;
}

function validRrule(rrule: string | null): string | null {
  if (
    rrule !== null &&
    (rrule.length < TODO_RRULE_MIN || rrule.length > TODO_RRULE_MAX || !rrule.startsWith('FREQ='))
  ) {
    throw new DataError(
      'invalid_input',
      'Todo rule must be 10 to 256 characters starting with FREQ=',
    );
  }
  return rrule;
}

export class SqliteTodoRepository implements TodoRepository {
  constructor(
    private readonly executor: SqlExecutor,
    private readonly clock: Clock,
    private readonly newId: IdGenerator,
  ) {}

  async getListForInstance(widgetInstanceId: string): Promise<TodoList | null> {
    const rows = await this.executor.select<TodoListRow>(
      `SELECT ${TODO_LIST_COLUMNS} FROM todo_lists WHERE widget_instance_id = $1`,
      [widgetInstanceId],
    );
    return rows.length === 0 ? null : toTodoList(rows[0]);
  }

  async createList(input: NewTodoList): Promise<TodoList> {
    const id = input.id ?? this.newId();
    const name = input.name.trim();
    if (name.length < 1 || name.length > TODO_LIST_NAME_MAX) {
      throw new DataError('invalid_input', 'Todo list name must be 1 to 80 characters');
    }
    await this.executor.execute(
      'INSERT INTO todo_lists (id, widget_instance_id, name, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)',
      [id, input.widgetInstanceId ?? null, name, this.clock.nowIso()],
    );
    const rows = await this.executor.select<TodoListRow>(
      `SELECT ${TODO_LIST_COLUMNS} FROM todo_lists WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) {
      throw new DataError('not_found', 'Todo list not found');
    }
    return toTodoList(rows[0]);
  }

  async listTodos(listId: string): Promise<Todo[]> {
    const rows = await this.executor.select<TodoRow>(
      `SELECT ${TODO_COLUMNS} FROM todos WHERE list_id = $1
       ORDER BY (completed_at IS NOT NULL),
                CASE WHEN completed_at IS NULL THEN sort_order END,
                completed_at DESC, created_at, id`,
      [listId],
    );
    return rows.map(toTodo);
  }

  async create(input: NewTodo): Promise<Todo> {
    const id = input.id ?? this.newId();
    const title = validTitle(input.title);
    const dueOn = validDueOn(input.dueOn ?? null);
    await this.executor.execute(
      `INSERT INTO todos (id, list_id, title, due_on, completed_at, sort_order, created_at, updated_at)
       SELECT $1, $2, $3, $4, NULL, COALESCE(MAX(sort_order) + 1, 0), $5, $5
       FROM todos WHERE list_id = $2`,
      [id, input.listId, title, dueOn, this.clock.nowIso()],
    );
    return this.mustGet(id);
  }

  async update(id: string, changes: TodoChanges): Promise<Todo> {
    const title = changes.title === undefined ? null : validTitle(changes.title);
    const setDue = changes.dueOn !== undefined;
    const dueOn = changes.dueOn === undefined ? null : validDueOn(changes.dueOn);
    const description =
      changes.description === undefined ? null : validDescription(changes.description);
    const setRrule = changes.rrule !== undefined;
    const rrule = changes.rrule === undefined ? null : validRrule(changes.rrule);
    if (rrule !== null && setDue && dueOn === null) {
      throw new DataError('invalid_input', 'A repetition rule needs a due date');
    }
    const important = changes.important === undefined ? null : changes.important ? 1 : 0;
    const result = await this.executor.execute(
      `UPDATE todos
       SET title = COALESCE($2, title),
           due_on = CASE WHEN $3 = 1 THEN $4 ELSE due_on END,
           description = COALESCE($5, description),
           rrule = CASE WHEN $6 = 1 THEN $7
                        WHEN $3 = 1 AND $4 IS NULL THEN NULL
                        ELSE rrule END,
           important = COALESCE($8, important),
           updated_at = $9
       WHERE id = $1`,
      [
        id,
        title,
        setDue ? 1 : 0,
        dueOn,
        description,
        setRrule ? 1 : 0,
        rrule,
        important,
        this.clock.nowIso(),
      ],
    );
    if (result.rowsAffected === 0) {
      throw new DataError('not_found', 'Todo not found');
    }
    return this.mustGet(id);
  }

  async shiftRepeatDue(id: string, fromDueOn: string, toDueOn: string): Promise<Todo> {
    validDueOn(fromDueOn);
    validDueOn(toDueOn);
    const result = await this.executor.execute(
      `UPDATE todos SET due_on = $3, updated_at = $4
       WHERE id = $1 AND due_on = $2 AND rrule IS NOT NULL AND completed_at IS NULL`,
      [id, fromDueOn, toDueOn, this.clock.nowIso()],
    );
    if (result.rowsAffected === 0) {
      const rows = await this.executor.select<{ one: number }>(
        'SELECT 1 AS one FROM todos WHERE id = $1',
        [id],
      );
      throw rows.length === 0
        ? new DataError('not_found', 'Todo not found')
        : new DataError('conflict', 'Todo changed since it was read');
    }
    return this.mustGet(id);
  }

  async setCompleted(id: string, completed: boolean): Promise<Todo> {
    const now = this.clock.nowIso();
    const result = await this.executor.execute(
      `UPDATE todos
       SET sort_order = CASE
             WHEN $2 = 0 AND completed_at IS NOT NULL THEN
               (SELECT COALESCE(MAX(t.sort_order) + 1, 0) FROM todos AS t WHERE t.list_id = todos.list_id)
             ELSE sort_order END,
           completed_at = CASE WHEN $2 = 1 THEN COALESCE(completed_at, $3) ELSE NULL END,
           updated_at = $3
       WHERE id = $1`,
      [id, completed ? 1 : 0, now],
    );
    if (result.rowsAffected === 0) {
      throw new DataError('not_found', 'Todo not found');
    }
    return this.mustGet(id);
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.executor.execute('DELETE FROM todos WHERE id = $1', [id]);
    return result.rowsAffected > 0;
  }

  async reorder(listId: string, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    if (ids.length > TODO_REORDER_MAX) {
      throw new DataError('invalid_input', 'Too many todo ids in reorder');
    }
    if (new Set(ids).size !== ids.length) {
      throw new DataError('invalid_input', 'Duplicate todo id in reorder');
    }
    await this.executor.execute(REORDER_TODOS_SQL, [
      JSON.stringify(ids),
      listId,
      this.clock.nowIso(),
    ]);
  }

  async clearCompleted(listId: string): Promise<number> {
    const result = await this.executor.execute(
      'DELETE FROM todos WHERE list_id = $1 AND completed_at IS NOT NULL',
      [listId],
    );
    return result.rowsAffected;
  }

  async search(query: string, limit: number): Promise<TodoSearchHit[]> {
    const term = validSearch(query, limit);
    const rows = await this.executor.select<TodoSearchRow>(SEARCH_TODOS_SQL, [
      likeContains(term),
      limit,
    ]);
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      listId: row.list_id,
      widgetInstanceId: row.widget_instance_id,
      completedAt: row.completed_at,
    }));
  }

  private async mustGet(id: string): Promise<Todo> {
    const rows = await this.executor.select<TodoRow>(
      `SELECT ${TODO_COLUMNS} FROM todos WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) {
      throw new DataError('not_found', 'Todo not found');
    }
    return toTodo(rows[0]);
  }
}
