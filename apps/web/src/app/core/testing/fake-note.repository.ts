import { DataError } from '../../data';
import type { NewNote, Note, NoteRepository, NoteSearchHit } from '../../data';

/** In-memory NoteRepository with deterministic ids and timestamps (specs only). */
export class FakeNoteRepository implements NoteRepository {
  readonly notes = new Map<string, Note>();
  readonly calls: string[] = [];
  private counter = 0;
  private nextFailure: unknown;

  /** The next call rejects with `error`. */
  failNext(error: unknown): void {
    this.nextFailure = error;
  }

  seed(note: Partial<Note> & Pick<Note, 'id'>): Note {
    const full: Note = {
      widgetInstanceId: null,
      title: '',
      body: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...note,
    };
    this.notes.set(full.id, full);
    return full;
  }

  async get(id: string): Promise<Note | null> {
    this.record(`get:${id}`);
    return this.notes.get(id) ?? null;
  }

  async create(input: NewNote = {}): Promise<Note> {
    this.record('create');
    this.counter++;
    return this.seed({
      id: input.id ?? `note-${this.counter}`,
      widgetInstanceId: input.widgetInstanceId ?? null,
      title: input.title ?? '',
      body: input.body ?? '',
    });
  }

  async update(id: string, title: string, body: string): Promise<Note> {
    this.record(`update:${id}`);
    const existing = this.notes.get(id);
    if (!existing) {
      throw new DataError('not_found', 'Note not found');
    }
    const next = { ...existing, title, body, updatedAt: '2026-01-02T00:00:00.000Z' };
    this.notes.set(id, next);
    return next;
  }

  async remove(id: string): Promise<boolean> {
    this.record(`remove:${id}`);
    return this.notes.delete(id);
  }

  async search(query: string, limit: number): Promise<NoteSearchHit[]> {
    this.record(`search:${query}`);
    const q = query.trim().toLowerCase();
    return [...this.notes.values()]
      .filter((n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q))
      .slice(0, limit)
      .map((n) => ({
        id: n.id,
        title: n.title,
        widgetInstanceId: n.widgetInstanceId,
        excerpt: n.body.slice(0, 100),
      }));
  }

  private record(call: string): void {
    this.calls.push(call);
    if (this.nextFailure !== undefined) {
      const error = this.nextFailure;
      this.nextFailure = undefined;
      throw error;
    }
  }
}
