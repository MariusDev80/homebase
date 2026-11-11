import type { Todo, TodoChanges } from '../../data';

/**
 * The only way discrete changes (due date, repetition, flag) are combined: the most recent wins,
 * then the result is made consistent. Clearing the due date also clears the rule (a rule needs an
 * anchor). `stored` is the last saved todo; it is needed by the normalizations that depend on the
 * effective values (the "last day of the month" rule, added with the repetition lot).
 */
export function mergeChanges(stored: Todo, older: TodoChanges, newer: TodoChanges): TodoChanges {
  void stored;
  const merged: TodoChanges = { ...older, ...newer };
  if (merged.dueOn === null) merged.rrule = null;
  return merged;
}
