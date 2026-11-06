import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  Type,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialog } from 'primeng/confirmdialog';
import type { WidgetInstanceRecord } from '../../data';
import { DashboardStore } from '../dashboard/dashboard.store';
import { DRAG_HANDLE_CLASS } from '../dashboard/grid-adapter';
import { WidgetAddFlow } from '../dashboard/widget-add-flow';
import { WidgetFocus } from '../dashboard/widget-focus';
import { clampGrid } from './grid';
import { resolveConfig } from './widget-config';
import type { ConfigErrorReason } from './widget-config';
import { WIDGET_CONTEXT, createWidgetContext } from './widget-context';
import { WidgetRegistry } from './widget-registry';

type WidgetHostState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly component: Type<unknown>; readonly injector: Injector }
  | { readonly kind: 'unknown-type'; readonly type: string }
  | {
      readonly kind: 'invalid-config';
      readonly reason: ConfigErrorReason;
      readonly issues: readonly string[];
    }
  | { readonly kind: 'load-error' };

@Component({
  selector: 'app-widget-host',
  imports: [NgComponentOutlet, TranslocoPipe, ConfirmDialog],
  // Own service instance: the dialog below only reacts to this host's confirmations.
  providers: [ConfirmationService],
  templateUrl: './widget-host.component.html',
  host: { class: 'block h-full min-h-0' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WidgetHostComponent {
  readonly instance = input.required<WidgetInstanceRecord>();
  /** Layout edit mode: shows the drag handle (also the keyboard move/resize target). */
  readonly editing = input(false);
  protected readonly dragHandleClass = DRAG_HANDLE_CLASS;

  private readonly registry = inject(WidgetRegistry);
  private readonly store = inject(DashboardStore);
  private readonly parentInjector = inject(Injector);
  private readonly removeButton = viewChild<ElementRef<HTMLButtonElement>>('removeButton');
  private readonly confirmation = inject(ConfirmationService);
  private readonly transloco = inject(TranslocoService);
  private readonly widgetFocus = inject(WidgetFocus);
  private readonly addFlow = inject(WidgetAddFlow);
  private readonly section = viewChild<ElementRef<HTMLElement>>('section');

  /** Brief highlight after a focus request (see WidgetFocus). */
  protected readonly highlighted = signal(false);
  /** The widget just added, while the blue V is shown. */
  protected readonly isNew = computed(() => this.addFlow.newInstanceId() === this.instance().id);
  private highlightTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly state = signal<WidgetHostState>({ kind: 'loading' });
  private readonly attempt = signal(0);
  private buildToken = 0;

  protected readonly definition = computed(() => this.registry.get(this.instance().widgetType));

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.highlightTimer !== null) clearTimeout(this.highlightTimer);
    });
    effect(() => {
      const request = this.widgetFocus.request();
      if (!request) return;
      untracked(() => {
        // A request made before this host existed is still pending: it is claimed once, and only
        // while its session is the current one.
        if (request.instanceId === this.instance().id && this.widgetFocus.claim(request)) {
          afterNextRender(() => this.reveal(), { injector: this.parentInjector });
        }
      });
    });
    effect(() => {
      const instance = this.instance();
      this.attempt();
      untracked(() => {
        // A ready context is kept as long as the instance id is the same (saves return new records).
        const current = this.state();
        if (current.kind === 'ready' && this.builtFor === instance.id) return;
        void this.build(instance);
      });
    });
  }

  private builtFor: string | null = null;

  /** Moves the focus to the card and highlights it for a moment (the page does not scroll). */
  private reveal(): void {
    this.section()?.nativeElement.focus({ preventScroll: true });
    this.highlighted.set(true);
    if (this.highlightTimer !== null) clearTimeout(this.highlightTimer);
    this.highlightTimer = setTimeout(() => {
      this.highlightTimer = null;
      this.highlighted.set(false);
    }, HIGHLIGHT_MS);
  }

  private async build(instance: WidgetInstanceRecord): Promise<void> {
    const token = ++this.buildToken;
    const definition = this.registry.get(instance.widgetType);
    if (!definition) {
      this.state.set({ kind: 'unknown-type', type: instance.widgetType });
      return;
    }
    const resolved = resolveConfig(definition.config, instance.configVersion, instance.config);
    if (resolved.status === 'invalid') {
      this.state.set({ kind: 'invalid-config', reason: resolved.reason, issues: resolved.issues });
      return;
    }
    this.state.set({ kind: 'loading' });
    let component: Type<unknown>;
    try {
      component = await definition.loadComponent();
    } catch {
      if (token === this.buildToken) this.state.set({ kind: 'load-error' });
      return;
    }
    if (token !== this.buildToken) return;

    const size = computed(() => {
      const { w, h } = clampGrid(this.instance().grid, definition.size);
      return { w, h };
    });
    const context = createWidgetContext({
      record: instance,
      definition,
      initialConfig: resolved.config,
      size,
      writer: this.store,
    });
    const injector = Injector.create({
      providers: [{ provide: WIDGET_CONTEXT, useValue: context }],
      parent: this.parentInjector,
    });
    this.builtFor = instance.id;
    this.state.set({ kind: 'ready', component, injector });
  }

  protected retry(): void {
    this.builtFor = null;
    this.attempt.update((n) => n + 1);
  }

  protected readonly actionFailed = signal(false);
  /** Polite live-region text after a keyboard move/resize. */
  protected readonly announcement = signal('');

  /** Arrows move by one cell, Shift + arrows resize; same bounds and persistence as a drag. */
  protected onHandleKeydown(event: KeyboardEvent): void {
    const step = ARROW_STEPS[event.key];
    if (!step || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const rect = this.store.nudge(
      this.instance().id,
      event.shiftKey ? { dw: step.dx, dh: step.dy } : { dx: step.dx, dy: step.dy },
    );
    this.announcement.set(
      rect
        ? this.transloco.translate(
            event.shiftKey ? 'widgetHost.layout.resized' : 'widgetHost.layout.moved',
            { x: rect.x + 1, y: rect.y + 1, w: rect.w, h: rect.h },
          )
        : this.transloco.translate('widgetHost.layout.blocked'),
    );
  }

  /** Asks for confirmation first; cancelling (button or Escape) changes nothing. */
  protected remove(): void {
    const t = (key: string): string => this.transloco.translate(key);
    this.confirmation.confirm({
      header: t('widgetHost.confirmRemove.header'),
      message: t(this.definition()?.removeConfirmKey ?? 'widgetHost.confirmRemove.message'),
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: t('widgetHost.confirmRemove.accept'),
      rejectLabel: t('widgetHost.confirmRemove.reject'),
      acceptButtonProps: { severity: 'danger' },
      rejectButtonProps: { severity: 'secondary', outlined: true },
      defaultFocus: 'reject',
      // Cancel button + Escape are enough: no unlabeled close icon.
      closable: false,
      // Cancel/Escape: focus goes back to the trash button. On accept the host is destroyed;
      // the focus then goes to the add-widget button of the sidebar.
      reject: () => this.removeButton()?.nativeElement.focus(),
      accept: () => void this.removeInstance(),
    });
  }

  protected async reset(): Promise<void> {
    await this.runAction(() => this.store.resetConfig(this.instance().id));
  }

  /** Removes the widget, then hands the focus to the add-widget button of the sidebar. */
  private async removeInstance(): Promise<void> {
    const removed = await this.runAction(() => this.store.remove(this.instance().id));
    if (removed) this.addFlow.focusTrigger();
  }

  private async runAction(action: () => Promise<void>): Promise<boolean> {
    this.actionFailed.set(false);
    try {
      await action();
      return true;
    } catch (error: unknown) {
      console.error('Widget action failed', error);
      this.actionFailed.set(true);
      return false;
    }
  }
}

/** Duration of the highlight (a static outline, no animation). */
const HIGHLIGHT_MS = 2000;

const ARROW_STEPS: Record<string, { dx: number; dy: number } | undefined> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
};
