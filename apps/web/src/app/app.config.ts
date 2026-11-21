import {
  ApplicationConfig,
  Injector,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { TitleStrategy, provideRouter } from '@angular/router';
import { providePrimeNG } from 'primeng/config';

import { routes } from './app.routes';
import { TranslatedTitleStrategy, provideAppI18n } from './core/i18n';
import { HomebasePreset, SettingsThemePreferenceStore, THEME_PREFERENCE_STORE } from './core/theme';
import { provideTime } from './core/time/time-zone';
import { provideDataLayer } from './data';
import { provideAllWidgets } from './widgets/widgets.providers';

// Replaced by false in production builds, which removes the debug branch below.
declare const ngDevMode: unknown;

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideAppI18n(),
    provideDataLayer(),
    provideTime(),
    provideAppInitializer(() => {
      if (ngDevMode) {
        const injector = inject(Injector);
        // Development console tools (PV-C1): `window.__hbCalendar`. Absent from production builds.
        void import('./core/calendar/calendar-debug').then((m) => m.installCalendarDebug(injector));
      }
    }),
    ...provideAllWidgets(),
    { provide: THEME_PREFERENCE_STORE, useExisting: SettingsThemePreferenceStore },
    { provide: TitleStrategy, useExisting: TranslatedTitleStrategy },
    providePrimeNG({
      theme: {
        preset: HomebasePreset,
        options: {
          darkModeSelector: '.app-dark',
          cssLayer: {
            name: 'primeng',
            order: 'theme, base, primeng, components, utilities',
          },
        },
      },
    }),
  ],
};
