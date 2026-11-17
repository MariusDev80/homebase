import type { IdGenerator } from '../clock';
import type { Habit, HabitCheck, HabitInput, HabitSchedule } from '../models';
import type { HabitRepository } from '../repositories';
import type { LocalDateIso } from '../time-formats';
import { invokeCommand } from './invoke-command';

/** Exact wire shape of HabitScheduleDto (deny_unknown_fields on the Rust side). */
function wireSchedule(schedule: HabitSchedule): HabitSchedule {
  return schedule.kind === 'days'
    ? { kind: 'days', days: [...schedule.days] }
    : { kind: 'weekly', target: schedule.target };
}

/**
 * Exact wire shape of HabitReminderInputDto. The reminder id is generated here; Rust keeps the
 * id of the reminder the habit already has and ignores this one.
 */
function wireReminder(input: HabitInput, newId: IdGenerator): Record<string, unknown> | null {
  const reminder = input.reminder;
  if (reminder === null) return null;
  return {
    id: newId(),
    time: reminder.time,
    days: [...reminder.days],
    timeZone: reminder.timeZone,
    enabled: reminder.enabled,
  };
}

/** HabitRepository over the `habit_*` Rust commands. */
export class TauriHabitRepository implements HabitRepository {
  constructor(private readonly newId: IdGenerator) {}

  list(): Promise<Habit[]> {
    return invokeCommand<Habit[]>('habit_list', {});
  }

  create(input: HabitInput & { readonly id?: string }): Promise<Habit> {
    return invokeCommand<Habit>('habit_create', {
      input: {
        id: input.id ?? this.newId(),
        title: input.title,
        schedule: wireSchedule(input.schedule),
        startOn: input.startOn,
        reminder: wireReminder(input, this.newId),
      },
    });
  }

  update(id: string, input: HabitInput): Promise<Habit> {
    // `reminder` is always present: null removes the reminder, a missing key is refused by Rust.
    return invokeCommand<Habit>('habit_update', {
      id,
      input: {
        title: input.title,
        schedule: wireSchedule(input.schedule),
        startOn: input.startOn,
        reminder: wireReminder(input, this.newId),
      },
    });
  }

  setArchived(id: string, archived: boolean): Promise<Habit> {
    return invokeCommand<Habit>('habit_set_archived', { id, archived });
  }

  remove(id: string): Promise<boolean> {
    return invokeCommand<boolean>('habit_delete', { id });
  }

  checks(range: { readonly from: LocalDateIso; readonly to: LocalDateIso }): Promise<HabitCheck[]> {
    return invokeCommand<HabitCheck[]>('habit_checks', { from: range.from, to: range.to });
  }

  setCheck(habitId: string, dayOn: LocalDateIso, done: boolean): Promise<boolean> {
    return invokeCommand<boolean>('habit_set_check', { habitId, dayOn, done });
  }
}
