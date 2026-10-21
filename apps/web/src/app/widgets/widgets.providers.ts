import type { Provider } from '@angular/core';
import { provideWidget } from '../core/widgets';
import { helloWidget } from './hello/hello.definition';
import { notesWidget } from './notes/notes.definition';
import { searchWidget } from './search/search.definition';
import { shortcutsWidget } from './shortcuts/shortcuts.definition';
import { todoWidget } from './todo/todo.definition';
import { weatherWidget } from './weather/weather.definition';

/** The only file that knows every widget. Imported by app.config.ts only. */
export function provideAllWidgets(): Provider[] {
  return [
    provideWidget(helloWidget),
    provideWidget(notesWidget),
    provideWidget(searchWidget),
    provideWidget(shortcutsWidget),
    provideWidget(todoWidget),
    provideWidget(weatherWidget),
  ];
}
