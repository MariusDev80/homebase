import { formatDateRule } from '../../core/time/date-rule';
import type { Todo, TodoChanges } from '../../data';
import { normalizeRule, ruleFormOf } from './todo-repeat';

/**
 * The only way discrete changes (due date, repetition, flag) are combined: the most recent wins,
 * then the result is made consistent. Clearing the due date also clears the rule (a rule needs an
 * anchor). A "last day of the month" rule is rewritten without it when the effective due date is
 * not a last day (`stored` supplies the values the changes do not mention).
 */
export function mergeChanges(stored: Todo, older: TodoChanges, newer: TodoChanges): TodoChanges {
  const merged: TodoChanges = { ...older, ...newer };
  if (merged.dueOn === null) merged.rrule = null;
  const dueOn = 'dueOn' in merged ? merged.dueOn : stored.dueOn;
  const rrule = 'rrule' in merged ? merged.rrule : stored.rrule;
  if (dueOn != null && rrule != null) {
    const form = ruleFormOf(rrule);
    if (form.kind === 'rule' && form.rule.lastDayOfMonth) {
      const normalized = normalizeRule(form.rule, dueOn);
      if (normalized !== form.rule) merged.rrule = formatDateRule(normalized);
    }
  }
  return merged;
}
