import { Injectable, inject } from '@angular/core';
import { NOTE_REPOSITORY, SHORTCUT_REPOSITORY, TODO_REPOSITORY } from '../../data';

export type SearchKind = 'shortcut' | 'note' | 'todo';

export const SEARCH_GROUP_LIMIT = 5;
export const SEARCH_QUERY_MAX_LENGTH = 200;

export interface ShortcutResult {
  readonly kind: 'shortcut';
  readonly id: string;
  readonly title: string;
  /** The shortcut URL. */
  readonly subtitle: string;
  readonly url: string;
}

export interface NoteResult {
  readonly kind: 'note';
  readonly id: string;
  /** Empty for an untitled note (the caller shows a placeholder). */
  readonly title: string;
  /** Short plain-text excerpt; absent when empty. */
  readonly subtitle?: string;
  readonly widgetInstanceId: string | null;
}

export interface TodoResult {
  readonly kind: 'todo';
  readonly id: string;
  readonly title: string;
  readonly completed: boolean;
  /** Short plain-text excerpt of the description; absent when empty. */
  readonly subtitle?: string;
  readonly widgetInstanceId: string | null;
}

export type SearchResult = ShortcutResult | NoteResult | TodoResult;

export interface SearchGroup {
  readonly kind: SearchKind;
  /** 1 to SEARCH_GROUP_LIMIT results. */
  readonly results: readonly SearchResult[];
}

export interface SearchOutcome {
  /** Non-empty groups only, in the order shortcuts, notes, todos. */
  readonly groups: readonly SearchGroup[];
  /** Sources that failed: the other groups are still valid (partial result). */
  readonly failed: readonly SearchKind[];
}

const EMPTY: SearchOutcome = { groups: [], failed: [] };

/**
 * Multi-source search (shortcuts, notes, todos). Sources are queried in parallel; one failing
 * source never prevents the others. Debouncing is the caller's job.
 */
@Injectable({ providedIn: 'root' })
export class SearchService {
  private readonly shortcuts = inject(SHORTCUT_REPOSITORY);
  private readonly notes = inject(NOTE_REPOSITORY);
  private readonly todos = inject(TODO_REPOSITORY);

  async search(query: string): Promise<SearchOutcome> {
    const term = query.trim().slice(0, SEARCH_QUERY_MAX_LENGTH).trim();
    if (term === '') return EMPTY;

    const [shortcuts, notes, todos] = await Promise.allSettled([
      this.shortcuts.search(term, SEARCH_GROUP_LIMIT),
      this.notes.search(term, SEARCH_GROUP_LIMIT),
      this.todos.search(term, SEARCH_GROUP_LIMIT),
    ]);

    const groups: SearchGroup[] = [];
    const failed: SearchKind[] = [];
    const add = (kind: SearchKind, results: readonly SearchResult[]): void => {
      if (results.length > 0) groups.push({ kind, results: results.slice(0, SEARCH_GROUP_LIMIT) });
    };

    if (shortcuts.status === 'fulfilled') {
      add(
        'shortcut',
        shortcuts.value.map((s): ShortcutResult => ({
          kind: 'shortcut',
          id: s.id,
          title: s.label,
          subtitle: s.url,
          url: s.url,
        })),
      );
    } else {
      failed.push('shortcut');
    }
    if (notes.status === 'fulfilled') {
      add(
        'note',
        notes.value.map((n): NoteResult => ({
          kind: 'note',
          id: n.id,
          title: n.title,
          ...(n.excerpt === '' ? {} : { subtitle: n.excerpt }),
          widgetInstanceId: n.widgetInstanceId,
        })),
      );
    } else {
      failed.push('note');
    }
    if (todos.status === 'fulfilled') {
      add(
        'todo',
        todos.value.map((t): TodoResult => ({
          kind: 'todo',
          id: t.id,
          title: t.title,
          completed: t.completedAt !== null,
          ...(t.excerpt === '' ? {} : { subtitle: t.excerpt }),
          widgetInstanceId: t.widgetInstanceId,
        })),
      );
    } else {
      failed.push('todo');
    }
    return { groups, failed };
  }
}
