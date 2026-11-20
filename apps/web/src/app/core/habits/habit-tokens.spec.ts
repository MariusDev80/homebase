import { TestBed } from '@angular/core/testing';
import { HABIT_REPOSITORY } from '../../data/schedule.tokens';
import { TauriHabitRepository } from '../../data/tauri/tauri-habit.repository';

describe('HABIT_REPOSITORY', () => {
  it('provides the Tauri repository by default, unavailable outside Tauri', async () => {
    const repo = TestBed.inject(HABIT_REPOSITORY);
    expect(repo).toBeInstanceOf(TauriHabitRepository);
    await expect(repo.list()).rejects.toMatchObject({ kind: 'unavailable' });
  });
});
