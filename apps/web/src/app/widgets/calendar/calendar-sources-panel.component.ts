import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { WidgetRegistry } from '../../core/widgets/widget-registry';

/** Types that have their own wording ("Rappels", "Tâches", "Habitudes"); others use their titleKey. */
const NAMED_SOURCES: readonly string[] = ['reminders', 'todo', 'habits'];

export interface SourceToggle {
  readonly type: string;
  readonly visible: boolean;
}

let nextTitleId = 0;

/**
 * The "Sources affichées" panel (spec calendar-occurrences 3.6): replaces the body of the card like
 * the Day panel. Escape and "Retour" close it; the host gives the focus back to the filter button.
 */
@Component({
  selector: 'app-calendar-sources-panel',
  imports: [TranslocoPipe],
  templateUrl: './calendar-sources-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'absolute inset-0 overflow-y-auto bg-canvas',
    role: 'region',
    '[attr.aria-labelledby]': 'titleId',
    'data-testid': 'calendar-sources-panel',
    '(keydown.escape)': 'onEscape($event)',
  },
})
export class CalendarSourcesPanelComponent {
  protected readonly titleId = `calendar-sources-panel-title-${nextTitleId++}`;
  private readonly registry = inject(WidgetRegistry);
  private readonly back = viewChild.required<ElementRef<HTMLButtonElement>>('back');

  /** Widget types whose events are hidden. */
  readonly hiddenTypes = input.required<readonly string[]>();

  readonly closed = output();
  readonly toggled = output<SourceToggle>();

  protected readonly rows = computed(() =>
    this.registry
      .list()
      .filter((definition) => definition.loadCalendarSource !== undefined)
      .map((definition) => ({
        type: definition.type,
        icon: definition.icon,
        nameKey: NAMED_SOURCES.includes(definition.type)
          ? `widgets.calendar.sourceName.${definition.type}`
          : definition.titleKey,
        visible: !this.hiddenTypes().includes(definition.type),
      })),
  );

  constructor() {
    afterNextRender(() => this.back().nativeElement.focus());
  }

  protected onToggle(type: string, event: Event): void {
    this.toggled.emit({ type, visible: (event.target as HTMLInputElement).checked });
  }

  protected onEscape(event: Event): void {
    if ((event as KeyboardEvent).isComposing) return;
    event.stopPropagation();
    this.closed.emit();
  }
}
