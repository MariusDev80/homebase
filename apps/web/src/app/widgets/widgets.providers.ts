import type { Provider } from '@angular/core';
import { provideWidget } from '../core/widgets';
import { helloWidget } from './hello/hello.definition';

/** The only file that knows every widget. Imported by app.config.ts only. */
export function provideAllWidgets(): Provider[] {
  return [provideWidget(helloWidget)];
}
