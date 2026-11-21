import type { CalendarTone } from '../../core/calendar';

/** Semantic tone to text class (tokens only). Used by the Agenda for the source icon. */
export const TONE_CLASS: Readonly<Record<CalendarTone, string>> = {
  neutral: 'text-fg-muted',
  accent: 'text-accent',
  success: 'text-success',
  attention: 'text-attention',
  danger: 'text-danger',
};
