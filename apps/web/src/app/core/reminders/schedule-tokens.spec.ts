import { TestBed } from '@angular/core/testing';
import { REMINDER_REPOSITORY, TIME_SESSION_REPOSITORY } from '../../data/schedule.tokens';
import { TauriReminderRepository } from '../../data/tauri/tauri-reminder.repository';
import { TauriTimeSessionRepository } from '../../data/tauri/tauri-time-session.repository';

describe('schedule repository tokens', () => {
  it('provide the Tauri repositories by default', () => {
    expect(TestBed.inject(REMINDER_REPOSITORY)).toBeInstanceOf(TauriReminderRepository);
    expect(TestBed.inject(TIME_SESSION_REPOSITORY)).toBeInstanceOf(TauriTimeSessionRepository);
  });

  it('are unavailable outside Tauri', async () => {
    await expect(TestBed.inject(REMINDER_REPOSITORY).list()).rejects.toMatchObject({
      kind: 'unavailable',
    });
    await expect(TestBed.inject(TIME_SESSION_REPOSITORY).listRunning()).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });
});
