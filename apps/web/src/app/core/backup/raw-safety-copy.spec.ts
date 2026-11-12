import { RAW_SAFETY_COPY_PATTERN, rawSafetyCopyInstant } from './raw-safety-copy';

describe('rawSafetyCopyInstant', () => {
  it('turns the stamp of a valid folder name into an ISO instant', () => {
    expect(rawSafetyCopyInstant('homebase-20261021T081500.123Z-pre-restore-raw')).toBe(
      '2026-10-21T08:15:00.123Z',
    );
  });

  it.each([
    'homebase-20261021T081500.123Z-pre-restore',
    'homebase-20261021T081500.123Z-pre-restore-raw-x',
    'homebase-2026-10-21-pre-restore-raw',
    '../homebase-20261021T081500.123Z-pre-restore-raw',
    'C:\\homebase-20261021T081500.123Z-pre-restore-raw',
    '',
  ])('refuses %j', (name) => {
    expect(rawSafetyCopyInstant(name)).toBeNull();
    expect(RAW_SAFETY_COPY_PATTERN.test(name)).toBe(false);
  });
});
