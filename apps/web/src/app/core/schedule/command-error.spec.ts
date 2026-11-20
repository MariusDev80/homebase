import { DataError } from '../../data';
import { commandErrorDetails } from './command-error';

describe('commandErrorDetails', () => {
  const wrap = (cause: unknown): DataError => new DataError('invalid_input', 'x', { cause });

  it('reads the field of an invalid_input error', () => {
    expect(commandErrorDetails(wrap({ kind: 'invalid_input', field: 'title' }))).toEqual({
      field: 'title',
    });
  });

  it('reads the nested code of a time error', () => {
    const cause = {
      kind: 'time',
      error: { kind: 'invalid_rule', code: 'count_and_until', part: null },
    };
    expect(commandErrorDetails(wrap(cause))).toEqual({
      timeKind: 'invalid_rule',
      code: 'count_and_until',
    });
    expect(commandErrorDetails(wrap({ kind: 'time', error: { kind: 'invalid_range' } }))).toEqual({
      timeKind: 'invalid_range',
    });
  });

  it('gives nothing for anything else', () => {
    expect(commandErrorDetails(wrap({ kind: 'not_found' }))).toEqual({});
    expect(commandErrorDetails(wrap('text'))).toEqual({});
    expect(commandErrorDetails(new Error('x'))).toEqual({});
    expect(commandErrorDetails(null)).toEqual({});
  });
});
