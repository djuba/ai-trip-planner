// ExtractionSchema → TripProfile (CLAUDE.md §4.4): drops nulls and empty arrays, and nothing else.
// Keys are listed in schema order so serialized profiles stay stable for cassette keys (§8.3).
import type { DateRange, Departure, ExtractionSchema, TripProfile } from '../wire/index.ts';

type Compact<T> = { [K in keyof T]?: Exclude<T[K], null> };

function compact<T extends object>(value: T): Compact<T> {
  const entries = Object.entries(value).filter(
    ([, field]) => field !== null && field !== undefined,
  );
  return Object.fromEntries(entries) as Compact<T>;
}

const isEmpty = (value: object): boolean => Object.keys(value).length === 0;

const nonEmpty = <T>(items: T[] | null): T[] | null =>
  items !== null && items.length > 0 ? items : null;

function normalizeDeparture(departure: ExtractionSchema['departure']): Departure | null {
  if (departure === null) return null;
  const { city, mode, maxStops } = departure;
  const result = compact({ city, mode, maxStops });
  return isEmpty(result) ? null : result;
}

function normalizeDateRange(range: ExtractionSchema['dateRange']): DateRange | null {
  if (range === null) return null;
  if (range.kind === 'fixed') return { kind: 'fixed', start: range.start, end: range.end };
  const { month, year, durationNights, note } = range;
  const fields = compact({ month, year, durationNights, note });
  return isEmpty(fields) ? null : { kind: 'flexible', ...fields };
}

export function normalize(extraction: ExtractionSchema): TripProfile {
  return compact({
    departure: normalizeDeparture(extraction.departure),
    dateRange: normalizeDateRange(extraction.dateRange),
    region: extraction.region,
    climate: extraction.climate,
    experiences: nonEmpty(extraction.experiences),
    unmappedExperiences: nonEmpty(extraction.unmappedExperiences),
    people: nonEmpty(extraction.people)?.map(({ userType, age, gender }) =>
      compact({ userType, age, gender }),
    ),
  }) as TripProfile;
}
