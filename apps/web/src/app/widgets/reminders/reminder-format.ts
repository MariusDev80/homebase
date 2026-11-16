import { TranslocoService } from '@jsverse/transloco';
import type { TimeDisplay } from '../../core/time';
import type { LabelFormat } from './reminder-label';

/** Binds the pure labels of `reminder-label.ts` to Transloco and the display formatter. */
export function createLabelFormat(transloco: TranslocoService, display: TimeDisplay): LabelFormat {
  return {
    t: (key, params) => transloco.translate(key, params),
    formatTime: (instant, zone) => display.formatInstant(instant, 'time', zone),
    formatDate: (date, style) => display.formatLocalDate(date, style),
  };
}
