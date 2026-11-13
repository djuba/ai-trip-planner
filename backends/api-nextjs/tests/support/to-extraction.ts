// Test-only helpers that turn a wire `TripProfile` into what a model would return
// (`ExtractionSchema`: every field present, null = not mentioned), and state by hand what
// `/extract` must answer for it (the drop rules of spec/normalize.md). They deliberately do not
// call `normalize`, so the fixture tests check it from the outside (WU-09 plan D7).
import type { ExtractionSchema, TripProfile } from '@vp/domain-schema/wire';

type DateRange = NonNullable<TripProfile['dateRange']>;

const dateRangeToExtraction = (range: DateRange): NonNullable<ExtractionSchema['dateRange']> =>
  range.kind === 'fixed'
    ? range
    : {
        kind: 'flexible',
        month: range.month ?? null,
        year: range.year ?? null,
        durationNights: range.durationNights ?? null,
        note: range.note ?? null,
      };

/** Fills every absent field with null, recursively, and keeps all values as they are. */
export function toExtraction(profile: TripProfile): ExtractionSchema {
  return {
    departure: profile.departure
      ? {
          city: profile.departure.city ?? null,
          mode: profile.departure.mode ?? null,
          maxStops: profile.departure.maxStops ?? null,
        }
      : null,
    dateRange: profile.dateRange ? dateRangeToExtraction(profile.dateRange) : null,
    region: profile.region ?? null,
    climate: profile.climate ?? null,
    experiences: profile.experiences ?? null,
    unmappedExperiences: profile.unmappedExperiences ?? null,
    people:
      profile.people?.map((person) => ({
        userType: person.userType,
        age: person.age ?? null,
        gender: person.gender ?? null,
      })) ?? null,
  };
}

const dropNulls = <T extends object>(value: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== null && v !== undefined),
  ) as Partial<T>;

/**
 * The profile `/extract` must answer for `toExtraction(profile)`: null fields dropped, empty arrays
 * dropped, a departure with nothing left dropped, a flexible range with only `kind` left dropped,
 * and null traveler fields dropped (spec/normalize.md, "nulls").
 */
export function expectedAfterNormalize(profile: TripProfile): TripProfile {
  const out: Record<string, unknown> = {};

  if (profile.departure) {
    const departure = dropNulls(profile.departure);
    if (Object.keys(departure).length > 0) out.departure = departure;
  }
  if (profile.dateRange) {
    if (profile.dateRange.kind === 'fixed') {
      out.dateRange = profile.dateRange;
    } else {
      const range = dropNulls(profile.dateRange);
      if (Object.keys(range).length > 1) out.dateRange = range;
    }
  }
  if (profile.region !== null && profile.region !== undefined) out.region = profile.region;
  if (profile.climate !== null && profile.climate !== undefined) out.climate = profile.climate;
  if (profile.experiences && profile.experiences.length > 0) out.experiences = profile.experiences;
  if (profile.unmappedExperiences && profile.unmappedExperiences.length > 0) {
    out.unmappedExperiences = profile.unmappedExperiences;
  }
  if (profile.people && profile.people.length > 0) {
    out.people = profile.people.map((person) => dropNulls(person));
  }
  return out;
}
