import type { Todo } from '../../data';
import { mergeChanges } from './todo-changes';

const STORED: Todo = {
  id: 't1',
  listId: 'l1',
  title: 'Alpha',
  description: '',
  dueOn: '2026-10-21',
  rrule: null,
  important: false,
  completedAt: null,
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('mergeChanges', () => {
  it('keeps both changes when they do not overlap', () => {
    expect(mergeChanges(STORED, { important: true }, { dueOn: '2026-11-01' })).toEqual({
      important: true,
      dueOn: '2026-11-01',
    });
  });

  it('lets the most recent change win', () => {
    expect(mergeChanges(STORED, { dueOn: '2026-11-01' }, { dueOn: '2026-12-01' })).toEqual({
      dueOn: '2026-12-01',
    });
    expect(mergeChanges(STORED, { important: true }, { important: false })).toEqual({
      important: false,
    });
  });

  it('respects the argument order: the third argument is the newer one', () => {
    expect(mergeChanges(STORED, { dueOn: '2026-12-01' }, { dueOn: '2026-11-01' }).dueOn).toBe(
      '2026-11-01',
    );
  });

  it('forces rrule to null when the due date is cleared', () => {
    expect(mergeChanges(STORED, {}, { dueOn: null })).toEqual({ dueOn: null, rrule: null });
  });

  it('drops a pending rule when a later change clears the due date', () => {
    expect(mergeChanges(STORED, { rrule: 'FREQ=DAILY' }, { dueOn: null })).toEqual({
      dueOn: null,
      rrule: null,
    });
  });

  it('does not mutate its inputs', () => {
    const older = { important: true };
    const newer = { dueOn: null };
    mergeChanges(STORED, older, newer);
    expect(older).toEqual({ important: true });
    expect(newer).toEqual({ dueOn: null });
  });

  describe('last day of the month rule', () => {
    const LAST = 'FREQ=MONTHLY;BYMONTHDAY=-1';

    it('rewrites a pending rule when the new due date is not a last day', () => {
      expect(mergeChanges(STORED, { rrule: LAST }, { dueOn: '2026-01-15' })).toEqual({
        rrule: 'FREQ=MONTHLY',
        dueOn: '2026-01-15',
      });
    });

    it('rewrites the stored rule when only the due date changes', () => {
      const stored = { ...STORED, dueOn: '2026-01-31', rrule: LAST };
      expect(mergeChanges(stored, {}, { dueOn: '2026-01-15' })).toEqual({
        dueOn: '2026-01-15',
        rrule: 'FREQ=MONTHLY',
      });
    });

    it('keeps the interval when rewriting', () => {
      const stored = {
        ...STORED,
        dueOn: '2026-01-31',
        rrule: 'FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=-1',
      };
      expect(mergeChanges(stored, {}, { dueOn: '2026-01-15' }).rrule).toBe(
        'FREQ=MONTHLY;INTERVAL=2',
      );
    });

    it('keeps the rule on a last day', () => {
      expect(mergeChanges(STORED, { rrule: LAST }, { dueOn: '2026-02-28' })).toEqual({
        rrule: LAST,
        dueOn: '2026-02-28',
      });
    });

    it('leaves an unrecognised stored rule untouched', () => {
      const stored = { ...STORED, rrule: 'FREQ=HOURLY' };
      expect(mergeChanges(stored, {}, { dueOn: '2026-01-15' })).toEqual({ dueOn: '2026-01-15' });
    });
  });
});
