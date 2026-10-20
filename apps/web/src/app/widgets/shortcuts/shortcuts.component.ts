import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UrlOpener, parseWebUrl } from '../../core/system';
import type { WebUrlErrorReason } from '../../core/system';
import { injectWidgetContext } from '../../core/widgets';
import { SHORTCUT_REPOSITORY } from '../../data';
import type { Shortcut } from '../../data';
import type { ShortcutsConfig } from './shortcuts.config';

const LABEL_MAX = 80;

const URL_ERROR_KEYS: Record<WebUrlErrorReason, string> = {
  invalid: 'widgets.shortcuts.errors.urlInvalid',
  protocol: 'widgets.shortcuts.errors.urlProtocol',
  credentials: 'widgets.shortcuts.errors.urlCredentials',
  'too-long': 'widgets.shortcuts.errors.urlTooLong',
};

interface EditState {
  /** null = a new shortcut. */
  readonly id: string | null;
  readonly label: string;
  readonly url: string;
}

@Component({
  selector: 'app-shortcuts-widget',
  imports: [TranslocoPipe],
  templateUrl: './shortcuts.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-2' },
})
export class ShortcutsComponent {
  protected readonly ctx = injectWidgetContext<ShortcutsConfig>();
  private readonly repository = inject(SHORTCUT_REPOSITORY);
  private readonly urlOpener = inject(UrlOpener);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly items = signal<readonly Shortcut[]>([]);
  protected readonly status = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly managing = signal(false);
  protected readonly editing = signal<EditState | null>(null);
  protected readonly labelError = signal<string | null>(null);
  protected readonly urlError = signal<string | null>(null);
  protected readonly confirmingId = signal<string | null>(null);
  protected readonly actionError = signal<'open' | 'action' | null>(null);
  /** True while a write is in flight: a second submit/move/delete is ignored. */
  protected readonly busy = signal(false);

  constructor() {
    void this.load();
  }

  protected async load(showLoading = true): Promise<void> {
    if (showLoading) this.status.set('loading');
    try {
      this.items.set(await this.repository.list());
      this.status.set('ready');
    } catch {
      this.status.set('error');
    }
  }

  protected initial(item: Shortcut): string {
    return Array.from(item.label)[0]?.toUpperCase() ?? '?';
  }

  protected domain(item: Shortcut): string {
    try {
      return new URL(item.url).hostname;
    } catch {
      return '';
    }
  }

  protected async open(item: Shortcut): Promise<void> {
    this.actionError.set(null);
    try {
      await this.urlOpener.open(this.ctx, item.url);
    } catch {
      this.actionError.set('open');
    }
  }

  protected toggleManaging(): void {
    this.managing.update((value) => !value);
    this.closeForm();
    this.confirmingId.set(null);
    this.actionError.set(null);
  }

  protected startAdd(): void {
    this.confirmingId.set(null);
    this.clearErrors();
    this.editing.set({ id: null, label: '', url: '' });
    this.focus('[data-testid="shortcuts-label"]');
  }

  protected startEdit(item: Shortcut): void {
    this.confirmingId.set(null);
    this.clearErrors();
    this.editing.set({ id: item.id, label: item.label, url: item.url });
    this.focus('[data-testid="shortcuts-label"]');
  }

  /** Cancel button: closes the form and gives the focus back to the control that opened it. */
  protected cancelEdit(): void {
    const id = this.editing()?.id;
    this.closeForm();
    this.focusEditTrigger(id);
  }

  private closeForm(): void {
    this.editing.set(null);
    this.clearErrors();
  }

  protected onLabelInput(event: Event): void {
    const label = (event.target as HTMLInputElement).value;
    this.editing.update((state) => (state ? { ...state, label } : state));
  }

  protected onUrlInput(event: Event): void {
    const url = (event.target as HTMLInputElement).value;
    this.editing.update((state) => (state ? { ...state, url } : state));
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    const state = this.editing();
    if (!state || this.busy()) return;

    const label = state.label.trim();
    const labelValid = label.length >= 1 && label.length <= LABEL_MAX;
    const parsed = parseWebUrl(state.url);
    this.labelError.set(labelValid ? null : 'widgets.shortcuts.errors.labelRequired');
    this.urlError.set(parsed.ok ? null : URL_ERROR_KEYS[parsed.reason]);
    if (!labelValid || !parsed.ok) return;

    this.busy.set(true);
    try {
      if (state.id === null) {
        await this.repository.create({ label, url: parsed.url });
      } else {
        await this.repository.update(state.id, { label, url: parsed.url });
      }
      this.closeForm();
      this.actionError.set(null);
      await this.load(false);
      this.focusEditTrigger(state.id);
    } catch {
      this.actionError.set('action');
    } finally {
      this.busy.set(false);
    }
  }

  protected askRemove(item: Shortcut): void {
    this.closeForm();
    this.confirmingId.set(item.id);
    this.focus(this.inRow(item.id, 'shortcut-confirm-no'));
  }

  protected cancelRemove(item: Shortcut): void {
    this.confirmingId.set(null);
    this.focus(this.inRow(item.id, 'shortcut-remove'));
  }

  protected async confirmRemove(item: Shortcut): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    const index = this.items().findIndex((s) => s.id === item.id);
    this.confirmingId.set(null);
    try {
      await this.repository.remove(item.id);
      this.actionError.set(null);
      await this.load(false);
      // Sensible target: the delete button of the row that took its place (or the previous
      // one), and the add button when the list is now empty.
      const list = this.items();
      const target = list[Math.min(index, list.length - 1)];
      this.focus(
        target ? this.inRow(target.id, 'shortcut-remove') : '[data-testid="shortcuts-add"]',
      );
    } catch {
      this.actionError.set('action');
    } finally {
      this.busy.set(false);
    }
  }

  protected async move(item: Shortcut, offset: -1 | 1): Promise<void> {
    if (this.busy()) return;
    const ids = this.items().map((s) => s.id);
    const from = ids.indexOf(item.id);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    this.busy.set(true);
    try {
      await this.repository.reorder(ids);
      this.actionError.set(null);
      await this.load(false);
      // Keep the focus on the same direction button, unless it is now disabled (list end).
      const atEnd = offset < 0 ? to === 0 : to === ids.length - 1;
      const same = offset < 0 ? 'shortcut-up' : 'shortcut-down';
      const opposite = offset < 0 ? 'shortcut-down' : 'shortcut-up';
      this.focus(this.inRow(item.id, atEnd ? opposite : same));
    } catch {
      this.actionError.set('action');
    } finally {
      this.busy.set(false);
    }
  }

  private inRow(id: string, testId: string): string {
    return `[data-shortcut-id="${id}"] [data-testid="${testId}"]`;
  }

  private focusEditTrigger(id: string | null | undefined): void {
    this.focus(id ? this.inRow(id, 'shortcut-edit') : '[data-testid="shortcuts-add"]');
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

  private clearErrors(): void {
    this.labelError.set(null);
    this.urlError.set(null);
  }
}
