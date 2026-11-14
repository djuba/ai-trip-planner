// The month a trip starts, for the season check (WU-10 plan D5, approval change 6). Pure: the
// reference date is passed in, never read from a clock.
import type { TripProfile } from '@vp/domain-schema/wire';

export interface TripStart {
  month: number;
  year: number;
}

/**
 * Fixed range: the month and year of `start`. Flexible with a month: that month, in `year` when
 * given, else its next occurrence (the reference month itself counts as this year, as in
 * `DATE_NOT_PAST`). Year only, or no date range: null.
 */
export function tripStart(profile: TripProfile, referenceDate: string): TripStart | null {
  const range = profile.dateRange;
  if (range === null || range === undefined) return null;
  if (range.kind === 'fixed') {
    return { year: Number(range.start.slice(0, 4)), month: Number(range.start.slice(5, 7)) };
  }
  if (range.month === undefined) return null;
  if (range.year !== undefined) return { month: range.month, year: range.year };
  const referenceYear = Number(referenceDate.slice(0, 4));
  const referenceMonth = Number(referenceDate.slice(5, 7));
  return {
    month: range.month,
    year: range.month >= referenceMonth ? referenceYear : referenceYear + 1,
  };
}
