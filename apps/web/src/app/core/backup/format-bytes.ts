const UNITS = ['o', 'Kio', 'Mio', 'Gio', 'Tio'] as const;
const STEP = 1024;

/** Human size in base 1024 ("1,5 Mio"); one decimal under 10, none above. */
export function formatBytes(bytes: number, locale = 'fr-FR'): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  let value = bytes;
  let unit = 0;
  while (value >= STEP && unit < UNITS.length - 1) {
    value /= STEP;
    unit++;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  const text = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
    useGrouping: false,
  }).format(value);
  return `${text} ${UNITS[unit]}`.replace(/\s/g, ' ');
}
