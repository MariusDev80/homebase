import type { Todo } from '../../data';
import { checkAction, normalizeRule, ruleFormOf, ruleSummary } from './todo-repeat';

const BASE: Todo = {
  id: 't1',
  listId: 'l1',
  title: 'Alpha',
  description: '',
  dueOn: '2026-10-19',
  rrule: 'FREQ=WEEKLY',
  important: false,
  completedAt: null,
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('checkAction', () => {
  it('advances an active todo with a recognised rule (weekly, late: next same weekday)', () => {
    expect(checkAction(BASE, '2026-10-21')).toEqual({
      kind: 'advance',
      from: '2026-10-19',
      to: '2026-10-26',
    });
  });

  it('completes a todo that is already completed', () => {
    expect(checkAction({ ...BASE, completedAt: '2026-10-20T08:00:00.000Z' }, '2026-10-21')).toEqual(
      { kind: 'complete' },
    );
  });

  it('completes a todo without rule or without due date', () => {
    expect(checkAction({ ...BASE, rrule: null }, '2026-10-21')).toEqual({ kind: 'complete' });
    expect(checkAction({ ...BASE, dueOn: null }, '2026-10-21')).toEqual({ kind: 'complete' });
  });

  it('completes a todo whose rule is not recognised', () => {
    expect(checkAction({ ...BASE, rrule: 'FREQ=WEEKLY;BYDAY=MO' }, '2026-10-21')).toEqual({
      kind: 'complete',
    });
  });

  it('completes when there is no next date within bounds', () => {
    const todo = { ...BASE, dueOn: '2199-12-31', rrule: 'FREQ=DAILY' };
    expect(checkAction(todo, '2199-12-31')).toEqual({ kind: 'complete' });
  });
});

describe('ruleFormOf', () => {
  it('tells none, other and rule apart', () => {
    expect(ruleFormOf(null)).toEqual({ kind: 'none' });
    expect(ruleFormOf('FREQ=HOURLY')).toEqual({ kind: 'other' });
    expect(ruleFormOf('FREQ=DAILY;INTERVAL=3')).toEqual({
      kind: 'rule',
      rule: { freq: 'DAILY', interval: 3, lastDayOfMonth: false },
    });
  });
});

describe('normalizeRule', () => {
  const last = { freq: 'MONTHLY', interval: 1, lastDayOfMonth: true } as const;

  it('drops the last-day flag when the due date is not a last day', () => {
    expect(normalizeRule(last, '2026-01-15')).toEqual({ ...last, lastDayOfMonth: false });
  });

  it('keeps the rule on a last day or without the flag', () => {
    expect(normalizeRule(last, '2026-01-31')).toBe(last);
    const plain = { ...last, lastDayOfMonth: false };
    expect(normalizeRule(plain, '2026-01-15')).toBe(plain);
  });
});

describe('ruleSummary', () => {
  it('picks the key by frequency, interval and last-day flag', () => {
    const rule = (
      freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY',
      interval: number,
      last = false,
    ) => ruleSummary({ kind: 'rule', rule: { freq, interval, lastDayOfMonth: last } });
    expect(rule('WEEKLY', 1)).toEqual({
      key: 'widgets.todo.repeat.summary.WEEKLY_one',
      params: { n: 1 },
    });
    expect(rule('WEEKLY', 2).key).toBe('widgets.todo.repeat.summary.WEEKLY_many');
    expect(rule('MONTHLY', 3, true).key).toBe('widgets.todo.repeat.summary.MONTHLY_LAST_many');
    expect(ruleSummary({ kind: 'other' }).key).toBe('widgets.todo.repeat.summary.other');
  });
});
