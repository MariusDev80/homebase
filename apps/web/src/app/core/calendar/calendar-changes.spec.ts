import { TestBed } from '@angular/core/testing';
import { CalendarChanges } from './calendar-changes';

describe('CalendarChanges', () => {
  it('starts at 0 and notify increments the version', () => {
    const changes = TestBed.inject(CalendarChanges);
    expect(changes.version()).toBe(0);
    changes.notify('reminders');
    changes.notify('todo');
    expect(changes.version()).toBe(2);
  });
});
