import { DataError } from '../../data';
import type {
  Clock,
  NewTodo,
  NewTodoList,
  Todo,
  TodoChanges,
  TodoList,
  TodoRepository,
  TodoSearchHit,
} from '../../data';

/** In-memory TodoRepository with deterministic ids (specs only). */
export class FakeTodoRepository implements TodoRepository {
  readonly lists = new Map<string, TodoList>();
  items: Todo[] = [];
  readonly calls: string[] = [];
  private counter = 0;
  private nextFailure: unknown;

  constructor(private readonly clock: Clock) {}

  /** The next call rejects with `error`. */
  failNext(error: unknown): void {
    this.nextFailure = error;
  }

  seedList(widgetInstanceId: string | null, name = 'Tâches'): TodoList {
    const list: TodoList = {
      id: `list-${++this.counter}`,
      widgetInstanceId,
      name,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    this.lists.set(list.id, list);
    return list;
  }

  seed(listId: string, title: string, over: Partial<Todo> = {}): Todo {
    const todo = this.build(listId, title, over.dueOn ?? null);
    const full = { ...todo, ...over };
    this.items.push(full);
    return full;
  }

  /** Titles in display order for one list. */
  async titles(listId: string): Promise<string[]> {
    return (await this.listTodos(listId)).map((t) => t.title);
  }

  async getListForInstance(widgetInstanceId: string): Promise<TodoList | null> {
    this.record(`getListForInstance:${widgetInstanceId}`);
    return [...this.lists.values()].find((l) => l.widgetInstanceId === widgetInstanceId) ?? null;
  }

  async createList(input: NewTodoList): Promise<TodoList> {
    this.record('createList');
    return this.seedList(input.widgetInstanceId ?? null, input.name.trim());
  }

  async listTodos(listId: string): Promise<Todo[]> {
    this.record(`listTodos:${listId}`);
    const inList = this.items.filter((t) => t.listId === listId);
    const active = inList
      .filter((t) => t.completedAt === null)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const done = inList
      .filter((t) => t.completedAt !== null)
      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
    return [...active, ...done];
  }

  async create(input: NewTodo): Promise<Todo> {
    this.record('create');
    const title = input.title.trim();
    if (title.length < 1 || title.length > 500) {
      throw new DataError('invalid_input', 'Todo title must be 1 to 500 characters');
    }
    const todo = this.build(input.listId, title, input.dueOn ?? null);
    this.items.push(todo);
    return todo;
  }

  async update(id: string, changes: TodoChanges): Promise<Todo> {
    this.record(`update:${id}`);
    return this.replace(id, (t) => ({
      ...t,
      title: changes.title === undefined ? t.title : changes.title.trim(),
      dueOn: changes.dueOn === undefined ? t.dueOn : changes.dueOn,
    }));
  }

  async setCompleted(id: string, completed: boolean): Promise<Todo> {
    this.record(`setCompleted:${id}:${completed}`);
    const max = Math.max(-1, ...this.items.map((t) => t.sortOrder));
    return this.replace(id, (t) => ({
      ...t,
      sortOrder: !completed && t.completedAt !== null ? max + 1 : t.sortOrder,
      completedAt: completed ? (t.completedAt ?? this.clock.nowIso()) : null,
    }));
  }

  async remove(id: string): Promise<boolean> {
    this.record(`remove:${id}`);
    const before = this.items.length;
    this.items = this.items.filter((t) => t.id !== id);
    return this.items.length < before;
  }

  async reorder(listId: string, ids: readonly string[]): Promise<void> {
    this.record(`reorder:${ids.join(',')}`);
    if (new Set(ids).size !== ids.length) {
      throw new DataError('invalid_input', 'Duplicate todo id in reorder');
    }
    this.items = this.items.map((t) => {
      const position = ids.indexOf(t.id);
      return t.listId !== listId || position < 0 ? t : { ...t, sortOrder: position };
    });
  }

  async clearCompleted(listId: string): Promise<number> {
    this.record('clearCompleted');
    const before = this.items.length;
    this.items = this.items.filter((t) => !(t.listId === listId && t.completedAt !== null));
    return before - this.items.length;
  }

  async search(query: string, limit: number): Promise<TodoSearchHit[]> {
    this.record(`search:${query}`);
    const q = query.trim().toLowerCase();
    return this.items
      .filter((t) => t.title.toLowerCase().includes(q))
      .slice(0, limit)
      .map((t) => ({
        id: t.id,
        title: t.title,
        listId: t.listId,
        widgetInstanceId: this.lists.get(t.listId)?.widgetInstanceId ?? null,
        completedAt: t.completedAt,
      }));
  }

  private replace(id: string, change: (todo: Todo) => Todo): Todo {
    const index = this.items.findIndex((t) => t.id === id);
    if (index < 0) {
      throw new DataError('not_found', 'Todo not found');
    }
    const next = change(this.items[index]);
    this.items[index] = next;
    return next;
  }

  private build(listId: string, title: string, dueOn: string | null): Todo {
    this.counter++;
    return {
      id: `todo-${this.counter}`,
      listId,
      title,
      dueOn,
      completedAt: null,
      sortOrder: this.counter,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
  }

  private record(call: string): void {
    this.calls.push(call);
    if (this.nextFailure !== undefined) {
      const error = this.nextFailure;
      this.nextFailure = undefined;
      throw error;
    }
  }
}
