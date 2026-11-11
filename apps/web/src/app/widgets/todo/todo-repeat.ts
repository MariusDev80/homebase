import { nextRepeatDue, isLastDayOfMonth, parseDateRule } from '../../core/time/date-rule';
import type { DateRule } from '../../core/time/date-rule';
import type { LocalDateIso, Todo } from '../../data';

export type CheckAction =
  | { readonly kind: 'complete' }
  | { readonly kind: 'advance'; readonly from: LocalDateIso; readonly to: LocalDateIso };

/**
 * `advance` when the todo is active, has a due date and a rule parsed by parseDateRule, and
 * nextRepeatDue gives a date; `complete` otherwise.
 */
export function checkAction(todo: Todo, today: LocalDateIso): CheckAction {
  if (todo.completedAt !== null || todo.dueOn === null || todo.rrule === null) {
    return { kind: 'complete' };
  }
  const rule = parseDateRule(todo.rrule);
  if (rule === null) return { kind: 'complete' };
  const to = nextRepeatDue(todo.dueOn, rule, today);
  return to === null ? { kind: 'complete' } : { kind: 'advance', from: todo.dueOn, to };
}

export type RuleForm =
  | { readonly kind: 'none' }
  /** Stored rule that parseDateRule does not recognise (kept as is). */
  | { readonly kind: 'other' }
  | { readonly kind: 'rule'; readonly rule: DateRule };

export function ruleFormOf(rrule: string | null): RuleForm {
  if (rrule === null) return { kind: 'none' };
  const rule = parseDateRule(rrule);
  return rule === null ? { kind: 'other' } : { kind: 'rule', rule };
}

/** Rule to store for this due date: lastDayOfMonth dropped when dueOn is not a last day. */
export function normalizeRule(rule: DateRule, dueOn: LocalDateIso): DateRule {
  return rule.lastDayOfMonth && !isLastDayOfMonth(dueOn)
    ? { ...rule, lastDayOfMonth: false }
    : rule;
}

/** Transloco key and params of the human summary ("Toutes les 2 semaines"). */
export function ruleSummary(form: RuleForm): {
  readonly key: string;
  readonly params: Record<string, number>;
} {
  const base = 'widgets.todo.repeat.';
  if (form.kind === 'none') return { key: `${base}none`, params: {} };
  if (form.kind === 'other') return { key: `${base}summary.other`, params: {} };
  const { freq, interval, lastDayOfMonth } = form.rule;
  const name = lastDayOfMonth ? 'MONTHLY_LAST' : freq;
  return {
    key: `${base}summary.${name}_${interval === 1 ? 'one' : 'many'}`,
    params: { n: interval },
  };
}
