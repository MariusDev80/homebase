import { ApplicationInitStatus } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { provideAppI18n } from './core/i18n';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideAppI18n(), provideRouter([])],
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
