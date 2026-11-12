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
import { TimeDisplay, Today } from '../../core/time';
import { injectWidgetContext } from '../../core/widgets';
import { DataError, TODO_REPOSITORY } from '../../data';
import type { LocalDateIso, Todo, TodoList } from '../../data';
import { TodoDetailComponent } from './todo-detail.component';
import { dueLabel } from './todo-due';
import type { DueLabel } from './todo-due';
import { checkAction, ruleFormOf, ruleSummary } from './todo-repeat';
import type { TodoConfig } from './todo.config';

type Status = 'loading' | 'ready' | 'missing' | 'error';

interface Row {
  readonly todo: Todo;
  readonly done: boolean;
  readonly first: boolean;
  readonly last: boolean;
  readonly due: DueLabel | null;
  readonly hasDescription: boolean;
  /** Summary of the repetition rule (key and params), null when the todo does not repeat. */
  readonly repeat: { readonly key: string; readonly params: Record<string, number> } | null;
}

/** Last advance of a repeating todo, shown with an undo button until the next action. */
interface Advanced {
  readonly id: string;
  readonly title: string;
  readonly from: LocalDateIso;
  readonly to: LocalDateIso;
  /** Formatted new due date. */
  readonly date: string;
}

@Component({
  selector: 'app-todo-widget',
  imports: [TranslocoPipe, TodoDetailComponent],
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
  /** Todo whose detail sheet is open (snapshot taken at opening), else null. */
  protected readonly detail = signal<Todo | null>(null);
  /** The todo opened in the sheet was deleted elsewhere. */
  protected readonly gone = signal(false);
  /** Message of the last check of a repeating todo (null = none); the live region is permanent. */
  protected readonly advanced = signal<Advanced | null>(null);
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
    // Reads the date signal: labels follow local midnight.
    const today = this.today.date();
    return shown.map((todo) => ({
      todo,
      done: todo.completedAt !== null,
      first: todo.id === active[0]?.id,
      last: todo.id === active[active.length - 1]?.id,
      due: dueLabel(todo, today, (date, style) => this.display.formatLocalDate(date, style)),
      hasDescription: todo.description.trim() !== '',
      repeat: todo.rrule === null ? null : ruleSummary(ruleFormOf(todo.rrule)),
    }));
  });

  private listId: string | null = null;
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    void this.load();
  }

  protected async load(showLoading = true): Promise<void> {
    this.advanced.set(null);
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

  protected onNewInput(event: Event): void {
    this.newTitle.set((event.target as HTMLInputElement).value);
  }

  protected async add(event?: Event): Promise<void> {
    if ((event as KeyboardEvent | undefined)?.isComposing) return;
    const listId = this.listId;
    const submitted = this.newTitle();
    const title = submitted.trim();
    if (listId === null || title.length === 0 || this.busy()) return;
    this.gone.set(false);
    this.advanced.set(null);
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
    this.advanced.set(null);
    this.busy.set(true);
    try {
      const action = completed ? checkAction(todo, this.today.date()) : null;
      if (action?.kind === 'advance') {
        // A repeating todo stays active: its due date moves to the next occurrence.
        await this.repository.shiftRepeatDue(todo.id, action.from, action.to);
        box.checked = false;
        this.advanced.set({
          id: todo.id,
          title: todo.title,
          from: action.from,
          to: action.to,
          date: this.display.formatLocalDate(action.to, 'weekday-long'),
        });
        this.actionError.set(false);
        await this.refresh();
        this.focus(this.inRow(todo.id, 'todo-check'));
        return;
      }
      await this.repository.setCompleted(todo.id, completed);
      this.actionError.set(false);
      await this.refresh();
      const stillShown = this.rows().some((r) => r.todo.id === todo.id);
      this.focus(stillShown ? this.inRow(todo.id, 'todo-check') : '[data-testid="todo-new"]');
    } catch (error) {
      box.checked = !completed;
      this.actionError.set(true);
      // The displayed list was out of date (conflict): reload it.
      if (error instanceof DataError && error.kind === 'conflict') await this.reloadQuietly();
    } finally {
      this.busy.set(false);
    }
  }

  /** Undoes the last advance of a repeating todo (compare-and-set in the other direction). */
  protected async undoAdvance(): Promise<void> {
    const advanced = this.advanced();
    if (advanced === null || this.busy()) return;
    this.advanced.set(null);
    this.busy.set(true);
    try {
      await this.repository.shiftRepeatDue(advanced.id, advanced.to, advanced.from);
      this.actionError.set(false);
      await this.refresh();
      this.focus(this.inRow(advanced.id, 'todo-check'));
    } catch (error) {
      this.actionError.set(true);
      if (error instanceof DataError && (error.kind === 'conflict' || error.kind === 'not_found')) {
        await this.reloadQuietly();
      } else {
        // Nothing changed: the advance can still be undone.
        this.advanced.set(advanced);
      }
      const shown = this.rows().some((r) => r.todo.id === advanced.id);
      this.focus(shown ? this.inRow(advanced.id, 'todo-check') : '[data-testid="todo-new"]');
    } finally {
      this.busy.set(false);
    }
  }

  private async reloadQuietly(): Promise<void> {
    try {
      await this.refresh();
    } catch {
      // The error flash is already shown.
    }
  }

  protected openDetail(todo: Todo): void {
    if (this.busy()) return;
    this.advanced.set(null);
    this.confirmingId.set(null);
    this.confirmingClear.set(false);
    this.gone.set(false);
    this.detail.set(todo);
  }

  /** Sheet closed ("Retour"): reload the list and give the focus back to the [i] of the row. */
  protected async onDetailClosed(saved: Todo): Promise<void> {
    // The sheet's last saved todo goes into the list first: it stays right if the reload fails.
    await this.leaveDetail('keep', (list) => list.map((t) => (t.id === saved.id ? saved : t)));
  }

  /** Todo deleted from the sheet: focus the row that took its place, else the previous, else the field. */
  protected async onDetailRemoved(): Promise<void> {
    const id = this.detail()?.id;
    await this.leaveDetail('neighbour', (list) => list.filter((t) => t.id !== id));
  }

  protected async onDetailVanished(): Promise<void> {
    this.gone.set(true);
    const id = this.detail()?.id;
    await this.leaveDetail('field', (list) => list.filter((t) => t.id !== id));
  }

  private async leaveDetail(
    focus: 'keep' | 'neighbour' | 'field',
    patch: (list: readonly Todo[]) => readonly Todo[],
  ): Promise<void> {
    const id = this.detail()?.id;
    const index = this.rows().findIndex((r) => r.todo.id === id);
    this.detail.set(null);
    this.todos.update(patch);
    try {
      await this.refresh();
      this.actionError.set(false);
    } catch {
      this.actionError.set(true);
    }
    if (this.destroyed) return;
    const rows = this.rows();
    const kept = focus === 'keep' ? rows.find((r) => r.todo.id === id) : undefined;
    const target = focus === 'field' ? undefined : (kept ?? rows[Math.min(index, rows.length - 1)]);
    this.focus(target ? this.inRow(target.todo.id, 'todo-info') : '[data-testid="todo-new"]');
  }

  protected askRemove(todo: Todo): void {
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
    this.advanced.set(null);
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
    this.advanced.set(null);
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
    this.advanced.set(null);
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
    this.advanced.set(null);
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
