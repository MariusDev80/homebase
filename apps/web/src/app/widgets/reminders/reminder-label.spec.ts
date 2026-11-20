import fr from '../../core/i18n/fr.json';
import { Temporal } from '../../core/time';
import type { ReminderDelivery } from '../../data';
import {
  deliveryLabel,
  recurrenceLabel,
  upcomingLabel,
  zoneCity,
  zoneSuffix,
} from './reminder-label';
import type { LabelFormat } from './reminder-label';

function lookup(key: string): string {
  const found = key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node !== null && typeof node === 'object'
          ? (node as Record<string, unknown>)[part]
          : undefined,
      fr,
    );
  return typeof found === 'string' ? found : key;
}

const DATE_OPTIONS: Record<string, Intl.DateTimeFormatOptions> = {
  'weekday-short': { weekday: 'short', day: 'numeric' },
  'day-month': { day: 'numeric', month: 'short' },
  short: { day: 'numeric', month: 'short', year: 'numeric' },
  'weekday-day-month': { weekday: 'short', day: 'numeric', month: 'short' },
};

const fmt: LabelFormat = {
  t: (key, params) =>
    lookup(key).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => String(params?.[name] ?? '')),
  formatTime: (instant, zone) =>
    new Intl.DateTimeFormat('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: zone,
    }).format(Temporal.Instant.from(instant).epochMilliseconds),
  formatDate: (date, style) =>
    new Intl.DateTimeFormat('fr-FR', { ...DATE_OPTIONS[style], timeZone: 'UTC' }).format(
      Temporal.Instant.from(`${date}T00:00:00Z`).epochMilliseconds,
    ),
};

// 11:00 on Monday 2026-11-16 in Paris.
const NOW = '2026-11-16T10:00:00.000Z';
const PARIS = 'Europe/Paris';

describe('upcomingLabel', () => {
  const label = (at: string, key: string, userZone = PARIS) =>
    upcomingLabel(at, key, PARIS, NOW, userZone, fmt);

  it('says today and tomorrow', () => {
    expect(label('2026-11-16T14:00:00.000Z', '2026-11-16T15:00:00')).toBe("Aujourd'hui 15:00");
    expect(label('2026-11-17T08:00:00.000Z', '2026-11-17T09:00:00')).toBe('Demain 09:00');
  });

  it('uses the short weekday up to 6 days ahead', () => {
    expect(label('2026-11-20T08:00:00.000Z', '2026-11-20T09:00:00')).toMatch(/^ven\.? 20 09:00$/);
    expect(label('2026-11-22T08:00:00.000Z', '2026-11-22T09:00:00')).toMatch(/^dim\.? 22 09:00$/);
  });

  it('shows the month beyond 6 days', () => {
    expect(label('2026-11-23T08:00:00.000Z', '2026-11-23T09:00:00')).toMatch(/^23 nov\.? 09:00$/);
  });

  it('counts the day in the user zone, not in UTC', () => {
    // 23:30 UTC on the 16th is already the 17th in Paris.
    expect(label('2026-11-16T23:30:00.000Z', '2026-11-17T00:30:00')).toBe('Demain 00:30');
  });

  it('adds the nominal time when the reminder zone differs', () => {
    // 09:00 in Paris is 03:00 in New York (EST).
    expect(label('2026-11-17T08:00:00.000Z', '2026-11-17T09:00:00', 'America/New_York')).toBe(
      'Demain 03:00 (09:00 Paris)',
    );
  });
});

describe('zone helpers', () => {
  it('names the city and hides the suffix for the same zone', () => {
    expect(zoneCity('America/Argentina/Buenos_Aires')).toBe('Buenos Aires');
    expect(zoneSuffix('2026-11-17T09:00:00', PARIS, PARIS)).toBe('');
    expect(zoneSuffix(null, PARIS, 'UTC')).toBe('');
  });
});

describe('deliveryLabel', () => {
  function delivery(change: Partial<ReminderDelivery>): ReminderDelivery {
    return {
      reminderId: 'r',
      title: 'T',
      timeZone: PARIS,
      occurrenceKey: '2026-11-16T09:00:00',
      dueAt: '2026-11-16T08:00:00.000Z',
      outcome: 'on_time',
      skippedCount: 0,
      seenAt: null,
      createdAt: NOW,
      ...change,
    };
  }

  it('shows the time of a delivery of today', () => {
    expect(deliveryLabel(delivery({}), NOW, PARIS, fmt)).toBe('09:00');
  });

  it('prefixes a missed delivery and shows the month', () => {
    const label = deliveryLabel(
      delivery({ outcome: 'missed', dueAt: '2026-11-09T08:00:00.000Z' }),
      NOW,
      PARIS,
      fmt,
    );
    expect(label).toMatch(/^manqué · lun\.? 9 nov\.?, 09:00$/);
  });

  it('shows the day and month of a late delivery', () => {
    expect(
      deliveryLabel(
        delivery({ outcome: 'late', dueAt: '2026-11-14T08:00:00.000Z' }),
        NOW,
        PARIS,
        fmt,
      ),
    ).toMatch(/^sam\.? 14 nov\.?, 09:00$/);
  });
});

describe('recurrenceLabel', () => {
  const label = (rrule: string | null, start = '2026-11-16T09:00:00') =>
    recurrenceLabel(rrule, start, PARIS, fmt);

  it.each([
    [null, 'Une fois à 09:00'],
    ['FREQ=DAILY', 'Tous les jours à 09:00'],
    ['FREQ=DAILY;INTERVAL=3', 'Tous les 3 jours à 09:00'],
    ['FREQ=WEEKLY;BYDAY=MO,WE', 'Chaque lundi et mercredi à 09:00'],
    ['FREQ=WEEKLY;BYDAY=MO,TU,FR', 'Chaque lundi, mardi et vendredi à 09:00'],
    ['FREQ=WEEKLY', 'Chaque lundi à 09:00'],
    ['FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', 'Toutes les 2 semaines : lundi à 09:00'],
    ['FREQ=MONTHLY;BYMONTHDAY=16', 'Le 16 de chaque mois à 09:00'],
    ['FREQ=MONTHLY;BYMONTHDAY=1', 'Le 1er de chaque mois à 09:00'],
    ['FREQ=MONTHLY;BYMONTHDAY=-1', 'Le dernier jour du mois à 09:00'],
    ['FREQ=MONTHLY;BYDAY=-1FR', 'Le dernier vendredi du mois à 09:00'],
    ['FREQ=MONTHLY;BYDAY=2TU', 'Le 2e mardi du mois à 09:00'],
    ['FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=16', 'Le 16, tous les 3 mois, à 09:00'],
    ['FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=-1', 'Le dernier jour, tous les 2 mois, à 09:00'],
    ['FREQ=MONTHLY;INTERVAL=2;BYDAY=2TU', 'Le 2e mardi, tous les 2 mois, à 09:00'],
    ['FREQ=DAILY;COUNT=5', 'Tous les jours à 09:00, 5 fois'],
    ['FREQ=NOPE', 'Règle personnalisée'],
  ])('%s gives "%s"', (rrule, expected) => {
    expect(label(rrule)).toBe(expected);
  });

  it('writes the end date with its year, in the zone of the reminder', () => {
    expect(label('FREQ=DAILY;UNTIL=20261231T225959Z')).toMatch(
      /^Tous les jours à 09:00, jusqu'au 31 déc\.? 2026$/,
    );
    // 23:59:59 local in Tokyo is 14:59:59 UTC the same day.
    expect(
      recurrenceLabel(
        'FREQ=DAILY;UNTIL=20261231T145959Z',
        '2026-11-16T09:00:00',
        'Asia/Tokyo',
        fmt,
      ),
    ).toMatch(/jusqu'au 31 déc\.? 2026$/);
  });

  it('writes the yearly date', () => {
    expect(label('FREQ=YEARLY')).toMatch(/^Tous les ans le 16 nov\.? à 09:00$/);
  });
});
