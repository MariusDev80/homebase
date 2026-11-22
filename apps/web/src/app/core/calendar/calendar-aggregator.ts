import { Injectable, Injector, inject, isDevMode } from '@angular/core';
import { DataError } from '../../data';
import {
  compareLocalDates,
  isValidInstant,
  isValidLocalDate,
  isValidTimeZone,
  toLocalDate,
} from '../time';
import { WidgetRegistry } from '../widgets/widget-registry';
import { assertCalendarRange, rangeLocalDates } from './calendar-range';
import {
  CALENDAR_STATUSES,
  CALENDAR_TONES,
  type CalendarEvent,
  type CalendarRange,
  type CalendarSource,
} from './calendar-source';

export const MAX_CALENDAR_EVENTS = 2000;

export interface AggregatedEvents {
  /** Deduplicated by id (first kept), sorted by day, then all-day before timed, then by start. */
  readonly events: readonly CalendarEvent[];
  /** sourceType of every source whose listEvents rejected (partial result shown). */
  readonly failedSources: readonly string[];
  /** More than MAX_CALENDAR_EVENTS events: the rest is dropped. */
  readonly truncated: boolean;
  /** At least one source failed and every failure was DataError('unavailable'). */
  readonly unavailable: boolean;
}

export interface ListEventsOptions {
  /** Widget types whose source is neither loaded nor called (unknown types are ignored). */
  readonly exclude?: readonly string[];
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

interface SortKey {
  readonly event: CalendarEvent;
  /** Day of the start, in the display zone. */
  readonly day: string;
  readonly allDay: boolean;
  /** Instant of a timed event, '' for an all-day one (no other key: the merge order is kept). */
  readonly start: string;
}

function sortKey(event: CalendarEvent, timeZone: string): SortKey {
  const time = event.time;
  return time.kind === 'all-day'
    ? { event, day: time.startOn, allDay: true, start: '' }
    : { event, day: toLocalDate(time.start, timeZone), allDay: false, start: time.start };
}

/**
 * By day, then all-day before timed, then by start for the timed ones. All-day ties keep the merge
 * order (registry order of the sources, then the order returned by each source), because
 * Array.prototype.sort is stable. This keeps the sort_order of the todo list (PV0).
 */
function compareKeys(a: SortKey, b: SortKey): number {
  if (a.day !== b.day) return compareStrings(a.day, b.day);
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  return a.allDay ? 0 : compareStrings(a.start, b.start);
}

/** Merges the events of every widget that declares a calendar source (ADR-004 3.2.2). */
@Injectable({ providedIn: 'root' })
export class CalendarAggregator {
  private readonly registry = inject(WidgetRegistry);
  private readonly injector = inject(Injector);
  private readonly sources = new Map<string, Promise<CalendarSource>>();
  private readonly inFlight = new Map<string, Promise<AggregatedEvents>>();

  /** Concurrent calls for the same range share one in-flight request. */
  async listEvents(
    range: CalendarRange,
    { exclude = [] }: ListEventsOptions = {},
  ): Promise<AggregatedEvents> {
    assertCalendarRange(range);
    const key = `${range.from}|${range.to}|${range.timeZone}|${JSON.stringify([...new Set(exclude)].sort())}`;
    const shared = this.inFlight.get(key);
    if (shared) return shared;
    const request = this.load(range, exclude);
    this.inFlight.set(key, request);
    try {
      return await request;
    } finally {
      if (this.inFlight.get(key) === request) this.inFlight.delete(key);
    }
  }

  private async load(range: CalendarRange, exclude: readonly string[]): Promise<AggregatedEvents> {
    const { firstOn, lastOn } = rangeLocalDates(range);
    const definitions = this.registry
      .list()
      .filter(
        (definition) =>
          definition.loadCalendarSource !== undefined && !exclude.includes(definition.type),
      );

    const settled = await Promise.allSettled(
      definitions.map(async (definition) => {
        const source = await this.source(definition.type);
        return source.listEvents(range);
      }),
    );

    const failedSources: string[] = [];
    let everyFailureUnavailable = true;
    const seen = new Set<string>();
    const merged: CalendarEvent[] = [];
    settled.forEach((result, index) => {
      const type = definitions[index].type;
      if (result.status === 'rejected') {
        failedSources.push(type);
        if (!(result.reason instanceof DataError && result.reason.kind === 'unavailable')) {
          everyFailureUnavailable = false;
        }
        return;
      }
      if (!Array.isArray(result.value)) {
        // A source that does not return an array is a failed source (never "unavailable").
        failedSources.push(type);
        everyFailureUnavailable = false;
        return;
      }
      for (const event of result.value) {
        if (!this.isSound(event, type, range, firstOn, lastOn) || seen.has(event.id)) continue;
        seen.add(event.id);
        merged.push(event);
      }
    });

    const sorted = merged
      .map((event) => sortKey(event, range.timeZone))
      .sort(compareKeys)
      .map((key) => key.event);
    const truncated = sorted.length > MAX_CALENDAR_EVENTS;
    return {
      events: truncated ? sorted.slice(0, MAX_CALENDAR_EVENTS) : sorted,
      failedSources,
      truncated,
      unavailable: failedSources.length > 0 && everyFailureUnavailable,
    };
  }

  /** Loaded once per widget type; a failed load is forgotten so that the next call retries. */
  private source(type: string): Promise<CalendarSource> {
    const cached = this.sources.get(type);
    if (cached) return cached;
    const definition = this.registry.get(type);
    const load = definition?.loadCalendarSource;
    if (!load) return Promise.reject(new DataError('not_found', 'No calendar source'));
    const promise = load().then((sourceClass) => this.injector.get(sourceClass));
    this.sources.set(type, promise);
    promise.catch(() => {
      if (this.sources.get(type) === promise) this.sources.delete(type);
    });
    return promise;
  }

  /** Integrity check (ADR-004 3.2.2): a bad event is dropped and reported in development. */
  private isSound(
    event: CalendarEvent,
    sourceType: string,
    range: CalendarRange,
    firstOn: string,
    lastOn: string,
  ): boolean {
    let problem: string | null;
    try {
      problem = this.problemOf(event, sourceType, range, firstOn, lastOn);
    } catch {
      problem = 'shape';
    }
    if (problem !== null && isDevMode()) {
      // Identifiers only, never titles.
      console.warn(`Calendar event dropped (${problem}): ${sourceType} ${String(event?.id)}`);
    }
    return problem === null;
  }

  private problemOf(
    event: CalendarEvent,
    sourceType: string,
    range: CalendarRange,
    firstOn: string,
    lastOn: string,
  ): string | null {
    if (event.sourceType !== sourceType) return 'source type';
    if (event.id !== `${event.sourceType}:${event.sourceId}:${event.occurrenceKey ?? ''}`) {
      return 'id';
    }
    if (!CALENDAR_TONES.includes(event.tone)) return 'tone';
    if (event.status !== undefined && !CALENDAR_STATUSES.includes(event.status)) return 'status';
    const time = event.time;
    if (event.originalOn !== undefined) {
      if (
        !isValidLocalDate(event.originalOn) ||
        time.kind !== 'all-day' ||
        compareLocalDates(event.originalOn, time.startOn) >= 0
      ) {
        return 'original';
      }
    }
    if (time.kind === 'timed') {
      if (
        !isValidInstant(time.start) ||
        (time.end !== null && !isValidInstant(time.end)) ||
        !isValidTimeZone(time.timeZone)
      ) {
        return 'time';
      }
      if (time.end !== null && time.end < time.start) return 'time';
      return time.start >= range.from && time.start < range.to ? null : 'range';
    }
    if (time.kind === 'all-day') {
      if (
        !isValidLocalDate(time.startOn) ||
        !isValidLocalDate(time.lastOn) ||
        compareLocalDates(time.startOn, time.lastOn) > 0
      ) {
        return 'time';
      }
      return compareLocalDates(time.startOn, lastOn) <= 0 &&
        compareLocalDates(time.lastOn, firstOn) >= 0
        ? null
        : 'range';
    }
    return 'time';
  }
}
