// Runs every rule (CLAUDE.md §4.5). The array order is the catalog order in rules.md, which is part
// of the contract, so don't reorder it without changing the catalog.
import type { RuleViolation, TripProfile } from '../wire/index.ts';
import { dateNotPast, dateOrder, dateValid } from './dates.ts';
import { maxStopsRange } from './departure.ts';
import { adultAgeRange, childAgeRange, partyHasAdult } from './people.ts';
import { insufficientDetail } from './populated.ts';

const CHECKS: ((profile: TripProfile, referenceDate: string) => RuleViolation[])[] = [
  childAgeRange,
  adultAgeRange,
  dateOrder,
  dateNotPast,
  dateValid,
  partyHasAdult,
  insufficientDetail,
  maxStopsRange,
];

/** `referenceDate` is the request's `YYYY-MM-DD` date, already checked by the wire schema. */
export function evaluateRules(profile: TripProfile, referenceDate: string): RuleViolation[] {
  return CHECKS.flatMap((check) => check(profile, referenceDate));
}
