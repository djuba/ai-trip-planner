import { describe, expect, it } from 'vitest';
import { buildFixture, ExtractionSchema, TripProfile } from '../wire/index.ts';
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
    expect(normalize(extraction({}))).toEqual({});
    expect(JSON.stringify(normalize(extraction({})))).toBe('{}');
  });

  it('AC-RULES-37: drops empty arrays for experiences, unmappedExperiences and people', () => {
    const result = normalize(extraction({ experiences: [], unmappedExperiences: [], people: [] }));
    expect(result).toEqual({});
    expect(Object.keys(result)).toEqual([]);
  });

  it('AC-RULES-37: keeps non-empty arrays', () => {
    const result = normalize(
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
    const result = normalize(
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
    const result = normalize(extraction({ departure: { city: null, mode: null, maxStops: null } }));
    expect(result).toEqual({});
  });

  it('AC-RULES-37: keeps maxStops 0', () => {
    const result = normalize(extraction({ departure: { city: null, mode: null, maxStops: 0 } }));
    expect(result).toEqual({ departure: { maxStops: 0 } });
  });

  it('AC-RULES-37: keeps age 0', () => {
    const result = normalize(extraction({ people: [{ userType: 'child', age: 0, gender: null }] }));
    expect(result).toEqual({ people: [{ userType: 'child', age: 0 }] });
  });

  it('AC-RULES-38: a flexible range loses its nulls', () => {
    const result = normalize(extraction({ dateRange: flexible({ month: 6, year: 2027 }) }));
    expect(result).toEqual({ dateRange: { kind: 'flexible', month: 6, year: 2027 } });
  });

  it('AC-RULES-38: an all-null flexible range is dropped', () => {
    expect(normalize(extraction({ dateRange: flexible({}) }))).toEqual({});
  });

  it('AC-RULES-38: a flexible range with only note is kept', () => {
    const result = normalize(extraction({ dateRange: flexible({ note: 'sometime in fall' }) }));
    expect(result).toEqual({ dateRange: { kind: 'flexible', note: 'sometime in fall' } });
  });

  it('AC-RULES-38: keeps flexible month 0 and durationNights 0 (no range checks)', () => {
    const result = normalize(extraction({ dateRange: flexible({ month: 0, durationNights: 0 }) }));
    expect(result).toEqual({ dateRange: { kind: 'flexible', month: 0, durationNights: 0 } });
  });

  it('AC-RULES-38: a fixed range is unchanged, even when malformed', () => {
    const malformed = { kind: 'fixed', start: '2027-6-1', end: '' };
    expect(normalize(extraction({ dateRange: malformed }))).toEqual({ dateRange: malformed });
    const ok = { kind: 'fixed', start: '2027-06-01', end: '2027-06-08' };
    expect(normalize(extraction({ dateRange: ok }))).toEqual({ dateRange: ok });
  });

  it('AC-RULES-39: strings are untouched, including empty and whitespace', () => {
    const result = normalize(
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
    const result = normalize(
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
    const result = normalize(
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
    expect(JSON.stringify(normalize(reordered))).toBe(ORDERED_JSON);
  });
});
