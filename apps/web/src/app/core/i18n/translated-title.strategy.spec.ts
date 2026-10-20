import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { TitleStrategy, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Component } from '@angular/core';
import { TranslatedTitleStrategy } from './translated-title.strategy';
import { provideAppI18n } from './i18n.providers';

@Component({ template: '' })
class BlankComponent {}

describe('TranslatedTitleStrategy', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideAppI18n(),
        provideRouter([
          { path: 'page', title: 'pages.settings.title', component: BlankComponent },
          { path: 'untitled', component: BlankComponent },
        ]),
        { provide: TitleStrategy, useExisting: TranslatedTitleStrategy },
      ],
    });
  });

  it('sets the translated window title', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/page');
    await vi.waitFor(() => expect(TestBed.inject(Title).getTitle()).toBe('Homebase — Réglages'));
  });

  it('falls back to the app name when the route has no title', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/untitled');
    await vi.waitFor(() => expect(TestBed.inject(Title).getTitle()).toBe('Homebase'));
  });
});
