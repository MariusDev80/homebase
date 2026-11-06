import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  untracked,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Dialog } from 'primeng/dialog';
import { DashboardStore } from '../dashboard/dashboard.store';
import { WidgetAddFlow } from '../dashboard/widget-add-flow';
import type { WidgetTypeId } from '../widgets/widget-definition';
import { WidgetRegistry } from '../widgets/widget-registry';

/**
 * Pop-up listing the widgets that can be added to the current dashboard (spec
 * dashboards-sidebar 4.9). Reads and drives `WidgetAddFlow`; shown while the phase is `choosing`.
 */
@Component({
  selector: 'app-widget-picker-dialog',
  imports: [TranslocoPipe, Dialog],
  host: { '(document:keydown.escape)': 'onEscape()' },
  template: `
    <p-dialog
      [visible]="true"
      [modal]="true"
      [closable]="false"
      [closeOnEscape]="false"
      [focusOnShow]="false"
      appendTo="body"
      [header]="'dashboard.addWidget' | transloco"
      [style]="{ width: '32rem', maxWidth: '92vw' }"
      data-testid="widget-picker-dialog"
    >
      <div #body class="flex flex-col gap-3" [attr.aria-busy]="flow.pending()">
        @if (allBlocked()) {
          <p role="alert" class="flash flash-attention" data-testid="widget-picker-full">
            <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
            {{ 'dashboard.gridFull' | transloco }}
          </p>
        }
        @if (flow.addFailed()) {
          <p role="alert" class="flash flash-danger" data-testid="widget-picker-error">
            <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
            {{ 'dashboard.addError' | transloco }}
          </p>
        }
        <ul class="flex flex-col gap-1" data-testid="widget-picker-list">
          @for (definition of registry.list(); track definition.type) {
            @let reason = store.addBlockReason(definition.type);
            <li>
              <button
                type="button"
                class="menu-item h-auto items-start py-2"
                [attr.data-testid]="'add-' + definition.type"
                [disabled]="flow.pending() || reason !== null"
                (click)="pick(definition.type)"
              >
                <i [class]="definition.icon" aria-hidden="true"></i>
                <span class="flex flex-col">
                  <span>{{ definition.titleKey | transloco }}</span>
                  <span class="text-sm text-fg-muted">{{
                    definition.descriptionKey | transloco
                  }}</span>
                  @if (reason !== null) {
                    <span class="text-sm" data-testid="widget-picker-reason">{{
                      (reason === 'limit'
                        ? 'dashboard.picker.limitReached'
                        : 'dashboard.picker.noRoom'
                      ) | transloco
                    }}</span>
                  }
                </span>
              </button>
            </li>
          }
        </ul>
        <div class="flex gap-2 self-end">
          <button
            #cancelButton
            type="button"
            class="btn"
            data-testid="widget-picker-cancel"
            [disabled]="flow.pending()"
            (click)="flow.cancel()"
          >
            {{ 'dashboard.picker.cancel' | transloco }}
          </button>
        </div>
      </div>
    </p-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WidgetPickerDialogComponent {
  protected readonly flow = inject(WidgetAddFlow);
  protected readonly store = inject(DashboardStore);
  protected readonly registry = inject(WidgetRegistry);
  private readonly injector = inject(Injector);
  private readonly body = viewChild<ElementRef<HTMLElement>>('body');
  private readonly cancelButton = viewChild<ElementRef<HTMLButtonElement>>('cancelButton');

  /** No entry can be added and at least one lacks room (not only per-type limits). */
  protected readonly allBlocked = computed(() => {
    const types = this.registry.list();
    const reasons = types.map((d) => this.store.addBlockReason(d.type));
    return reasons.length > 0 && reasons.every((r) => r !== null) && reasons.includes('full');
  });

  constructor() {
    // Initial focus: the first active entry, else Cancel.
    afterNextRender(() => this.focusFirst(), { injector: this.injector });
    // After a failed add the entries were disabled while writing and lost the focus.
    let wasPending = false;
    effect(() => {
      const pending = this.flow.pending();
      const failed = this.flow.addFailed();
      untracked(() => {
        if (wasPending && !pending && failed) {
          afterNextRender(() => this.focusFirst(), { injector: this.injector });
        }
        wasPending = pending;
      });
    });
  }

  private focusFirst(): void {
    const first = this.body()?.nativeElement.querySelector<HTMLButtonElement>(
      'ul button:not(:disabled)',
    );
    (first ?? this.cancelButton()?.nativeElement)?.focus();
  }

  /** Escape closes the pop-up at rest; ignored while an add is being written. */
  protected onEscape(): void {
    if (!this.flow.pending()) this.flow.cancel();
  }

  protected pick(type: WidgetTypeId): void {
    void this.flow.pick(type);
  }
}
