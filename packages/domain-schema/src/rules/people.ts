// CHILD_AGE_RANGE, ADULT_AGE_RANGE and PARTY_HAS_ADULT (rules.md).
import type { RuleViolation, TripProfile, UserType } from '../wire/index.ts';

function ageViolations(
  profile: TripProfile,
  userType: UserType,
  code: 'CHILD_AGE_RANGE' | 'ADULT_AGE_RANGE',
  min: number,
  max: number,
): RuleViolation[] {
  const violations: RuleViolation[] = [];
  (profile.people ?? []).forEach((traveler, index) => {
    const { age } = traveler;
    if (traveler.userType !== userType || age === null || age === undefined) return;
    if (age < min || age > max) {
      violations.push({ code, path: `/people/${index}/age`, params: { age, min, max } });
    }
  });
  return violations;
}

export const childAgeRange = (profile: TripProfile): RuleViolation[] =>
  ageViolations(profile, 'child', 'CHILD_AGE_RANGE', 0, 17);

export const adultAgeRange = (profile: TripProfile): RuleViolation[] =>
  ageViolations(profile, 'adult', 'ADULT_AGE_RANGE', 18, 120);

export function partyHasAdult(profile: TripProfile): RuleViolation[] {
  const people = profile.people ?? [];
  if (people.length === 0 || people.some((traveler) => traveler.userType === 'adult')) return [];
  return [{ code: 'PARTY_HAS_ADULT', path: '/people', params: {} }];
}
