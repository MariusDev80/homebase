import { LocationStrategy, PathLocationStrategy } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { appConfig } from './app.config';

describe('appConfig', () => {
  it('uses path routing: Tauri serves index.html for unknown paths, so F5 on /settings works', () => {
    TestBed.configureTestingModule({ providers: appConfig.providers });
    expect(TestBed.inject(LocationStrategy)).toBeInstanceOf(PathLocationStrategy);
  });
});
