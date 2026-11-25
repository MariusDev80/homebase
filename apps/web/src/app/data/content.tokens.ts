import { InjectionToken, inject } from '@angular/core';
import { randomUuid } from './clock';
import { CLOCK, SQL_EXECUTOR } from './data.providers';
import type { NoteRepository, ShortcutRepository, TodoRepository } from './repositories';
import { SqliteNoteRepository } from './sqlite/sqlite-note.repository';
import { SqliteShortcutRepository } from './sqlite/sqlite-shortcut.repository';
import { SqliteTodoRepository } from './sqlite/sqlite-todo.repository';

// Kept out of provideDataLayer() and of the data barrel on purpose: their consumers (todo, notes,
// shortcuts, search widgets, calendar TODO source) are lazy, so these tokens and the SQLite
// content repositories stay out of the initial bundle. Import this file directly, never through
// the barrel. Specs override them with `{ provide, useValue: fake }`.
export const TODO_REPOSITORY = new InjectionToken<TodoRepository>('TODO_REPOSITORY', {
  providedIn: 'root',
  factory: () => new SqliteTodoRepository(inject(SQL_EXECUTOR), inject(CLOCK), randomUuid),
});

export const NOTE_REPOSITORY = new InjectionToken<NoteRepository>('NOTE_REPOSITORY', {
  providedIn: 'root',
  factory: () => new SqliteNoteRepository(inject(SQL_EXECUTOR), inject(CLOCK), randomUuid),
});

export const SHORTCUT_REPOSITORY = new InjectionToken<ShortcutRepository>('SHORTCUT_REPOSITORY', {
  providedIn: 'root',
  factory: () => new SqliteShortcutRepository(inject(SQL_EXECUTOR), inject(CLOCK), randomUuid),
});
