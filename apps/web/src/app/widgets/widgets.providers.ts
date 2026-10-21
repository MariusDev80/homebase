import type { Provider } from '@angular/core';
import { provideWidget } from '../core/widgets';
import { helloWidget } from './hello/hello.definition';
import { notesWidget } from './notes/notes.definition';
import { shortcutsWidget } from './shortcuts/shortcuts.definition';
import { todoWidget } from './todo/todo.definition';

/** The only file that knows every widget. Imported by app.config.ts only. */
export function provideAllWidgets(): Provider[] {
  return [
    provideWidget(helloWidget),
    provideWidget(notesWidget),
    provideWidget(shortcutsWidget),
    provideWidget(todoWidget),
  ];
}
