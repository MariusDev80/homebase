import { dueLabel } from './todo-due';

const TODAY = '2026-10-21';
const format = (date: string, style: string): string => `${style}:${date}`;
const todo = (dueOn: string | null, completedAt: string | null = null) => ({ dueOn, completedAt });

describe('dueLabel', () => {
  it('is null without a due date', () => {
    expect(dueLabel(todo(null), TODAY, format)).toBeNull();
  });

  it('says one day late, with the icon-bearing short form too', () => {
    const label = dueLabel(todo('2026-10-20'), TODAY, format);
    expect(label?.kind).toBe('overdue');
    expect(label?.daysLate).toBe(1);
    expect(label?.long).toMatchObject({ key: 'widgets.todo.overdueOne', params: { count: 1 } });
    expect(label?.short).toMatchObject({
      key: 'widgets.todo.dueShortOverdue',
      params: { count: 1 },
    });
  });

  it('says N days late', () => {
    const label = dueLabel(todo('2026-10-11'), TODAY, format);
    expect(label?.daysLate).toBe(10);
    expect(label?.long).toMatchObject({ key: 'widgets.todo.overdueMany', params: { count: 10 } });
    expect(label?.short).toMatchObject({ params: { count: 10 } });
  });

  it('says today and tomorrow in both forms', () => {
    const today = dueLabel(todo(TODAY), TODAY, format);
    expect(today?.kind).toBe('today');
    expect(today?.long.key).toBe('widgets.todo.dueToday');
    expect(today?.short).toEqual(today?.long);
    const tomorrow = dueLabel(todo('2026-10-22'), TODAY, format);
    expect(tomorrow?.kind).toBe('tomorrow');
    expect(tomorrow?.short.key).toBe('widgets.todo.dueTomorrow');
  });

  it('uses day-month for a later date of the same year', () => {
    const label = dueLabel(todo('2026-12-25'), TODAY, format);
    expect(label?.kind).toBe('date');
    expect(label?.long).toMatchObject({ key: null, text: 'day-month:2026-12-25' });
  });

  it('uses the short style with the year for another year', () => {
    expect(dueLabel(todo('2027-01-03'), TODAY, format)?.long.text).toBe('short:2027-01-03');
  });

  it('never reports a completed todo as late', () => {
    const label = dueLabel(todo('2026-10-01', '2026-10-02T08:00:00.000Z'), TODAY, format);
    expect(label?.kind).toBe('date');
    expect(label?.daysLate).toBe(0);
    expect(label?.long.text).toBe('day-month:2026-10-01');
  });
});
