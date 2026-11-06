import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { WidgetFocus } from '../../core/dashboard/widget-focus';
import { SearchHotkey, SearchService } from '../../core/search';
import type { SearchGroup, SearchKind, SearchOutcome, SearchResult } from '../../core/search';
import { UrlOpener } from '../../core/system';
import { injectWidgetContext } from '../../core/widgets';
import { highlightSegments } from './highlight';
import type { TextSegment } from './highlight';
import { buildSearchUrl } from './search-engines';
import { SEARCH_ENGINES, isSearchEngine } from './search.config';
import type { SearchConfig, SearchEngine } from './search.config';

export const SEARCH_DEBOUNCE_MS = 200;
const QUERY_MAX = 200;

const KIND_ICONS: Record<SearchKind, string> = {
  shortcut: 'pi pi-link',
  note: 'pi pi-file-edit',
  todo: 'pi pi-check-square',
};

type Message = 'openError' | 'notFound' | 'unplaced' | 'webError' | 'engineError';

interface OptionView {
  readonly id: string;
  readonly index: number;
  /** Absent on the final "search the web" entry. */
  readonly result?: SearchResult;
}

interface SectionView {
  readonly kind: SearchKind;
  readonly headerId: string;
  readonly options: readonly OptionView[];
}

interface Placement {
  /** null when the list opens above the field (then `bottom` is set). */
  readonly top: number | null;
  readonly bottom: number | null;
  readonly left: number;
  readonly width: number;
  readonly maxHeight: number;
}

@Component({
  selector: 'app-search-widget',
  imports: [TranslocoPipe],
  templateUrl: './search.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-2', '(window:resize)': 'place()' },
})
export class SearchComponent {
  protected readonly ctx = injectWidgetContext<SearchConfig>();
  private readonly service = inject(SearchService);
  private readonly urlOpener = inject(UrlOpener);
  private readonly widgetFocus = inject(WidgetFocus);
  private readonly transloco = inject(TranslocoService);
  private readonly document = inject(DOCUMENT);

  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('field');
  private readonly listbox = viewChild.required<ElementRef<HTMLElement>>('listbox');

  protected readonly engines = SEARCH_ENGINES;
  protected readonly maxLength = QUERY_MAX;
  protected readonly listboxId = `search-listbox-${this.ctx.instanceId}`;
  protected readonly engine = computed<SearchEngine>(() => this.ctx.config().engine);

  protected readonly query = signal('');
  protected readonly open = signal(false);
  protected readonly searching = signal(false);
  protected readonly activeIndex = signal(-1);
  protected readonly message = signal<Message | null>(null);
  protected readonly placement = signal<Placement | null>(null);
  private readonly outcome = signal<SearchOutcome | null>(null);
  /** The term the displayed results were computed for (used for the highlighting). */
  private readonly searchedTerm = signal('');

  private timer: ReturnType<typeof setTimeout> | null = null;
  private searchToken = 0;

  protected readonly term = computed(() => this.query().trim());
  protected readonly failed = computed(() => this.outcome()?.failed ?? []);
  protected readonly failedNames = computed(() =>
    this.failed()
      .map((kind) => this.transloco.translate(`widgets.search.groups.${kind}`))
      .join(', '),
  );

  protected readonly sections = computed<SectionView[]>(() => {
    let index = 0;
    return (this.outcome()?.groups ?? []).map((group: SearchGroup) => ({
      kind: group.kind,
      headerId: `${this.listboxId}-${group.kind}`,
      options: group.results.map((result) => {
        const option = { id: `${this.listboxId}-opt-${index}`, index, result };
        index++;
        return option;
      }),
    }));
  });

  private readonly resultCount = computed(() =>
    this.sections().reduce((total, section) => total + section.options.length, 0),
  );

  /** The last entry (web search) exists as soon as there is a query. */
  protected readonly webOption = computed<OptionView | null>(() =>
    this.term() === ''
      ? null
      : { id: `${this.listboxId}-opt-${this.resultCount()}`, index: this.resultCount() },
  );

  private readonly optionCount = computed(() => this.resultCount() + (this.webOption() ? 1 : 0));

  protected readonly activeId = computed(() => {
    const index = this.activeIndex();
    return this.open() && index >= 0 && index < this.optionCount()
      ? `${this.listboxId}-opt-${index}`
      : null;
  });

  protected readonly showEmpty = computed(
    () =>
      this.term() !== '' &&
      !this.searching() &&
      this.outcome() !== null &&
      this.resultCount() === 0 &&
      this.failed().length === 0,
  );

  protected readonly announcement = computed(() => {
    if (!this.open() || this.searching() || this.outcome() === null || this.term() === '') {
      return '';
    }
    return this.resultCount() === 0
      ? this.transloco.translate('widgets.search.noResults')
      : this.transloco.translate('widgets.search.resultsCount', { count: this.resultCount() });
  });

  protected readonly engineLabel = computed(() =>
    this.transloco.translate(`widgets.search.engines.${this.engine()}`),
  );

  constructor() {
    const unregister = inject(SearchHotkey).register(() => this.focusField());
    const onScroll = (): void => this.place();
    this.document.addEventListener('scroll', onScroll, true);
    inject(DestroyRef).onDestroy(() => {
      unregister();
      this.document.removeEventListener('scroll', onScroll, true);
      if (this.timer !== null) clearTimeout(this.timer);
      this.searchToken++;
    });

    effect(() => {
      const open = this.open();
      const list = this.listbox().nativeElement;
      untracked(() => {
        if (open) this.place();
        this.syncPopover(list, open);
      });
    });
  }

  protected icon(kind: SearchKind): string {
    return KIND_ICONS[kind];
  }

  protected segments(text: string): TextSegment[] {
    return highlightSegments(text, this.searchedTerm());
  }

  protected onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.query.set(value);
    this.message.set(null);
    this.activeIndex.set(-1);
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (value.trim() === '') {
      this.reset();
      return;
    }
    this.open.set(true);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runSearch();
    }, SEARCH_DEBOUNCE_MS);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        if (this.term() === '') return;
        event.preventDefault();
        if (!this.open()) {
          this.open.set(true);
          return;
        }
        const count = this.optionCount();
        const current = this.activeIndex();
        const down = event.key === 'ArrowDown';
        this.activeIndex.set(
          current === -1 ? (down ? 0 : count - 1) : (current + (down ? 1 : -1) + count) % count,
        );
        return;
      }
      case 'Enter': {
        if (this.term() === '') return;
        event.preventDefault();
        void this.activate(this.open() ? this.activeIndex() : -1);
        return;
      }
      case 'Escape': {
        if (this.open()) {
          event.preventDefault();
          this.close();
        } else if (this.query() !== '') {
          event.preventDefault();
          this.clear();
        }
        return;
      }
    }
  }

  protected onBlur(): void {
    this.close();
  }

  protected onEngineChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (!isSearchEngine(value)) return;
    this.message.set(null);
    this.ctx.updateConfig({ engine: value }).catch(() => this.message.set('engineError'));
  }

  protected onOptionClick(option: OptionView): void {
    void this.activate(option.index);
    this.input().nativeElement.focus();
  }

  /** Called by the hotkey service (Ctrl+K and /). */
  private focusField(): void {
    const field = this.input().nativeElement;
    field.focus();
    field.select();
  }

  protected place(): void {
    if (!this.open()) return;
    const rect = this.input().nativeElement.getBoundingClientRect();
    const viewportHeight = this.document.defaultView?.innerHeight ?? 0;
    const below = viewportHeight - rect.bottom - 16;
    if (below < 160 && rect.top - 20 > below) {
      this.placement.set({
        top: null,
        bottom: viewportHeight - rect.top + 4,
        left: rect.left,
        width: rect.width,
        maxHeight: rect.top - 20,
      });
      return;
    }
    this.placement.set({
      top: rect.bottom + 4,
      bottom: null,
      left: rect.left,
      width: rect.width,
      maxHeight: Math.max(160, below),
    });
  }

  /** The list is a popover (top layer): it is neither clipped by the card nor hidden by its neighbours. */
  private syncPopover(list: HTMLElement, open: boolean): void {
    try {
      const shown = list.matches(':popover-open');
      if (open && !shown) list.showPopover();
      else if (!open && shown) list.hidePopover();
    } catch {
      // No Popover API: the list is positioned and hidden by its CSS classes only.
    }
  }

  private close(): void {
    this.open.set(false);
    this.activeIndex.set(-1);
  }

  private clear(): void {
    this.query.set('');
    this.reset();
  }

  private reset(): void {
    this.searchToken++;
    this.outcome.set(null);
    this.searchedTerm.set('');
    this.searching.set(false);
    this.close();
  }

  private async runSearch(): Promise<void> {
    const token = ++this.searchToken;
    const term = this.term();
    this.searching.set(true);
    let outcome: SearchOutcome;
    try {
      outcome = await this.service.search(term);
    } catch {
      outcome = { groups: [], failed: ['shortcut', 'note', 'todo'] };
    }
    if (token !== this.searchToken) return;
    this.outcome.set(outcome);
    this.searchedTerm.set(term);
    this.searching.set(false);
    this.activeIndex.set(-1);
  }

  /** index -1 (or the final entry, which has no result) = web search. */
  private async activate(index: number): Promise<void> {
    const result = index >= 0 ? this.findResult(index) : undefined;
    this.close();
    this.message.set(null);
    if (!result) {
      await this.webSearch();
      return;
    }
    if (result.kind === 'shortcut') {
      try {
        await this.urlOpener.open(this.ctx, result.url);
      } catch {
        this.message.set('openError');
      }
      return;
    }
    const target = result.widgetInstanceId;
    if (target === null) {
      this.message.set('notFound');
      return;
    }
    const outcome = await this.widgetFocus.focusInstance(target);
    if (outcome === 'not-found') this.message.set('notFound');
    else if (outcome === 'unplaced') this.message.set('unplaced');
  }

  private findResult(index: number): SearchResult | undefined {
    for (const section of this.sections()) {
      const found = section.options.find((o) => o.index === index);
      if (found) return found.result;
    }
    return undefined;
  }

  private async webSearch(): Promise<void> {
    const term = this.term();
    if (term === '') return;
    try {
      await this.urlOpener.open(this.ctx, buildSearchUrl(this.engine(), term));
    } catch {
      this.message.set('webError');
    }
  }
}
