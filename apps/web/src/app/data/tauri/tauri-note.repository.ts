import type { IdGenerator } from '../clock';
import type { NewNote, Note, NoteSearchHit } from '../models';
import type { NoteRepository } from '../repositories';
import { excerptAround } from '../search';
import { invokeCommand } from './invoke-command';
import { toNote, type NoteHitWire, type NoteWire } from './wire';

/** NoteRepository over the `note_*` Rust commands. */
export class TauriNoteRepository implements NoteRepository {
  constructor(private readonly newId: IdGenerator) {}

  async get(id: string): Promise<Note | null> {
    const row = await invokeCommand<NoteWire | null>('note_get', { id });
    return row === null || row === undefined ? null : toNote(row);
  }

  async create(input: NewNote = {}): Promise<Note> {
    return toNote(
      await invokeCommand<NoteWire>('note_create', {
        input: {
          id: input.id ?? this.newId(),
          widgetInstanceId: input.widgetInstanceId ?? null,
          title: input.title ?? '',
          body: input.body ?? '',
        },
      }),
    );
  }

  async update(id: string, title: string, body: string): Promise<Note> {
    return toNote(await invokeCommand<NoteWire>('note_update', { id, title, body }));
  }

  remove(id: string): Promise<boolean> {
    return invokeCommand<boolean>('note_delete', { id });
  }

  async search(query: string, limit: number): Promise<NoteSearchHit[]> {
    const rows = await invokeCommand<NoteHitWire[]>('note_search', { query, limit });
    const term = query.trim();
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      widgetInstanceId: r.widgetInstanceId,
      excerpt: excerptAround(r.body, term),
    }));
  }
}
