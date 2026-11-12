import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { TimeDisplay, Today, daysBetween, isValidLocalDate } from '../../core/time';
import { injectWidgetContext } from '../../core/widgets';
import { DataError, TODO_REPOSITORY } from '../../data';
import type { Todo, TodoList } from '../../data';
import type { TodoConfig } from './todo.config';

const TITLE_MAX = 500;

type Status = 'loading' | 'ready' | 'missing' | 'error';

interface EditState {
  readonly id: string;
  readonly title: string;
}

interface Row {
  readonly todo: Todo;
  readonly done: boolean;
  readonly first: boolean;
  readonly last: boolean;
}

export interface DueInfo {
  readonly kind: 'overdue' | 'today' | 'tomorrow' | 'date';
  /** Days late, for the 'overdue' kind (>= 1). */
  readonly daysLate: number;
  /** Short French date, for the 'date' kind and for completed tasks. */
  readonly date: string;
}

@Component({
  selector: 'app-todo-widget',
  imports: [TranslocoPipe],
  templateUrl: './todo.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full min-h-0 flex-col gap-2' },
})
export class TodoComponent {
  protected readonly ctx = injectWidgetContext<TodoConfig>();
  private readonly repository = inject(TODO_REPOSITORY);
  private readonly today = inject(Today);
  private readonly display = inject(TimeDisplay);
  private readonly transloco = inject(TranslocoService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly newInput = viewChild<ElementRef<HTMLInputElement>>('newInput');
  protected readonly status = signal<Status>('loading');
  protected readonly todos = signal<readonly Todo[]>([]);
  protected readonly newTitle = signal('');
  protected readonly editing = signal<EditState | null>(null);
  protected readonly editError = signal(false);
  protected readonly confirmingId = signal<string | null>(null);
  protected readonly confirmingClear = signal(false);
  protected readonly actionError = signal(false);
  /** True while a write is in flight: a second add/move/delete/toggle is ignored. */
  protected readonly busy = signal(false);

  protected readonly showCompleted = computed(() => this.ctx.config().showCompleted);
  protected readonly remaining = computed(
    () => this.todos().filter((t) => t.completedAt === null).length,
  );
  protected readonly completedCount = computed(() => this.todos().length - this.remaining());
  protected readonly rows = computed<readonly Row[]>(() => {
    const all = this.todos();
    const active = all.filter((t) => t.completedAt === null);
    const shown = this.showCompleted() ? all : active;
    return shown.map((todo) => ({
      todo,
      done: todo.completedAt !== null,
      first: todo.id === active[0]?.id,
      last: todo.id === active[active.length - 1]?.id,
    }));
  });

  private listId: string | null = null;
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    void this.load();
  }

  protected async load(showLoading = true): Promise<void> {
    if (showLoading) this.status.set('loading');
    try {
      const list = await this.repository.getListForInstance(this.ctx.instanceId);
      if (this.destroyed) return;
      if (list === null) {
        if (this.ctx.config().listId === null) {
          await this.createAndAttach();
        } else {
          this.listId = null;
          this.status.set('missing');
        }
        return;
      }
      // Adopts a list left behind by a failed config write (the instance owns at most one).
      // Non-fatal: the list stays usable and the next load retries.
      if (this.ctx.config().listId !== list.id) {
        try {
          await this.ctx.updateConfig({ ...this.ctx.config(), listId: list.id });
        } catch {
          // Ignored on purpose.
        }
      }
      this.listId = list.id;
      await this.refresh();
      if (!this.destroyed) this.status.set('ready');
    } catch {
      if (!this.destroyed) this.status.set('error');
    }
  }

  protected async createNew(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.status.set('loading');
    try {
      await this.createAndAttach();
    } catch {
      if (!this.destroyed) this.status.set('error');
    } finally {
      this.busy.set(false);
    }
  }

  /** Due date as shown: relative to today's date, which moves at local midnight. */
  protected dueInfo(todo: Todo): DueInfo | null {
    if (todo.dueOn === null) return null;
    const date = this.display.formatLocalDate(todo.dueOn, 'short');
    if (todo.completedAt !== null) return { kind: 'date', date, daysLate: 0 };
    const days = daysBetween(this.today.date(), todo.dueOn);
    if (days < 0) return { kind: 'overdue', date, daysLate: -days };
    if (days === 0) return { kind: 'today', date, daysLate: 0 };
    if (days === 1) return { kind: 'tomorrow', date, daysLate: 0 };
    return { kind: 'date', date, daysLate: 0 };
  }

  protected onNewInput(event: Event): void {
    this.newTitle.set((event.target as HTMLInputElement).value);
  }

  protected async add(event?: Event): Promise<void> {
    if ((event as KeyboardEvent | undefined)?.isComposing) return;
    const listId = this.listId;
    const submitted = this.newTitle();
    const title = submitted.trim();
    if (listId === null || title.length === 0 || this.busy()) return;
    this.busy.set(true);
    try {
      await this.repository.create({ listId, title });
      // Only clear what was submitted: text typed meanwhile is kept.
      if (this.newTitle() === submitted) {
        this.newTitle.set('');
        // Uncontrolled field: clear the DOM value too (it may not have been re-rendered since typing).
        const field = this.newInput();
        if (field) field.nativeElement.value = '';
      }
      this.actionError.set(false);
      await this.refresh();
      this.focus('[data-testid="todo-new"]');
    } catch {
      this.actionError.set(true);
    } finally {
      this.busy.set(false);
    }
  }

  protected async toggle(todo: Todo, event: Event): Promise<void> {
    const box = event.target as HTMLInputElement;
    const completed = box.checked;
    if (this.busy()) {
      box.checked = !completed;
      return;
    }
    this.busy.set(true);
    try {
      await this.repository.setCompleted(todo.id, completed);
      this.actionError.set(false);
      await this.refresh();
      const stillShown = this.rows().some((r) => r.todo.id === todo.id);
      this.focus(stillShown ? this.inRow(todo.id, 'todo-check') : '[data-testid="todo-new"]');
    } catch {
      box.checked = !completed;
      this.actionError.set(true);
    } finally {
      this.busy.set(false);
    }
  }

  protected startEdit(todo: Todo): void {
    if (todo.completedAt !== null) return;
    this.confirmingId.set(null);
    this.editError.set(false);
    this.editing.set({ id: todo.id, title: todo.title });
    this.focus('[data-testid="todo-edit-input"]');
  }

  protected onEditInput(event: Event): void {
    const title = (event.target as HTMLInputElement).value;
    this.editing.update((state) => (state ? { ...state, title } : state));
  }

  protected cancelEdit(): void {
    const id = this.editing()?.id;
    this.editing.set(null);
    this.editError.set(false);
    if (id) this.focus(this.inRow(id, 'todo-edit'));
  }

  protected async commitEdit(event?: Event): Promise<void> {
    if ((event as KeyboardEvent | undefined)?.isComposing) return;
    const state = this.editing();
    if (!state || this.busy()) return;
    const title = state.title.trim();
    if (title.length < 1 || title.length > TITLE_MAX) {
      this.editError.set(true);
      return;
    }
    const current = this.todos().find((t) => t.id === state.id);
    if (current && current.title === title) {
      this.cancelEdit();
      return;
    }
    this.busy.set(true);
    try {
      await this.repository.update(state.id, { title });
      this.editing.set(null);
      this.editError.set(false);
      this.actionError.set(false);
      await this.refresh();
      this.focus(this.inRow(state.id, 'todo-edit'));
    } catch {
      this.actionError.set(true);
    } finally {
      this.busy.set(false);
    }
  }

  protected async onDueChange(todo: Todo, event: Event): Promise<void> {
    // A date input fires `change` for every complete intermediate date while the year is typed
    // (0002-..., 0020-..., 0202-...). Only a valid in-range date or a real clearing is committed;
    // anything else is left in the field untouched and the stored value is restored on blur.
    const input = event.target as HTMLInputElement;
    const value = input.value;
    if (value === '' && input.validity.badInput) return;
    if (value !== '' && !(this.inDueRange(value) && isValidLocalDate(value))) return;
    if (this.busy()) {
      // Not saved: say so and put the stored value back rather than dropping it silently.
      input.value = todo.dueOn ?? '';
      this.actionError.set(true);
      return;
    }
    await this.setDue(todo, value === '' ? null : value);
  }

  protected onDueBlur(todo: Todo, event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.value !== (todo.dueOn ?? '') || input.validity.badInput) {
      input.value = todo.dueOn ?? '';
    }
  }

  private inDueRange(value: string): boolean {
    return value >= '1900-01-01' && value <= '2199-12-31';
  }

  protected async clearDue(todo: Todo): Promise<void> {
    await this.setDue(todo, null);
    this.focus(this.inRow(todo.id, 'todo-due-input'));
  }

  protected askRemove(todo: Todo): void {
    this.editing.set(null);
    this.confirmingClear.set(false);
    this.confirmingId.set(todo.id);
    this.focus(this.inRow(todo.id, 'todo-confirm-no'));
  }

  protected cancelRemove(todo: Todo): void {
    this.confirmingId.set(null);
    this.focus(this.inRow(todo.id, 'todo-remove'));
  }

  protected async confirmRemove(todo: Todo): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    const index = this.rows().findIndex((r) => r.todo.id === todo.id);
    this.confirmingId.set(null);
    try {
      await this.repository.remove(todo.id);
      this.actionError.set(false);
      await this.refresh();
      // The delete button of the row that took its place (or the previous one), else the field.
      const rows = this.rows();
      const target = rows[Math.min(index, rows.length - 1)];
      this.focus(target ? this.inRow(target.todo.id, 'todo-remove') : '[data-testid="todo-new"]');
    } catch {
      this.actionError.set(true);
    } finally {
      this.busy.set(false);
    }
  }

  protected async move(todo: Todo, offset: -1 | 1): Promise<void> {
    const listId = this.listId;
    if (listId === null || this.busy()) return;
    const ids = this.todos()
      .filter((t) => t.completedAt === null)
      .map((t) => t.id);
    const from = ids.indexOf(todo.id);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    this.busy.set(true);
    try {
      await this.repository.reorder(listId, ids);
      this.actionError.set(false);
      await this.refresh();
      // Keep the focus on the same direction button, unless it is now disabled (list end).
      const atEnd = offset < 0 ? to === 0 : to === ids.length - 1;
      const same = offset < 0 ? 'todo-up' : 'todo-down';
      const opposite = offset < 0 ? 'todo-down' : 'todo-up';
      this.focus(this.inRow(todo.id, atEnd ? opposite : same));
    } catch {
      this.actionError.set(true);
    } finally {
      this.busy.set(false);
    }
  }

  protected async toggleShowCompleted(event: Event): Promise<void> {
    const box = event.target as HTMLInputElement;
    const showCompleted = box.checked;
    try {
      await this.ctx.updateConfig({ ...this.ctx.config(), showCompleted });
      this.actionError.set(false);
    } catch {
      box.checked = !showCompleted;
      this.actionError.set(true);
    }
  }

  protected askClear(): void {
    this.confirmingId.set(null);
    this.confirmingClear.set(true);
    this.focus('[data-testid="todo-clear-no"]');
  }

  protected cancelClear(): void {
    this.confirmingClear.set(false);
    this.focus('[data-testid="todo-clear"]');
  }

  protected async confirmClear(): Promise<void> {
    const listId = this.listId;
    if (listId === null || this.busy()) return;
    this.busy.set(true);
    this.confirmingClear.set(false);
    try {
      await this.repository.clearCompleted(listId);
      this.actionError.set(false);
      await this.refresh();
      this.focus('[data-testid="todo-new"]');
    } catch {
      this.actionError.set(true);
    } finally {
      this.busy.set(false);
    }
  }

  private async setDue(todo: Todo, dueOn: string | null): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.repository.update(todo.id, { dueOn });
      this.actionError.set(false);
      await this.refresh();
    } catch {
      this.actionError.set(true);
    } finally {
      this.busy.set(false);
    }
  }

  private async createAndAttach(): Promise<void> {
    let list: TodoList;
    try {
      list = await this.repository.createList({
        widgetInstanceId: this.ctx.instanceId,
        name: this.transloco.translate('widgets.todo.defaultListName'),
      });
    } catch (error) {
      // Another creation won the race (unique index): adopt its list.
      if (!(error instanceof DataError) || error.kind !== 'conflict') throw error;
      const existing = await this.repository.getListForInstance(this.ctx.instanceId);
      if (existing === null) throw error;
      list = existing;
    }
    // If this write fails the list stays attached to the instance: the next load adopts it.
    await this.ctx.updateConfig({ ...this.ctx.config(), listId: list.id });
    if (this.destroyed) return;
    this.listId = list.id;
    await this.refresh();
    if (!this.destroyed) this.status.set('ready');
  }

  private async refresh(): Promise<void> {
    if (this.listId === null) return;
    const todos = await this.repository.listTodos(this.listId);
    if (!this.destroyed) this.todos.set(todos);
  }

  private inRow(id: string, testId: string): string {
    return `[data-todo-id="${id}"] [data-testid="${testId}"]`;
  }

  /** Focuses the element once the next render has put it in the DOM. */
  private focus(selector: string): void {
    afterNextRender(
      () => {
        this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
      },
      { injector: this.injector },
    );
  }
}
