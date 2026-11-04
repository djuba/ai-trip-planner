// The populated-field count and INSUFFICIENT_DETAIL (rules.md; CLAUDE.md §4.7).
import { MIN_POPULATED_FIELDS } from '../wire/constants.ts';
import type { RuleViolation, TripProfile } from '../wire/index.ts';

// Unicode White_Space rather than trim(): JS, Python and Go trim different characters.
const isNonBlank = (value: string | null | undefined): boolean =>
  value !== null && value !== undefined && /\P{White_Space}/u.test(value);

function isDateRangePopulated(range: TripProfile['dateRange']): boolean {
  if (!range) return false;
  return range.kind === 'fixed' || range.month !== undefined || range.year !== undefined;
}

export function countPopulatedFields(profile: TripProfile): number {
  return [
    isNonBlank(profile.region),
    profile.climate !== null && profile.climate !== undefined,
    isNonBlank(profile.departure?.city),
    isDateRangePopulated(profile.dateRange),
    (profile.experiences ?? []).length > 0,
    (profile.people ?? []).length > 0,
  ].filter(Boolean).length;
}

export function insufficientDetail(profile: TripProfile): RuleViolation[] {
  const populated = countPopulatedFields(profile);
  if (populated >= MIN_POPULATED_FIELDS) return [];
  return [
    {
      code: 'INSUFFICIENT_DETAIL',
      path: '',
      params: { populated, required: MIN_POPULATED_FIELDS },
    },
  ];
}
