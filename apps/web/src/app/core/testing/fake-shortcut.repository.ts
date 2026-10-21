import { DataError } from '../../data';
import type { NewShortcut, Shortcut, ShortcutFields, ShortcutRepository } from '../../data';

/** In-memory ShortcutRepository with deterministic ids and timestamps (specs only). */
export class FakeShortcutRepository implements ShortcutRepository {
  items: Shortcut[] = [];
  private counter = 0;
  private nextFailure: unknown;

  /** The next call rejects with `error`. */
  failNext(error: unknown): void {
    this.nextFailure = error;
  }

  seed(label: string, url: string): Shortcut {
    const item = this.build(label, url);
    this.items.push(item);
    return item;
  }

  async list(): Promise<Shortcut[]> {
    this.check();
    return [...this.items].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async create(input: NewShortcut): Promise<Shortcut> {
    this.check();
    const item = this.build(input.label.trim(), input.url);
    this.items.push(item);
    return item;
  }

  async update(id: string, fields: ShortcutFields): Promise<Shortcut> {
    this.check();
    const index = this.items.findIndex((s) => s.id === id);
    if (index < 0) {
      throw new DataError('not_found', 'Shortcut not found');
    }
    const next = { ...this.items[index], label: fields.label.trim(), url: fields.url };
    this.items[index] = next;
    return next;
  }

  async remove(id: string): Promise<boolean> {
    this.check();
    const before = this.items.length;
    this.items = this.items.filter((s) => s.id !== id);
    return this.items.length < before;
  }

  async reorder(ids: readonly string[]): Promise<void> {
    this.check();
    if (new Set(ids).size !== ids.length) {
      throw new DataError('invalid_input', 'Duplicate shortcut id in reorder');
    }
    // Replace the objects (no mutation): previously returned values stay untouched.
    this.items = this.items.map((item) => {
      const position = ids.indexOf(item.id);
      return position < 0 ? item : { ...item, sortOrder: position };
    });
  }

  async search(query: string, limit: number): Promise<Shortcut[]> {
    this.check();
    const q = query.trim().toLowerCase();
    return this.items
      .filter((s) => s.label.toLowerCase().includes(q) || s.url.toLowerCase().includes(q))
      .slice(0, limit);
  }

  private build(label: string, url: string): Shortcut {
    this.counter++;
    return {
      id: `shortcut-${this.counter}`,
      label,
      url,
      sortOrder: this.counter - 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
  }

  private check(): void {
    if (this.nextFailure !== undefined) {
      const error = this.nextFailure;
      this.nextFailure = undefined;
      throw error;
    }
  }
}
