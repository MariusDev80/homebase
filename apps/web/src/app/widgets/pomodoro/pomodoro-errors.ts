import { DataError } from '../../data';

/** i18n key of the message for a failed pomodoro command (never the raw error text). */
export function pomodoroErrorKey(error: unknown): string {
  if (!(error instanceof DataError)) return 'widgets.pomodoro.errors.unknown';
  switch (error.kind) {
    case 'unavailable':
      return 'common.desktopOnly';
    case 'conflict':
      return 'widgets.pomodoro.alreadyRunning';
    case 'forbidden':
      return 'widgets.pomodoro.errors.sessionLimit';
    case 'busy':
      return 'widgets.pomodoro.errors.busy';
    case 'not_found':
      return 'widgets.pomodoro.errors.notFound';
    case 'invalid_input':
      return 'widgets.pomodoro.errors.invalid';
    default:
      return 'widgets.pomodoro.errors.unknown';
  }
}
