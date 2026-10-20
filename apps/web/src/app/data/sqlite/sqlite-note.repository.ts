import { Clock, IdGenerator } from '../clock';
import { DataError } from '../data-error';
import { NewNote, Note } from '../models';
import { NoteRepository } from '../repositories';
import { SqlExecutor } from '../sql-executor';
import { NOTE_COLUMNS, NoteRow, toNote } from './row-mappers';

export const NOTE_TITLE_MAX = 200;
export const NOTE_BODY_MAX = 100_000;

function assertNoteFields(title: string, body: string): void {
  if (title.length > NOTE_TITLE_MAX) {
    throw new DataError('invalid_input', `Note title must be at most ${NOTE_TITLE_MAX} characters`);
  }
  if (body.length > NOTE_BODY_MAX) {
    throw new DataError('invalid_input', `Note body must be at most ${NOTE_BODY_MAX} characters`);
  }
}

export class SqliteNoteRepository implements NoteRepository {
  constructor(
    private readonly executor: SqlExecutor,
    private readonly clock: Clock,
    private readonly newId: IdGenerator,
  ) {}

  async get(id: string): Promise<Note | null> {
    const rows = await this.executor.select<NoteRow>(
      `SELECT ${NOTE_COLUMNS} FROM notes WHERE id = $1`,
      [id],
    );
    return rows.length === 0 ? null : toNote(rows[0]);
  }

  async create(input: NewNote = {}): Promise<Note> {
    const id = input.id ?? this.newId();
    const title = input.title ?? '';
    const body = input.body ?? '';
    assertNoteFields(title, body);
    await this.executor.execute(
      'INSERT INTO notes (id, widget_instance_id, title, body, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)',
      [id, input.widgetInstanceId ?? null, title, body, this.clock.nowIso()],
    );
    return this.mustGet(id);
  }

  async update(id: string, title: string, body: string): Promise<Note> {
    assertNoteFields(title, body);
    const result = await this.executor.execute(
      'UPDATE notes SET title = $2, body = $3, updated_at = $4 WHERE id = $1',
      [id, title, body, this.clock.nowIso()],
    );
    if (result.rowsAffected === 0) {
      throw new DataError('not_found', 'Note not found');
    }
    return this.mustGet(id);
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.executor.execute('DELETE FROM notes WHERE id = $1', [id]);
    return result.rowsAffected > 0;
  }

  private async mustGet(id: string): Promise<Note> {
    const note = await this.get(id);
    if (!note) {
      throw new DataError('not_found', 'Note not found');
    }
    return note;
  }
}
