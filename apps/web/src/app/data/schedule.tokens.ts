import { InjectionToken } from '@angular/core';
import { randomUuid } from './clock';
import type { ReminderRepository, TimeSessionRepository } from './repositories';
import { TauriReminderRepository } from './tauri/tauri-reminder.repository';
import { TauriTimeSessionRepository } from './tauri/tauri-time-session.repository';

// Kept out of provideDataLayer() and of the data barrel on purpose: the stores that use them are
// lazy, so these tokens (and the Tauri repositories) stay out of the initial bundle. Backed by
// Rust commands, never by SQL in the front (spec timers-reminders D2). Specs override them with
// `{ provide, useValue: fake }`.
export const REMINDER_REPOSITORY = new InjectionToken<ReminderRepository>('REMINDER_REPOSITORY', {
  providedIn: 'root',
  factory: () => new TauriReminderRepository(randomUuid),
});

export const TIME_SESSION_REPOSITORY = new InjectionToken<TimeSessionRepository>(
  'TIME_SESSION_REPOSITORY',
  { providedIn: 'root', factory: () => new TauriTimeSessionRepository(randomUuid) },
);
