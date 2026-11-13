import { buildFixture } from '@vp/domain-schema/testing';
import { ExtractionSchema, type TripProfile } from '@vp/domain-schema/wire';
import { describe, expect, it } from 'vitest';
import { expectedAfterNormalize, toExtraction } from './to-extraction.ts';

describe('toExtraction', () => {
  it('AC-EXTRACT-07: fills every absent field with null and passes ExtractionSchema', () => {
    const profile: TripProfile = {
      departure: { city: 'MSP' },
      dateRange: { kind: 'flexible', month: 3 },
      people: [{ userType: 'adult' }, { userType: 'child', age: 4, gender: 'f' }],
    };
    const extraction = buildFixture(ExtractionSchema, toExtraction(profile));
    expect(extraction).toEqual({
      departure: { city: 'MSP', mode: null, maxStops: null },
      dateRange: { kind: 'flexible', month: 3, year: null, durationNights: null, note: null },
      region: null,
      climate: null,
      experiences: null,
      unmappedExperiences: null,
      people: [
        { userType: 'adult', age: null, gender: null },
        { userType: 'child', age: 4, gender: 'f' },
      ],
    });
  });

  it('AC-EXTRACT-07: keeps a fixed range and explicit nulls, and maps an empty profile', () => {
    const fixed: TripProfile = {
      dateRange: { kind: 'fixed', start: 'a', end: 'b' },
      departure: null,
    };
    expect(toExtraction(fixed)).toMatchObject({
      dateRange: { kind: 'fixed', start: 'a', end: 'b' },
      departure: null,
    });
    expect(toExtraction({}).people).toBeNull();
  });
});

describe('expectedAfterNormalize', () => {
  it('AC-EXTRACT-07: drops nulls, empty arrays and emptied objects', () => {
    expect(
      expectedAfterNormalize({
        departure: { city: null, mode: null },
        dateRange: { kind: 'flexible' },
        region: null,
        experiences: [],
        unmappedExperiences: [],
        people: [],
      }),
    ).toEqual({});
  });

  it('AC-EXTRACT-07: keeps values, zeros and fixed ranges; keeps traveler fields', () => {
    const profile: TripProfile = {
      departure: { city: 'MSP', maxStops: 0, mode: null },
      dateRange: { kind: 'flexible', month: 0, note: '' },
      region: '',
      climate: 'warm',
      experiences: ['beach'],
      unmappedExperiences: ['x'],
      people: [{ userType: 'adult' }, { userType: 'child', age: 0 }],
    };
    expect(expectedAfterNormalize(profile)).toEqual({
      departure: { city: 'MSP', maxStops: 0 },
      dateRange: { kind: 'flexible', month: 0, note: '' },
      region: '',
      climate: 'warm',
      experiences: ['beach'],
      unmappedExperiences: ['x'],
      people: [{ userType: 'adult' }, { userType: 'child', age: 0 }],
    });
    const fixed: TripProfile = { dateRange: { kind: 'fixed', start: 's', end: 'e' } };
    expect(expectedAfterNormalize(fixed)).toEqual(fixed);
  });
});
