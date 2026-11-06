import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';

interface SidebarLabel {
  readonly text: string;
  readonly top: number;
  readonly left: number;
}

/** Vertical bar: one icon bubble per destination, with a floating text bubble on hover/focus. */
@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, RouterLinkActive, TranslocoPipe],
  templateUrl: './sidebar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'sidebar', '(document:keydown.escape)': 'hideLabel()' },
})
export class SidebarComponent {
  private readonly transloco = inject(TranslocoService);
  protected readonly label = signal<SidebarLabel | null>(null);
  private readonly scrollArea = viewChild<ElementRef<HTMLElement>>('scrollArea');
  /** Current anchor: the hovered or focused bubble, to reposition on list scroll. */
  private anchor: HTMLElement | null = null;

  /** mouseenter, or a focusin whose target is :focus-visible (keyboard). */
  protected showLabel(event: Event, textKey: string): void {
    const target = event.currentTarget as HTMLElement | null;
    if (!target) return;
    if (event.type === 'focusin' && !target.matches(':focus-visible')) return;
    this.anchor = target;
    this.label.set(this.place(target, this.transloco.translate(textKey)));
  }

  protected hideLabel(): void {
    this.anchor = null;
    if (this.label() !== null) this.label.set(null);
  }

  /** Scroll of the list: follows the anchor, removes the label if the anchor is out of view. */
  protected onListScroll(): void {
    const anchor = this.anchor;
    const current = this.label();
    const area = this.scrollArea()?.nativeElement;
    if (!anchor || !current || !area) return;
    const rect = anchor.getBoundingClientRect();
    const bounds = area.getBoundingClientRect();
    if (rect.bottom <= bounds.top || rect.top >= bounds.bottom) {
      this.hideLabel();
      return;
    }
    this.label.set(this.place(anchor, current.text));
  }

  private place(anchor: HTMLElement, text: string): SidebarLabel {
    const rect = anchor.getBoundingClientRect();
    return { text, top: rect.top + 4, left: rect.right + 8 };
  }
}
