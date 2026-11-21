import type { Injector } from '@angular/core';
import { TODO_REPOSITORY } from '../../data';
import { HABIT_REPOSITORY, REMINDER_REPOSITORY } from '../../data/schedule.tokens';
import { DashboardStore } from '../dashboard/dashboard.store';
import { Today, UserTimeZone, addDays, startOfDay } from '../time';
import { CalendarAggregator } from './calendar-aggregator';
import type { CalendarRange } from './calendar-source';

const SEED_PREFIX = 'pv-c1-';
const CO_SEED_PREFIX = 'pv-co-';
const TODO_WIDGET_TYPE = 'todo';

/** Lists of the todo widgets of the current dashboard, in grid order (data layer only). */
async function todoListIds(injector: Injector): Promise<string[]> {
  const todos = injector.get(TODO_REPOSITORY);
  const ids: string[] = [];
  for (const instance of injector.get(DashboardStore).instances()) {
    if (instance.widgetType !== TODO_WIDGET_TYPE) continue;
    const list = await todos.getListForInstance(instance.id);
    if (list !== null) ids.push(list.id);
  }
  return ids;
}

/** Creates `count` daily repeating todos (`pv-co-<i>`) due today in the first todo widget's list. */
export async function seedRepeatingTodos(injector: Injector, count: number): Promise<void> {
  const [listId] = await todoListIds(injector);
  if (listId === undefined) {
    throw new Error('seedRepeatingTodos: no todo widget with a list on the current dashboard');
  }
  const todos = injector.get(TODO_REPOSITORY);
  const dueOn = injector.get(Today).date();
  for (let i = 0; i < count; i++) {
    const todo = await todos.create({ listId, title: `${CO_SEED_PREFIX}${i}`, dueOn });
    await todos.update(todo.id, { rrule: 'FREQ=DAILY' });
  }
}

/** Removes the todos created by `seedRepeatingTodos`. */
export async function clearSeededTodos(injector: Injector): Promise<void> {
  const todos = injector.get(TODO_REPOSITORY);
  for (const listId of await todoListIds(injector)) {
    for (const todo of await todos.listTodos(listId)) {
      if (todo.title.startsWith(CO_SEED_PREFIX)) await todos.remove(todo.id);
    }
  }
}

/**
 * Creates `count` daily habits (`pv-co-<i>`) starting today: the first half with a reminder at
 * 20:00 in the user zone, disabled so that no real reminder fires (O10: a disabled reminder keeps its
 * time), every other one checked today (PV-CO3).
 */
export async function seedHabits(injector: Injector, count: number): Promise<void> {
  const habits = injector.get(HABIT_REPOSITORY);
  const today = injector.get(Today).date();
  const timeZone = injector.get(UserTimeZone).id();
  const everyDay = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
  for (let i = 0; i < count; i++) {
    const habit = await habits.create({
      title: `${CO_SEED_PREFIX}${i}`,
      schedule: { kind: 'days', days: everyDay },
      startOn: today,
      reminder: i < count / 2 ? { time: '20:00', days: everyDay, timeZone, enabled: false } : null,
    });
    if (i % 2 === 0) await habits.setCheck(habit.id, today, true);
  }
}

/** Removes the habits created by `seedHabits`. */
export async function clearSeededHabits(injector: Injector): Promise<void> {
  const habits = injector.get(HABIT_REPOSITORY);
  for (const habit of await habits.list()) {
    if (habit.title.startsWith(CO_SEED_PREFIX)) await habits.remove(habit.id);
  }
}

/**
 * Development only (installed from app.config.ts behind `ngDevMode`, absent from production
 * builds): exposes `window.__hbCalendar` to time the aggregator from the console (spec PV-C1).
 */
export function installCalendarDebug(injector: Injector): void {
  const aggregator = injector.get(CalendarAggregator);
  const reminders = injector.get(REMINDER_REPOSITORY);
  const today = injector.get(Today);
  const zone = injector.get(UserTimeZone);

  const tools = {
    listEvents: (range: CalendarRange) => aggregator.listEvents(range),
    /** Times listEvents over `days` days starting today (default 42, as the month grid). */
    measure: async (days = 42) => {
      const timeZone = zone.id();
      const firstOn = today.date();
      const range: CalendarRange = {
        from: startOfDay(firstOn, timeZone),
        to: startOfDay(addDays(firstOn, days), timeZone),
        timeZone,
      };
      const started = performance.now();
      const result = await aggregator.listEvents(range);
      const ms = Math.round(performance.now() - started);
      return {
        ms,
        events: result.events.length,
        failedSources: result.failedSources,
        truncated: result.truncated,
      };
    },
    /** Creates `count` daily reminders (titles `pv-c1-<i>`) starting today at 09:00. */
    seedReminders: async (count: number) => {
      const startLocal = `${today.date()}T09:00:00` as const;
      for (let i = 0; i < count; i++) {
        await reminders.create({
          title: `${SEED_PREFIX}${i}`,
          startLocal,
          timeZone: zone.id(),
          rrule: 'FREQ=DAILY',
          exdates: [],
          enabled: true,
        });
      }
    },
    /** Creates `count` daily repeating todos (`pv-co-<i>`) due today (PV-CO2). */
    seedRepeatingTodos: (count: number) => seedRepeatingTodos(injector, count),
    /** Creates `count` daily habits (`pv-co-<i>`), half with a 20:00 reminder, half checked today (PV-CO3). */
    seedHabits: (count: number) => seedHabits(injector, count),
    /** Removes the reminders, todos and habits created by the seed helpers. */
    clearSeeded: async () => {
      await clearSeededTodos(injector);
      await clearSeededHabits(injector);
      for (const reminder of await reminders.list()) {
        if (reminder.title.startsWith(SEED_PREFIX)) await reminders.remove(reminder.id);
      }
    },
  };
  Object.assign(window, { __hbCalendar: tools });
}
