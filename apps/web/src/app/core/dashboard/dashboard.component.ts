import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Gridster, GridsterItem } from 'angular-gridster2';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { LayoutItem, WidgetInstanceRecord } from '../../data';
import { WidgetHostComponent } from '../widgets/widget-host.component';
import { WidgetRegistry } from '../widgets/widget-registry';
import { DashboardLimitError, DashboardListStore } from './dashboard-list.store';
import { DashboardStore } from './dashboard.store';
import {
  buildGridOptions,
  fallbackConstraints,
  fromGridsterItem,
  sameGridsterItem,
  toGridsterItem,
} from './grid-adapter';
import type { DashboardGridItem } from './grid-adapter';
import { sameRect } from './grid-layout';

/** Longest dashboard name accepted by the data layer. */
const DASHBOARD_NAME_MAX = 100;

interface GridEntry {
  readonly instance: WidgetInstanceRecord;
  readonly item: DashboardGridItem;
}

@Component({
  selector: 'app-dashboard',
  imports: [TranslocoPipe, WidgetHostComponent, Gridster, GridsterItem],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
  // Unencapsulated: restyles the gridster elements (unlayered library CSS) with the tokens.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'flex min-h-0 flex-1 flex-col',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent {
  protected readonly store = inject(DashboardStore);
  protected readonly registry = inject(WidgetRegistry);
  private readonly transloco = inject(TranslocoService);
  private readonly list = inject(DashboardListStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly gridster = viewChild(Gridster);
  private readonly gridArea = viewChild<ElementRef<HTMLElement>>('gridArea');

  /** Move of the widgets without room to a new dashboard: running, and the key of its error. */
  protected readonly moving = signal(false);
  protected readonly moveErrorKey = signal<string | null>(null);
  /** Layout edit mode: drag, resize and keyboard move are enabled only while true. */
  protected readonly editing = signal(false);

  private readonly destroyRef = inject(DestroyRef);
  private readonly changedItems = new Map<string, LayoutItem>();
  /** A drag or resize is in progress: gridster must not report items by itself (diagnostic). */
  private interacting = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** Gridster mutates its item objects in place: keep them while their values are unchanged. */
  private readonly itemCache = new Map<string, DashboardGridItem>();

  protected readonly gridOptions = computed(() =>
    buildGridOptions({
      editing: this.editing(),
      onItemChange: (item) => this.onItemChange(item),
      onInteractionStart: () => {
        this.interacting = true;
      },
    }),
  );

  protected readonly entries = computed<GridEntry[]>(() => {
    const placed = this.store.layout().placed;
    const seen = new Set<string>();
    const entries: GridEntry[] = [];
    for (const stored of this.store.instances()) {
      const grid = placed.get(stored.id);
      if (!grid) continue;
      const constraints =
        this.registry.get(stored.widgetType)?.size ?? fallbackConstraints(stored.grid);
      const wanted = toGridsterItem(stored.id, grid, constraints);
      const cached = this.itemCache.get(stored.id);
      const item = cached && sameGridsterItem(cached, wanted) ? cached : wanted;
      this.itemCache.set(stored.id, item);
      seen.add(stored.id);
      const instance = sameRect(stored.grid, grid) ? stored : { ...stored, grid };
      entries.push({ instance, item });
    }
    for (const id of this.itemCache.keys()) if (!seen.has(id)) this.itemCache.delete(id);
    return entries;
  });

  /** Names of the widgets without room on the grid (they stay stored, they are only hidden). */
  protected readonly unplacedNames = computed<string[]>(() => {
    const unplaced = new Set(this.store.layout().unplaced);
    return this.store
      .instances()
      .filter((i) => unplaced.has(i.id))
      .map((i) => {
        const key = this.registry.get(i.widgetType)?.titleKey;
        return key ? this.transloco.translate(key) : i.widgetType;
      });
  });

  constructor() {
    // Gridster only listens to window.resize: a banner changing the area height needs a nudge.
    effect((onCleanup) => {
      const area = this.gridArea()?.nativeElement;
      if (!area || typeof ResizeObserver !== 'function') return;
      const observer = new ResizeObserver(() => this.gridster()?.api.resize());
      observer.observe(area);
      onCleanup(() => observer.disconnect());
    });
    this.destroyRef.onDestroy(() => {
      this.flushLayout();
      this.store.close();
    });
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      void this.openDashboard(params.get('id'));
    });
  }

  /** Hidden title (h1): the name known by the list, which follows a rename. */
  protected readonly title = computed(() => {
    const current = this.store.dashboard();
    if (!current) return '';
    return this.list.dashboards().find((d) => d.id === current.id)?.name ?? current.name;
  });

  private async openDashboard(id: string | null): Promise<void> {
    this.flushLayout();
    this.moveErrorKey.set(null);
    const outcome = await this.store.open(id, this.transloco.translate('dashboard.defaultName'));
    if (outcome === 'not-found') {
      await this.router.navigateByUrl('/', { replaceUrl: true });
    } else if (outcome === 'ready' && id !== null) {
      this.list.rememberOpened(id);
    }
  }

  /** Name of the overflow dashboard, cut by code points to fit the 100 characters of a name. */
  private overflowName(name: string): string {
    const key = 'dashboard.overflowName';
    const budget = DASHBOARD_NAME_MAX - this.transloco.translate(key, { name: '' }).length;
    let kept = '';
    for (const codePoint of name) {
      if (kept.length + codePoint.length > budget) break;
      kept += codePoint;
    }
    return this.transloco.translate(key, { name: kept });
  }

  /**
   * Moves the widgets without room to a new dashboard (same icon), without navigating. Creation
   * and move are not atomic: if the move fails, the empty dashboard is removed (best effort).
   */
  protected async moveUnplaced(): Promise<void> {
    const current = this.store.dashboard();
    if (!current || this.moving()) return;
    this.moving.set(true);
    this.moveErrorKey.set(null);
    let createdId: string | null = null;
    try {
      const created = await this.list.create({
        name: this.overflowName(current.name),
        icon: current.icon,
      });
      createdId = created.id;
      const moved = await this.store.moveUnplacedTo(created.id);
      if (moved === 0) throw new Error('No widget was moved');
    } catch (error: unknown) {
      if (error instanceof DashboardLimitError) {
        this.moveErrorKey.set('dashboards.limit');
      } else {
        console.error('Could not move the widgets without room', error);
        this.moveErrorKey.set('dashboard.moveUnplacedError');
        if (createdId !== null) await this.list.discardEmpty(createdId);
      }
    } finally {
      this.moving.set(false);
    }
  }

  protected toggleEditing(): void {
    if (this.editing()) this.flushLayout();
    this.editing.update((value) => !value);
  }

  /** Gridster reports each changed item (dragged, resized or pushed): batch them into one write. */
  private onItemChange(item: DashboardGridItem): void {
    if (!this.editing()) return;
    if (!this.interacting) console.warn('gridster moved an item by itself', item.id);
    this.changedItems.set(item.id, fromGridsterItem(item));
    this.flushTimer ??= setTimeout(() => this.flushLayout(), 0);
  }

  private flushLayout(): void {
    this.interacting = false;
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (this.changedItems.size === 0) return;
    const items = [...this.changedItems.values()];
    this.changedItems.clear();
    void this.store.changeLayout(items);
  }
}
