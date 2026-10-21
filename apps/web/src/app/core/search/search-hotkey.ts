import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

/** True when typing in this element must not be hijacked by a single-key shortcut. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/**
 * The single, global keyboard shortcut of the search bar: Ctrl+K (Cmd+K) anywhere, and `/`
 * outside text fields. Registered once here (root service); the search widget only
 * `register`s the function that focuses its field.
 */
@Injectable({ providedIn: 'root' })
export class SearchHotkey {
  private readonly document = inject(DOCUMENT);
  private readonly targets: (() => void)[] = [];

  constructor() {
    this.document.addEventListener('keydown', (event) => this.onKeydown(event));
  }

  /** Makes `focus` the target of the shortcut (last registration wins); returns the unregister function. */
  register(focus: () => void): () => void {
    this.targets.push(focus);
    return () => {
      const index = this.targets.indexOf(focus);
      if (index >= 0) this.targets.splice(index, 1);
    };
  }

  private onKeydown(event: KeyboardEvent): void {
    const target = this.targets.at(-1);
    if (!target || event.defaultPrevented) return;
    const withModifier = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
    const isCtrlK = withModifier && event.key.toLowerCase() === 'k';
    const isSlash =
      event.key === '/' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !isTextEntry(event.target);
    if (!isCtrlK && !isSlash) return;
    event.preventDefault();
    target();
  }
}
