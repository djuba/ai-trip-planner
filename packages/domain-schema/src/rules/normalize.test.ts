import { describe, expect, it } from 'vitest';
import { buildFixture } from '../../tests/support/build-fixture.ts';
import {
  ExtractionSchema,
  MAX_DATE_TEXT_LENGTH,
  MAX_EXPERIENCES,
  MAX_NOTE_LENGTH,
  MAX_PEOPLE,
  MAX_SHORT_TEXT_LENGTH,
  MAX_UNMAPPED_EXPERIENCES,
  TripProfile,
} from '../wire/index.ts';
import { normalize } from './index.ts';

const allNull = {
  departure: null,
  dateRange: null,
  region: null,
  climate: null,
  experiences: null,
  unmappedExperiences: null,
  people: null,
};

const extraction = (overrides: Record<string, unknown>): ExtractionSchema =>
  buildFixture(ExtractionSchema, { ...allNull, ...overrides });

const flexible = (fields: Record<string, unknown>) => ({
  kind: 'flexible',
  month: null,
  year: null,
  durationNights: null,
  note: null,
  ...fields,
});

const ORDERED_JSON =
  '{"departure":{"city":"MSP","mode":"plane","maxStops":1},' +
  '"dateRange":{"kind":"flexible","month":6,"year":2027,"durationNights":7,"note":"n"},' +
  '"region":"r","climate":"warm","experiences":["beach"],"unmappedExperiences":["x"],' +
  '"people":[{"userType":"adult","age":30,"gender":"f"}]}';

describe('normalize', () => {
  it('AC-RULES-36: all-null extraction yields {}', () => {
    expect(normalize(extraction({})).profile).toEqual({});
    expect(JSON.stringify(normalize(extraction({})).profile)).toBe('{}');
  });

  it('AC-RULES-37: drops empty arrays for experiences, unmappedExperiences and people', () => {
    const { profile: result } = normalize(
      extraction({ experiences: [], unmappedExperiences: [], people: [] }),
    );
    expect(result).toEqual({});
    expect(Object.keys(result)).toEqual([]);
  });

  it('AC-RULES-37: keeps non-empty arrays', () => {
    const { profile: result } = normalize(
      extraction({
        experiences: ['beach'],
        unmappedExperiences: ['sailing'],
        people: [{ userType: 'adult', age: null, gender: null }],
      }),
    );
    expect(result).toEqual({
      experiences: ['beach'],
      unmappedExperiences: ['sailing'],
      people: [{ userType: 'adult' }],
    });
  });

  it('AC-RULES-37: drops null subfields of departure and people', () => {
    const { profile: result } = normalize(
      extraction({
        departure: { city: 'Minneapolis', mode: null, maxStops: null },
        people: [{ userType: 'child', age: 9, gender: null }],
      }),
    );
    expect(result).toEqual({
      departure: { city: 'Minneapolis' },
      people: [{ userType: 'child', age: 9 }],
    });
  });

  it('AC-RULES-37: drops a departure whose fields are all null', () => {
    const { profile: result } = normalize(
      extraction({ departure: { city: null, mode: null, maxStops: null } }),
    );
    expect(result).toEqual({});
  });

  it('AC-RULES-37: keeps maxStops 0', () => {
    const { profile: result } = normalize(
      extraction({ departure: { city: null, mode: null, maxStops: 0 } }),
    );
    expect(result).toEqual({ departure: { maxStops: 0 } });
  });

  it('AC-RULES-37: keeps age 0', () => {
    const { profile: result } = normalize(
      extraction({ people: [{ userType: 'child', age: 0, gender: null }] }),
    );
    expect(result).toEqual({ people: [{ userType: 'child', age: 0 }] });
  });

  it('AC-RULES-38: a flexible range loses its nulls', () => {
    const { profile: result } = normalize(
      extraction({ dateRange: flexible({ month: 6, year: 2027 }) }),
    );
    expect(result).toEqual({ dateRange: { kind: 'flexible', month: 6, year: 2027 } });
  });

  it('AC-RULES-38: an all-null flexible range is dropped', () => {
    expect(normalize(extraction({ dateRange: flexible({}) })).profile).toEqual({});
  });

  it('AC-RULES-38: a flexible range with only note is kept', () => {
    const { profile: result } = normalize(
      extraction({ dateRange: flexible({ note: 'sometime in fall' }) }),
    );
    expect(result).toEqual({ dateRange: { kind: 'flexible', note: 'sometime in fall' } });
  });

  it('AC-RULES-38: keeps flexible month 0 and durationNights 0 (no range checks)', () => {
    const { profile: result } = normalize(
      extraction({ dateRange: flexible({ month: 0, durationNights: 0 }) }),
    );
    expect(result).toEqual({ dateRange: { kind: 'flexible', month: 0, durationNights: 0 } });
  });

  it('AC-RULES-38: a fixed range is unchanged, even when malformed', () => {
    const malformed = { kind: 'fixed', start: '2027-6-1', end: '' };
    expect(normalize(extraction({ dateRange: malformed })).profile).toEqual({
      dateRange: malformed,
    });
    const ok = { kind: 'fixed', start: '2027-06-01', end: '2027-06-08' };
    expect(normalize(extraction({ dateRange: ok })).profile).toEqual({ dateRange: ok });
  });

  it('AC-RULES-39: strings are untouched, including empty and whitespace', () => {
    const { profile: result } = normalize(
      extraction({
        region: '',
        departure: { city: '  ', mode: null, maxStops: null },
        unmappedExperiences: [' yoga ', ''],
        people: [{ userType: 'adult', age: null, gender: ' ' }],
      }),
    );
    expect(result).toEqual({
      departure: { city: '  ' },
      region: '',
      unmappedExperiences: [' yoga ', ''],
      people: [{ userType: 'adult', gender: ' ' }],
    });
  });

  it('AC-RULES-39: the result parses against TripProfile', () => {
    const { profile: result } = normalize(
      extraction({
        departure: { city: 'MSP', mode: 'plane', maxStops: 0 },
        dateRange: flexible({ month: 6, note: 'summer' }),
        region: 'Caribbean',
        climate: 'tropical',
        experiences: ['beach', 'snorkeling'],
        unmappedExperiences: ['sailing'],
        people: [
          { userType: 'adult', age: 40, gender: 'f' },
          { userType: 'child', age: 0, gender: null },
        ],
      }),
    );
    expect(TripProfile.safeParse(result).success).toBe(true);
  });

  it('AC-RULES-39: keys come out in schema order', () => {
    const { profile: result } = normalize(
      extraction({
        departure: { city: 'MSP', mode: 'plane', maxStops: 1 },
        dateRange: flexible({ month: 6, year: 2027, durationNights: 7, note: 'n' }),
        region: 'r',
        climate: 'warm',
        experiences: ['beach'],
        unmappedExperiences: ['x'],
        people: [{ userType: 'adult', age: 30, gender: 'f' }],
      }),
    );
    expect(Object.keys(result)).toEqual([
      'departure',
      'dateRange',
      'region',
      'climate',
      'experiences',
      'unmappedExperiences',
      'people',
    ]);
    expect(JSON.stringify(result)).toBe(ORDERED_JSON);
  });

  it('AC-RULES-39: key order follows the schema even when input keys are reordered', () => {
    // Cast directly: Zod's parse (inside buildFixture) would itself reorder the keys.
    const reordered = {
      people: [{ gender: 'f', age: 30, userType: 'adult' }],
      unmappedExperiences: ['x'],
      experiences: ['beach'],
      climate: 'warm',
      region: 'r',
      dateRange: { note: 'n', durationNights: 7, year: 2027, month: 6, kind: 'flexible' },
      departure: { maxStops: 1, mode: 'plane', city: 'MSP' },
    } as unknown as ExtractionSchema;
    expect(JSON.stringify(normalize(reordered).profile)).toBe(ORDERED_JSON);
  });
});

// ---------- Discards (ADR 0004, spec/normalize.md). The fixtures in spec/fixtures/normalize/ cover
// the resulting profiles; these tests cover the TS-only discard report. ----------

const over = (n: number) => 'a'.repeat(n + 1);
const PALM = '\u{1F334}'; // 1 code point, 2 UTF-16 units
const palms = (n: number) => PALM.repeat(n);

describe('normalize: discard report', () => {
  it('AC-LIMITS-07: reports an over-long string with path, cap and length, never its value', () => {
    const { discarded } = normalize(extraction({ region: palms(MAX_SHORT_TEXT_LENGTH + 1) }));
    expect(discarded).toEqual([{ path: '/region', reason: 'too_long', limit: 100, actual: 101 }]);
    expect(JSON.stringify(discarded)).not.toContain(PALM);
  });

  it('AC-LIMITS-07: a value exactly at its cap, in astral characters, is kept with no report', () => {
    const region = palms(MAX_SHORT_TEXT_LENGTH);
    expect(region.length).toBe(2 * MAX_SHORT_TEXT_LENGTH); // counting UTF-16 units would drop it
    expect(normalize(extraction({ region }))).toEqual({ profile: { region }, discarded: [] });
  });

  it('AC-LIMITS-07: reports city, note and gender at their own paths', () => {
    const { discarded } = normalize(
      extraction({
        departure: { city: over(MAX_SHORT_TEXT_LENGTH), mode: 'plane', maxStops: null },
        dateRange: flexible({ month: 6, note: over(MAX_NOTE_LENGTH) }),
        people: [
          { userType: 'adult', age: 40, gender: null },
          { userType: 'adult', age: 38, gender: over(MAX_SHORT_TEXT_LENGTH) },
        ],
      }),
    );
    expect(discarded.map((d) => [d.path, d.limit])).toEqual([
      ['/departure/city', MAX_SHORT_TEXT_LENGTH],
      ['/dateRange/note', MAX_NOTE_LENGTH],
      ['/people/1/gender', MAX_SHORT_TEXT_LENGTH],
    ]);
  });

  it('AC-LIMITS-08: reports each over-long fixed date, and the range is dropped', () => {
    const long = over(MAX_DATE_TEXT_LENGTH);
    const result = normalize(extraction({ dateRange: { kind: 'fixed', start: long, end: long } }));
    expect(result.profile).toEqual({});
    expect(result.discarded).toEqual([
      { path: '/dateRange/start', reason: 'too_long', limit: 32, actual: 33 },
      { path: '/dateRange/end', reason: 'too_long', limit: 32, actual: 33 },
    ]);
  });

  it('AC-LIMITS-09: reports a dropped item by its extraction index, then the list count', () => {
    const items = [
      ...Array.from({ length: MAX_UNMAPPED_EXPERIENCES + 1 }, (_, i) => `x${i}`),
      over(MAX_SHORT_TEXT_LENGTH),
    ];
    expect(normalize(extraction({ unmappedExperiences: items })).discarded).toEqual([
      { path: '/unmappedExperiences/11', reason: 'too_long', limit: 100, actual: 101 },
      { path: '/unmappedExperiences', reason: 'too_many_items', limit: 10, actual: 11 },
    ]);
  });

  it('AC-LIMITS-09: an over-count people list is reported alone, not traveler by traveler', () => {
    const people = Array.from({ length: MAX_PEOPLE + 1 }, () => ({
      userType: 'adult',
      age: null,
      gender: over(MAX_SHORT_TEXT_LENGTH),
    }));
    expect(normalize(extraction({ people })).discarded).toEqual([
      { path: '/people', reason: 'too_many_items', limit: 50, actual: 51 },
    ]);
  });

  it('AC-LIMITS-09: reports an over-count experiences list', () => {
    const experiences = Array.from({ length: MAX_EXPERIENCES + 1 }, () => 'beach');
    expect(normalize(extraction({ experiences })).discarded).toEqual([
      { path: '/experiences', reason: 'too_many_items', limit: 20, actual: 21 },
    ]);
  });

  it('AC-LIMITS-09: reports discards in schema field order', () => {
    const { discarded } = normalize(
      extraction({
        people: [{ userType: 'adult', age: null, gender: over(MAX_SHORT_TEXT_LENGTH) }],
        region: over(MAX_SHORT_TEXT_LENGTH),
        departure: { city: over(MAX_SHORT_TEXT_LENGTH), mode: null, maxStops: null },
      }),
    );
    expect(discarded.map((d) => d.path)).toEqual([
      '/departure/city',
      '/region',
      '/people/0/gender',
    ]);
  });
});

/** Builds an extraction holding one capped value of `n` code points (from `unit`) or `n` items. */
type Build = (n: number, unit: string) => Record<string, unknown>;

const CAPPED: [string, Build, number][] = [
  ['region', (n, u) => ({ region: u.repeat(n) }), MAX_SHORT_TEXT_LENGTH],
  [
    'departure.city',
    (n, u) => ({ departure: { city: u.repeat(n), mode: null, maxStops: null } }),
    MAX_SHORT_TEXT_LENGTH,
  ],
  [
    'people[].gender',
    (n, u) => ({ people: [{ userType: 'adult', age: null, gender: u.repeat(n) }] }),
    MAX_SHORT_TEXT_LENGTH,
  ],
  ['dateRange.note', (n, u) => ({ dateRange: flexible({ note: u.repeat(n) }) }), MAX_NOTE_LENGTH],
  [
    'dateRange.start',
    (n, u) => ({ dateRange: { kind: 'fixed', start: u.repeat(n), end: 'x' } }),
    MAX_DATE_TEXT_LENGTH,
  ],
  [
    'dateRange.end',
    (n, u) => ({ dateRange: { kind: 'fixed', start: 'x', end: u.repeat(n) } }),
    MAX_DATE_TEXT_LENGTH,
  ],
  [
    'unmappedExperiences[]',
    (n, u) => ({ unmappedExperiences: [u.repeat(n)] }),
    MAX_SHORT_TEXT_LENGTH,
  ],
  [
    'unmappedExperiences count',
    (n) => ({ unmappedExperiences: Array.from({ length: n }, (_, i) => `x${i}`) }),
    MAX_UNMAPPED_EXPERIENCES,
  ],
  [
    'experiences count',
    (n) => ({ experiences: Array.from({ length: n }, () => 'beach') }),
    MAX_EXPERIENCES,
  ],
  [
    'people count',
    (n) => ({
      people: Array.from({ length: n }, () => ({ userType: 'child', age: 5, gender: null })),
    }),
    MAX_PEOPLE,
  ],
];

const UNITS: [string, string][] = [
  ['ASCII', 'a'],
  ['astral', PALM],
  ['lone surrogate', '\uD83C'],
];

describe('AC-LIMITS-10: normalize output always parses against TripProfile', () => {
  const cases = CAPPED.flatMap(([field, build, cap]) =>
    UNITS.flatMap(([unitName, unit]) =>
      [cap, cap + 1].map((n) => ({
        label: `${field}, ${unitName}, ${n === cap ? 'at the cap' : 'cap + 1'}`,
        input: extraction(build(n, unit)),
        kept: n === cap,
      })),
    ),
  );

  it.each(cases)('AC-LIMITS-10: $label', ({ input, kept }) => {
    const { profile, discarded } = normalize(input);
    const parsed = TripProfile.safeParse(profile);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(discarded.length === 0).toBe(kept);
  });

  it('AC-LIMITS-10: every capped value over its cap at once', () => {
    const { profile, discarded } = normalize(
      extraction({
        departure: { city: over(MAX_SHORT_TEXT_LENGTH), mode: null, maxStops: null },
        dateRange: { kind: 'fixed', start: over(MAX_DATE_TEXT_LENGTH), end: '2027-06-08' },
        region: over(MAX_SHORT_TEXT_LENGTH),
        climate: 'warm',
        experiences: Array.from({ length: MAX_EXPERIENCES + 1 }, () => 'beach'),
        unmappedExperiences: [over(MAX_SHORT_TEXT_LENGTH)],
        people: Array.from({ length: MAX_PEOPLE + 1 }, () => ({
          userType: 'adult',
          age: null,
          gender: null,
        })),
      }),
    );
    expect(TripProfile.safeParse(profile).success).toBe(true);
    expect(profile).toEqual({ climate: 'warm' });
    expect(discarded).toHaveLength(6);
  });
});
