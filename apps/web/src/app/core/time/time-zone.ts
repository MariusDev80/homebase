import { DOCUMENT } from '@angular/common';
import {
  EnvironmentProviders,
  Injectable,
  InjectionToken,
  Signal,
  computed,
  inject,
  provideAppInitializer,
  signal,
} from '@angular/core';
import { SETTINGS_REPOSITORY, type TimeZoneId } from '../../data';
import { TimeError } from './time-error';
import { normalizeTimeZone } from './zoned';

export const TIME_ZONE_SETTING_KEY = 'time.zone';

/** Reads the Windows time zone. Replaceable in tests. */
export const SYSTEM_TIME_ZONE_READER = new InjectionToken<() => string>('SYSTEM_TIME_ZONE_READER', {
  providedIn: 'root',
  factory: () => () => Intl.DateTimeFormat().resolvedOptions().timeZone,
});

/** Lists the zones offered by the runtime. Replaceable in tests. */
export const SUPPORTED_TIME_ZONES_READER = new InjectionToken<() => readonly string[]>(
  'SUPPORTED_TIME_ZONES_READER',
  {
    providedIn: 'root',
    factory: () => () => Intl.supportedValuesOf('timeZone'),
  },
);

const FALLBACK_ZONE = 'UTC';

/** The user's effective time zone (ADR-003 section 3.2). */
@Injectable({ providedIn: 'root' })
export class UserTimeZone {
  private readonly settings = inject(SETTINGS_REPOSITORY);
  private readonly readSystem = inject(SYSTEM_TIME_ZONE_READER);
  private readonly readSupported = inject(SUPPORTED_TIME_ZONES_READER);

  /** Raw stored value: undefined = absent. */
  private readonly stored = signal<unknown>(undefined);
  private readonly systemRaw = signal<string>(this.safeReadSystem());

  readonly preference: Signal<TimeZoneId | null> = computed(() => {
    const raw = this.stored();
    return typeof raw === 'string' ? normalizeTimeZone(raw) : null;
  });

  readonly invalidPreference: Signal<string | null> = computed(() => {
    const raw = this.stored();
    if (raw === undefined || this.preference() !== null) return null;
    return typeof raw === 'string' ? raw : JSON.stringify(raw);
  });

  private readonly systemValid = computed(() => normalizeTimeZone(this.systemRaw()) !== null);

  readonly systemId: Signal<TimeZoneId> = computed(
    () => normalizeTimeZone(this.systemRaw()) ?? FALLBACK_ZONE,
  );

  readonly source: Signal<'setting' | 'system' | 'fallback-utc'> = computed(() => {
    if (this.preference() !== null) return 'setting';
    return this.systemValid() ? 'system' : 'fallback-utc';
  });

  readonly id: Signal<TimeZoneId> = computed(() => this.preference() ?? this.systemId());

  /** Reads the stored preference; never rejects (a failure means "follow Windows"). */
  async load(): Promise<void> {
    try {
      this.stored.set(await this.settings.get(TIME_ZONE_SETTING_KEY));
    } catch {
      this.stored.set(undefined);
    }
  }

  /** null = follow Windows. An invalid zone is rejected and nothing is written. */
  async setPreference(id: TimeZoneId | null): Promise<void> {
    if (id === null) {
      await this.settings.remove(TIME_ZONE_SETTING_KEY);
      this.stored.set(undefined);
      return;
    }
    const normalized = normalizeTimeZone(id);
    if (normalized === null) {
      throw new TimeError('unknown_time_zone', 'Unknown time zone', { value: id });
    }
    await this.settings.set(TIME_ZONE_SETTING_KEY, normalized);
    this.stored.set(normalized);
  }

  /** Re-reads the Windows time zone (start-up, window visible, focus). */
  refreshSystem(): void {
    this.systemRaw.set(this.safeReadSystem());
  }

  /** Zones for the UI: supported + UTC + system + preference, valid, unique, sorted. */
  availableTimeZones(): readonly TimeZoneId[] {
    let supported: readonly string[];
    try {
      supported = this.readSupported();
    } catch {
      supported = [];
    }
    const preference = this.preference();
    const candidates = [...supported, FALLBACK_ZONE, this.systemId()];
    if (preference !== null) candidates.push(preference);
    const unique = new Set<TimeZoneId>();
    for (const candidate of candidates) {
      const normalized = normalizeTimeZone(candidate);
      if (normalized !== null) unique.add(normalized);
    }
    return [...unique].sort();
  }

  private safeReadSystem(): string {
    try {
      return this.readSystem();
    } catch {
      return '';
    }
  }
}

/** Loads the preference at start-up and keeps the Windows zone fresh. Never fails. */
export function provideTime(): EnvironmentProviders {
  return provideAppInitializer(async () => {
    try {
      const zone = inject(UserTimeZone);
      const doc = inject(DOCUMENT);
      zone.refreshSystem();
      const refreshIfVisible = (): void => {
        if (doc.visibilityState !== 'hidden') zone.refreshSystem();
      };
      doc.addEventListener('visibilitychange', refreshIfVisible);
      doc.defaultView?.addEventListener('focus', () => zone.refreshSystem());
      await zone.load();
    } catch {
      // Time zone detection must never prevent the application from starting.
    }
  });
}
