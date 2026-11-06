import { ApplicationInitStatus } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { DASHBOARD_REPOSITORY, SETTINGS_REPOSITORY, WIDGET_INSTANCE_REPOSITORY } from './data';
import { provideAppI18n } from './core/i18n';
import { FakeDashboardRepository } from './core/testing/fake-dashboard.repository';
import { FakeSettingsRepository } from './core/testing/fake-settings.repository';
import { FakeWidgetInstanceRepository } from './core/testing/fake-widget-instance.repository';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideAppI18n(),
        provideRouter([]),
        { provide: DASHBOARD_REPOSITORY, useValue: new FakeDashboardRepository() },
        { provide: SETTINGS_REPOSITORY, useValue: new FakeSettingsRepository() },
        { provide: WIDGET_INSTANCE_REPOSITORY, useValue: new FakeWidgetInstanceRepository() },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render the main navigation and no visible app name', async () => {
    await TestBed.inject(ApplicationInitStatus).donePromise;
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('nav')?.getAttribute('aria-label')).toBe('Navigation principale');
    expect(compiled.textContent).not.toContain('Homebase');
  });
});
