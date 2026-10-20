import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  Type,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { WidgetInstanceRecord } from '../../data';
import { DashboardStore } from '../dashboard/dashboard.store';
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
  imports: [NgComponentOutlet, TranslocoPipe],
  templateUrl: './widget-host.component.html',
  host: { class: 'block min-h-0' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WidgetHostComponent {
  readonly instance = input.required<WidgetInstanceRecord>();

  private readonly registry = inject(WidgetRegistry);
  private readonly store = inject(DashboardStore);
  private readonly parentInjector = inject(Injector);

  protected readonly state = signal<WidgetHostState>({ kind: 'loading' });
  private readonly attempt = signal(0);
  private buildToken = 0;

  protected readonly definition = computed(() => this.registry.get(this.instance().widgetType));

  constructor() {
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

  protected remove(): Promise<void> {
    return this.runAction(() => this.store.remove(this.instance().id));
  }

  protected reset(): Promise<void> {
    return this.runAction(() => this.store.resetConfig(this.instance().id));
  }

  private async runAction(action: () => Promise<void>): Promise<void> {
    this.actionFailed.set(false);
    try {
      await action();
    } catch (error: unknown) {
      console.error('Widget action failed', error);
      this.actionFailed.set(true);
    }
  }
}
