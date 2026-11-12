// ExtractionSchema → TripProfile (spec/normalize.md, the source of truth). Drops values over a cap
// (ADR 0004), then nulls and empties; never changes a value. Keys are listed in schema order so
// serialized profiles stay stable for cassette keys (CLAUDE.md §8.3).
import {
  codePointLength,
  MAX_DATE_TEXT_LENGTH,
  MAX_EXPERIENCES,
  MAX_NOTE_LENGTH,
  MAX_PEOPLE,
  MAX_SHORT_TEXT_LENGTH,
  MAX_UNMAPPED_EXPERIENCES,
  type DateRange,
  type Departure,
  type ExtractionSchema,
  type Traveler,
  type TripProfile,
} from '../wire/index.ts';

/** One value `normalize` dropped for being over a cap. Server-internal: a log signal, not wire. */
export interface Discarded {
  /** JSON Pointer into the extraction, e.g. `/people/2/gender`. */
  path: string;
  reason: 'too_long' | 'too_many_items';
  /** The cap that was exceeded. */
  limit: number;
  /** The measured length in code points, or the item count. Never the value itself. */
  actual: number;
}

export interface NormalizeResult {
  profile: TripProfile;
  /** In schema field order, then index order. Empty when nothing was over a cap. */
  discarded: Discarded[];
}

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

/** Collects discards while each field is checked against its cap. */
class Caps {
  readonly discarded: Discarded[] = [];

  /** The string, or null if it is over `limit` code points. */
  text(value: string | null, limit: number, path: string): string | null {
    if (value === null) return null;
    const actual = codePointLength(value);
    if (actual <= limit) return value;
    this.discarded.push({ path, reason: 'too_long', limit, actual });
    return null;
  }

  /** The list, or null if it has more than `limit` items. Lists are never shortened. */
  list<T>(items: T[] | null, limit: number, path: string): T[] | null {
    if (items === null || items.length <= limit) return items;
    this.discarded.push({ path, reason: 'too_many_items', limit, actual: items.length });
    return null;
  }
}

function normalizeDeparture(
  departure: ExtractionSchema['departure'],
  caps: Caps,
): Departure | null {
  if (departure === null) return null;
  const { mode, maxStops } = departure;
  const city = caps.text(departure.city, MAX_SHORT_TEXT_LENGTH, '/departure/city');
  const result = compact({ city, mode, maxStops });
  return isEmpty(result) ? null : result;
}

function normalizeDateRange(range: ExtractionSchema['dateRange'], caps: Caps): DateRange | null {
  if (range === null) return null;
  if (range.kind === 'fixed') {
    // Both dates are required in the fixed variant, so either one over its cap drops the range.
    const start = caps.text(range.start, MAX_DATE_TEXT_LENGTH, '/dateRange/start');
    const end = caps.text(range.end, MAX_DATE_TEXT_LENGTH, '/dateRange/end');
    return start === null || end === null ? null : { kind: 'fixed', start, end };
  }
  const { month, year, durationNights } = range;
  const note = caps.text(range.note, MAX_NOTE_LENGTH, '/dateRange/note');
  const fields = compact({ month, year, durationNights, note });
  return isEmpty(fields) ? null : { kind: 'flexible', ...fields };
}

function normalizeUnmapped(items: string[] | null, caps: Caps): string[] | null {
  if (items === null) return null;
  const kept = items.filter(
    (item, i) => caps.text(item, MAX_SHORT_TEXT_LENGTH, `/unmappedExperiences/${i}`) !== null,
  );
  // The count cap applies after item drops (spec/normalize.md, lists).
  return caps.list(nonEmpty(kept), MAX_UNMAPPED_EXPERIENCES, '/unmappedExperiences');
}

function normalizePeople(people: ExtractionSchema['people'], caps: Caps): Traveler[] | null {
  // The count does not depend on the travelers' fields, so an over-count list is reported alone.
  const kept = caps.list(nonEmpty(people), MAX_PEOPLE, '/people');
  if (kept === null) return null;
  return kept.map(({ userType, age, gender }, i) => ({
    userType,
    ...compact({ age, gender: caps.text(gender, MAX_SHORT_TEXT_LENGTH, `/people/${i}/gender`) }),
  }));
}

export function normalize(extraction: ExtractionSchema): NormalizeResult {
  const caps = new Caps();
  // Built in schema order, so discards are reported in schema order too.
  const profile = compact({
    departure: normalizeDeparture(extraction.departure, caps),
    dateRange: normalizeDateRange(extraction.dateRange, caps),
    region: caps.text(extraction.region, MAX_SHORT_TEXT_LENGTH, '/region'),
    climate: extraction.climate,
    experiences: caps.list(nonEmpty(extraction.experiences), MAX_EXPERIENCES, '/experiences'),
    unmappedExperiences: normalizeUnmapped(extraction.unmappedExperiences, caps),
    people: normalizePeople(extraction.people, caps),
  }) as TripProfile;
  return { profile, discarded: caps.discarded };
}
