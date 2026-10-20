import {
  EnvironmentProviders,
  Injectable,
  Provider,
  inject,
  isDevMode,
  provideAppInitializer,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  provideTransloco,
  Translation,
  TranslocoLoader,
  TranslocoService,
} from '@jsverse/transloco';

export const DEFAULT_LANG = 'fr';
export const AVAILABLE_LANGS: readonly string[] = [DEFAULT_LANG];

/**
 * Translations are bundled with the app (dynamic import of the JSON file):
 * no HTTP request, works offline and under a strict CSP.
 * To add a language: add an entry here and in AVAILABLE_LANGS.
 */
const bundles: Readonly<Record<string, () => Promise<{ default: Translation }>>> = {
  fr: () => import('./fr.json'),
};

@Injectable({ providedIn: 'root' })
export class BundledTranslocoLoader implements TranslocoLoader {
  async getTranslation(lang: string): Promise<Translation> {
    const load = bundles[lang];
    if (!load) {
      throw new Error(`No bundled translations for language "${lang}"`);
    }
    return (await load()).default;
  }
}

/** i18n providers (Transloco). Widgets use Transloco only through `core/i18n`. */
export function provideAppI18n(): (Provider | EnvironmentProviders)[] {
  return [
    provideTransloco({
      config: {
        availableLangs: [...AVAILABLE_LANGS],
        defaultLang: DEFAULT_LANG,
        fallbackLang: DEFAULT_LANG,
        reRenderOnLangChange: true,
        prodMode: !isDevMode(),
        missingHandler: { logMissingKey: true, useFallbackTranslation: false },
      },
      loader: BundledTranslocoLoader,
    }),
    // Preload the default language so the first render is not blank.
    provideAppInitializer(() =>
      firstValueFrom(inject(TranslocoService).load(DEFAULT_LANG), { defaultValue: undefined }),
    ),
  ];
}
