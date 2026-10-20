import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { TitleStrategy, provideRouter } from '@angular/router';
import { providePrimeNG } from 'primeng/config';
import Aura from '@primeuix/themes/aura';

import { routes } from './app.routes';
import { TranslatedTitleStrategy, provideAppI18n } from './core/i18n';
import { SettingsThemePreferenceStore, THEME_PREFERENCE_STORE } from './core/theme';
import { provideDataLayer } from './data';
import { provideAllWidgets } from './widgets/widgets.providers';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideAppI18n(),
    provideDataLayer(),
    ...provideAllWidgets(),
    { provide: THEME_PREFERENCE_STORE, useExisting: SettingsThemePreferenceStore },
    { provide: TitleStrategy, useExisting: TranslatedTitleStrategy },
    providePrimeNG({
      theme: {
        preset: Aura,
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
