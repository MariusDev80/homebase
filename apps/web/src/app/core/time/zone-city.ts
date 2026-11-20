import type { TimeZoneId } from '../../data';

/** "Paris" for `Europe/Paris`, "Buenos Aires" for `America/Argentina/Buenos_Aires`. */
export function zoneCity(zone: TimeZoneId): string {
  const last = zone.split('/').pop() ?? zone;
  return last.replace(/_/g, ' ');
}
