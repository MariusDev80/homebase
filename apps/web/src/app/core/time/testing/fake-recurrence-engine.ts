import type {
  ExpandRange,
  Occurrence,
  RecurrenceEngine,
  RecurrenceSpec,
} from '../recurrence-engine';

/** Test engine: returns scripted results and records the calls. No recurrence logic here. */
export class FakeRecurrenceEngine implements RecurrenceEngine {
  readonly validateCalls: RecurrenceSpec[] = [];
  readonly expandCalls: { spec: RecurrenceSpec; range: ExpandRange }[] = [];
  occurrences: readonly Occurrence[] = [];
  truncated = false;
  error: Error | null = null;
  /** When set, answers every expand call (takes precedence over occurrences/truncated/error). */
  respond:
    | ((
        spec: RecurrenceSpec,
        range: ExpandRange,
      ) => { readonly occurrences: readonly Occurrence[]; readonly truncated: boolean })
    | null = null;

  validate(
    spec: RecurrenceSpec,
  ): Promise<{ readonly rrule: string | null; readonly exdates: readonly string[] }> {
    this.validateCalls.push(spec);
    if (this.error !== null) return Promise.reject(this.error);
    return Promise.resolve({ rrule: spec.rrule, exdates: [...new Set(spec.exdates)].sort() });
  }

  expand(
    spec: RecurrenceSpec,
    range: ExpandRange,
  ): Promise<{ readonly occurrences: readonly Occurrence[]; readonly truncated: boolean }> {
    this.expandCalls.push({ spec, range });
    if (this.respond !== null) {
      try {
        return Promise.resolve(this.respond(spec, range));
      } catch (e) {
        return Promise.reject(e instanceof Error ? e : new Error(String(e)));
      }
    }
    if (this.error !== null) return Promise.reject(this.error);
    return Promise.resolve({ occurrences: this.occurrences, truncated: this.truncated });
  }
}
