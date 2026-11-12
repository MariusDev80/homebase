import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { TitleStrategy, provideRouter } from '@angular/router';
import { providePrimeNG } from 'primeng/config';

import { routes } from './app.routes';
import { TranslatedTitleStrategy, provideAppI18n } from './core/i18n';
import { HomebasePreset, SettingsThemePreferenceStore, THEME_PREFERENCE_STORE } from './core/theme';
import { provideTime } from './core/time';
import { provideDataLayer } from './data';
import { provideAllWidgets } from './widgets/widgets.providers';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideAppI18n(),
    provideDataLayer(),
    provideTime(),
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
