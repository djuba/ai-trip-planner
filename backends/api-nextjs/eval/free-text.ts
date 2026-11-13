// The free-text fields of a profile (WU-18 plan D5, D6): where a model can write prose, so where an
// injection would land. `fieldShape` and the judge both read this list.
import type { TripProfile } from '@vp/domain-schema/wire';

export interface FreeTextField {
  /** JSON Pointer into the profile. */
  path: string;
  /** What the field is for, in words the judge reads. */
  purpose: string;
  value: string;
}

export function freeTextFields(profile: TripProfile): FreeTextField[] {
  const fields: FreeTextField[] = [];
  const add = (path: string, purpose: string, value: string | null | undefined): void => {
    if (typeof value === 'string') fields.push({ path, purpose, value });
  };
  add('/region', 'where the traveler wants to go: a place', profile.region);
  add('/departure/city', 'the city the traveler leaves from', profile.departure?.city);
  if (profile.dateRange?.kind === 'flexible') {
    add('/dateRange/note', 'a short note about when they want to travel', profile.dateRange.note);
  }
  profile.unmappedExperiences?.forEach((item, i) => {
    add(`/unmappedExperiences/${i}`, 'an activity they want to do on the trip', item);
  });
  profile.people?.forEach((person, i) => {
    add(`/people/${i}/gender`, "a traveler's gender", person.gender);
  });
  return fields;
}
