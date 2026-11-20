import { DataError } from '../../data';
import { commandErrorKey, durationLabel, parseTimerDuration, type Translate } from './timer-format';

const t: Translate = (key, params) => `${key}:${JSON.stringify(params ?? {})}`;

describe('parseTimerDuration', () => {
  it('reads minutes and seconds', () => {
    expect(parseTimerDuration('5', '30')).toEqual({ kind: 'ok', ms: 330_000 });
    expect(parseTimerDuration('', '10')).toEqual({ kind: 'ok', ms: 10_000 });
    expect(parseTimerDuration('1440', '')).toEqual({ kind: 'ok', ms: 86_400_000 });
  });

  it('refuses out-of-range and malformed values', () => {
    expect(parseTimerDuration('0', '0')).toEqual({ kind: 'error', field: 'range' });
    expect(parseTimerDuration('', '')).toEqual({ kind: 'error', field: 'range' });
    expect(parseTimerDuration('1441', '0')).toEqual({ kind: 'error', field: 'minutes' });
    expect(parseTimerDuration('1440', '1')).toEqual({ kind: 'error', field: 'range' });
    expect(parseTimerDuration('1', '60')).toEqual({ kind: 'error', field: 'seconds' });
    expect(parseTimerDuration('-1', '0')).toEqual({ kind: 'error', field: 'minutes' });
    expect(parseTimerDuration('1.5', '0')).toEqual({ kind: 'error', field: 'minutes' });
    expect(parseTimerDuration('1e2', '0')).toEqual({ kind: 'error', field: 'minutes' });
  });
});

describe('durationLabel', () => {
  it('picks the largest units', () => {
    expect(durationLabel(34_000, t)).toBe('duration.seconds:{"s":34}');
    expect(durationLabel(12 * 60_000 + 59_000, t)).toBe('duration.minutes:{"m":12}');
    expect(durationLabel(65 * 60_000, t)).toBe('duration.short:{"h":1,"m":"05"}');
    expect(durationLabel(51 * 3_600_000, t)).toBe('duration.days:{"d":2,"h":3}');
  });
});

describe('commandErrorKey', () => {
  it('maps the error kinds', () => {
    expect(commandErrorKey(new DataError('unavailable', 'x'), 'session')).toBe(
      'common.desktopOnly',
    );
    expect(commandErrorKey(new DataError('forbidden', 'x'), 'session')).toBe(
      'widgets.timers.errors.sessionLimit',
    );
    expect(commandErrorKey(new DataError('forbidden', 'x'), 'alarm')).toBe(
      'widgets.timers.errors.reminderLimit',
    );
    expect(commandErrorKey(new DataError('busy', 'x'), 'session')).toBe(
      'widgets.timers.errors.busy',
    );
    expect(commandErrorKey(new Error('x'), 'session')).toBe('widgets.timers.errors.unknown');
  });

  it('reads the offending field of an invalid_input error', () => {
    const invalid = (cause: unknown) => new DataError('invalid_input', 'x', { cause });
    expect(commandErrorKey(invalid({ kind: 'invalid_input', field: 'label' }), 'session')).toBe(
      'widgets.timers.errors.label',
    );
    expect(commandErrorKey(invalid({ kind: 'invalid_input', field: 'title' }), 'alarm')).toBe(
      'widgets.timers.errors.label',
    );
    expect(
      commandErrorKey(invalid({ kind: 'invalid_input', field: 'durationMs' }), 'session'),
    ).toBe('widgets.timers.errors.duration');
    expect(
      commandErrorKey(
        invalid({ kind: 'time', error: { kind: 'invalid_rule', code: 'x' } }),
        'alarm',
      ),
    ).toBe('widgets.timers.errors.alarmInvalid');
    expect(commandErrorKey(invalid(undefined), 'session')).toBe('widgets.timers.errors.invalid');
  });
});
