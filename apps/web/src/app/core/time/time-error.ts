export type TimeErrorCode =
  | 'invalid_instant'
  | 'invalid_local_date'
  | 'invalid_local_date_time'
  | 'out_of_range'
  | 'unknown_time_zone'
  | 'invalid_rule'
  | 'invalid_exdate'
  | 'invalid_range'
  | 'expansion_limit'
  | 'not_schedulable';

export type RuleErrorCode =
  | 'too_long'
  | 'syntax'
  | 'duplicate_part'
  | 'unsupported_part'
  | 'missing_freq'
  | 'invalid_value'
  | 'duplicate_value'
  | 'part_not_allowed'
  | 'conflicting_parts'
  | 'count_and_until'
  | 'until_not_utc'
  | 'until_kind_mismatch'
  | 'until_before_start';

export class TimeError extends Error {
  constructor(
    readonly code: TimeErrorCode,
    message: string,
    readonly detail?: {
      readonly rule?: RuleErrorCode;
      readonly part?: string;
      readonly value?: string;
    },
  ) {
    super(message);
    this.name = 'TimeError';
  }
}
