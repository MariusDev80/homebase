import type { Todo } from '../../data';
import { dueEvent, projectedEvents, projectionFloor, repeatRule } from './todo-calendar';

function todo(over: Partial<Todo> = {}): Todo {
  return {
    id: 'T',
    listId: 'L',
    title: 'Take out the bins',
    description: '',
    dueOn: '2026-11-18',
    rrule: 'FREQ=WEEKLY',
    important: false,
    sortOrder: 0,
    completedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as Todo;
}

describe('todo calendar helpers', () => {
  it('repeatRule returns the rule only for an active, dated, parseable repeating todo', () => {
    expect(repeatRule(todo())).toEqual({ freq: 'WEEKLY', interval: 1, lastDayOfMonth: false });
    expect(repeatRule(todo({ rrule: null }))).toBeNull();
    expect(repeatRule(todo({ dueOn: null }))).toBeNull();
    expect(repeatRule(todo({ completedAt: '2026-11-18T10:00:00.000Z' }))).toBeNull();
    expect(repeatRule(todo({ rrule: 'FREQ=WEEKLY;BYDAY=MO' }))).toBeNull();
    expect(repeatRule(todo({ rrule: 'FREQ=NOPE' }))).toBeNull();
  });

  it('dueEvent keys a repeating todo by its date and a plain one by null', () => {
    expect(dueEvent(todo(), '2026-11-18')).toMatchObject({
      id: 'todo:T:2026-11-18',
      occurrenceKey: '2026-11-18',
      tone: 'neutral',
    });
    expect(dueEvent(todo({ rrule: null }), '2026-11-18')).toMatchObject({
      id: 'todo:T:',
      occurrenceKey: null,
    });
    expect(
      dueEvent(todo({ rrule: 'FREQ=WEEKLY;BYDAY=MO' }), '2026-11-18').occurrenceKey,
    ).toBeNull();
  });

  it('dueEvent is danger and overdue only strictly before today', () => {
    const late = dueEvent(todo({ dueOn: '2026-11-17' }), '2026-11-18');
    expect(late).toMatchObject({ tone: 'danger', status: 'overdue' });
    const today = dueEvent(todo(), '2026-11-18');
    expect(today.status).toBeUndefined();
    expect(today.tone).toBe('neutral');
  });

  it('projectionFloor is max(dueOn, today)', () => {
    expect(projectionFloor(todo({ dueOn: '2026-11-10' }), '2026-11-18')).toBe('2026-11-18');
    expect(projectionFloor(todo({ dueOn: '2026-11-25' }), '2026-11-18')).toBe('2026-11-25');
  });

  it('projectedEvents keeps only dates strictly after the floor, projected and neutral', () => {
    const events = projectedEvents(
      todo(),
      ['2026-11-18', '2026-11-25', '2026-11-25', '2026-12-02'],
      '2026-11-18',
    );
    expect(events.map((e) => [e.id, e.occurrenceKey, e.tone, e.status])).toEqual([
      ['todo:T:2026-11-25', '2026-11-25', 'neutral', 'projected'],
      ['todo:T:2026-12-02', '2026-12-02', 'neutral', 'projected'],
    ]);
    expect(events[0].time).toEqual({
      kind: 'all-day',
      startOn: '2026-11-25',
      lastOn: '2026-11-25',
    });
  });

  it('projectedEvents skips the days between a late due date and today', () => {
    const events = projectedEvents(
      todo({ dueOn: '2026-11-10' }),
      ['2026-11-10', '2026-11-12', '2026-11-18', '2026-11-19'],
      '2026-11-18',
    );
    expect(events.map((e) => e.occurrenceKey)).toEqual(['2026-11-19']);
  });
});
