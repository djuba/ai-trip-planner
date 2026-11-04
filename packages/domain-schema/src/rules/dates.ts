// DATE_ORDER, DATE_NOT_PAST and DATE_VALID (rules.md). Order and past-date checks compare only
// values that pass DATE_VALID, so one bad value yields one clear violation.
import type { DateRange, RuleViolation, TripProfile } from '../wire/index.ts';
import { isCalendarDate } from './calendar.ts';

const isValidMonth = (month: number): boolean => month >= 1 && month <= 12;
const isValidYear = (year: number): boolean => year >= 2000 && year <= 2100;

export function dateOrder(profile: TripProfile): RuleViolation[] {
  const range = profile.dateRange;
  if (range?.kind !== 'fixed') return [];
  const { start, end } = range;
  if (!isCalendarDate(start) || !isCalendarDate(end) || end >= start) return [];
  return [{ code: 'DATE_ORDER', path: '/dateRange', params: { start, end } }];
}

/**
 * The flexible range's comparable value: `YYYY-MM` or `YYYY`. A month with no year means its next
 * occurrence, so it has nothing to compare, and neither does an invalid year.
 */
function flexibleValue(range: Extract<DateRange, { kind: 'flexible' }>): string | undefined {
  const { month, year } = range;
  if (year === undefined || !isValidYear(year)) return undefined;
  if (month === undefined || !isValidMonth(month)) return String(year);
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function dateNotPast(profile: TripProfile, referenceDate: string): RuleViolation[] {
  const range = profile.dateRange;
  if (!range) return [];
  if (range.kind === 'fixed') {
    const { start } = range;
    if (!isCalendarDate(start) || start >= referenceDate) return [];
    return [
      { code: 'DATE_NOT_PAST', path: '/dateRange/start', params: { value: start, referenceDate } },
    ];
  }
  const value = flexibleValue(range);
  // `YYYY-MM` and `YYYY` compare correctly against the same-length prefix of `YYYY-MM-DD`.
  if (value === undefined || value >= referenceDate.slice(0, value.length)) return [];
  return [{ code: 'DATE_NOT_PAST', path: '/dateRange', params: { value, referenceDate } }];
}

export function dateValid(profile: TripProfile): RuleViolation[] {
  const range = profile.dateRange;
  if (!range) return [];
  const bad = (field: string, value: string | number): RuleViolation => ({
    code: 'DATE_VALID',
    path: `/dateRange/${field}`,
    params: { value },
  });
  const violations: RuleViolation[] = [];
  if (range.kind === 'fixed') {
    if (!isCalendarDate(range.start)) violations.push(bad('start', range.start));
    if (!isCalendarDate(range.end)) violations.push(bad('end', range.end));
    return violations;
  }
  const { month, year, durationNights } = range;
  if (month !== undefined && !isValidMonth(month)) violations.push(bad('month', month));
  if (year !== undefined && !isValidYear(year)) violations.push(bad('year', year));
  if (durationNights !== undefined && durationNights < 1) {
    violations.push(bad('durationNights', durationNights));
  }
  return violations;
}
