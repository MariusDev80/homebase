import type { Provider } from '@angular/core';
import { provideWidget } from '../core/widgets';
import { helloWidget } from './hello/hello.definition';
import { notesWidget } from './notes/notes.definition';
import { pomodoroWidget } from './pomodoro/pomodoro.definition';
import { searchWidget } from './search/search.definition';
import { shortcutsWidget } from './shortcuts/shortcuts.definition';
import { timersWidget } from './timers/timers.definition';
import { todoWidget } from './todo/todo.definition';
import { weatherWidget } from './weather/weather.definition';

/** The only file that knows every widget. Imported by app.config.ts only. */
export function provideAllWidgets(): Provider[] {
  return [
    provideWidget(helloWidget),
    provideWidget(notesWidget),
    provideWidget(pomodoroWidget),
    provideWidget(searchWidget),
    provideWidget(shortcutsWidget),
    provideWidget(timersWidget),
    provideWidget(todoWidget),
    provideWidget(weatherWidget),
  ];
}
