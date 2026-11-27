import { InjectionToken } from '@angular/core';
import { randomUuid } from './clock';
import type { NoteRepository, ShortcutRepository, TodoRepository } from './repositories';
import { TauriNoteRepository } from './tauri/tauri-note.repository';
import { TauriShortcutRepository } from './tauri/tauri-shortcut.repository';
import { TauriTodoRepository } from './tauri/tauri-todo.repository';

// Kept out of provideDataLayer() and of the data barrel on purpose: their consumers (todo, notes,
// shortcuts, search widgets, calendar TODO source) are lazy, so these tokens and the Tauri
// content repositories stay out of the initial bundle. Import this file directly, never through
// the barrel. Specs override them with `{ provide, useValue: fake }`.
export const TODO_REPOSITORY = new InjectionToken<TodoRepository>('TODO_REPOSITORY', {
  providedIn: 'root',
  factory: () => new TauriTodoRepository(randomUuid),
});

export const NOTE_REPOSITORY = new InjectionToken<NoteRepository>('NOTE_REPOSITORY', {
  providedIn: 'root',
  factory: () => new TauriNoteRepository(randomUuid),
});

export const SHORTCUT_REPOSITORY = new InjectionToken<ShortcutRepository>('SHORTCUT_REPOSITORY', {
  providedIn: 'root',
  factory: () => new TauriShortcutRepository(randomUuid),
});
