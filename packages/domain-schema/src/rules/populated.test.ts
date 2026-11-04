import { describe, expect, it } from 'vitest';
import { buildFixture, TripProfile } from '../wire/index.ts';
import { countPopulatedFields } from './index.ts';

const count = (profile: unknown): number =>
  countPopulatedFields(buildFixture(TripProfile, profile));

describe('countPopulatedFields', () => {
  it('AC-RULES-27: counts 0 for an empty profile', () => {
    expect(count({})).toBe(0);
  });

  it('AC-RULES-27: counts the maximum of 6 when every field is populated', () => {
    expect(
      count({
        departure: { city: 'Minneapolis' },
        dateRange: { kind: 'fixed', start: '2027-06-01', end: '2027-06-08' },
        region: 'Caribbean',
        climate: 'warm',
        experiences: ['beach'],
        people: [{ userType: 'adult' }],
        unmappedExperiences: ['sailing'],
      }),
    ).toBe(6);
  });

  it('AC-RULES-27: counts 2 and 3 populated fields', () => {
    expect(count({ region: 'Alps', climate: 'cold' })).toBe(2);
    expect(count({ region: 'Alps', climate: 'cold', experiences: ['skiing'] })).toBe(3);
  });

  it.each([
    ['empty', ''],
    ['space', ' '],
    ['tab', '\t'],
    ['U+00A0', '\u00A0'],
    ['U+0085', '\u0085'],
    ['mixed whitespace', ' \t\u00A0\u0085 '],
  ])('AC-RULES-28: region of %s does not count', (_label, region) => {
    expect(count({ region })).toBe(0);
  });

  it.each([
    ['U+FEFF', '\uFEFF'],
    ['U+001C', '\u001C'],
  ])('AC-RULES-28: region of only %s counts (not White_Space)', (_label, region) => {
    expect(count({ region })).toBe(1);
  });

  it('AC-RULES-28: region with text around whitespace counts', () => {
    expect(count({ region: ' Alps ' })).toBe(1);
  });

  it('AC-RULES-29: departure counts only with a non-blank city', () => {
    expect(count({ departure: { city: 'MSP' } })).toBe(1);
    expect(count({ departure: { mode: 'plane' } })).toBe(0);
    expect(count({ departure: { maxStops: 0 } })).toBe(0);
    expect(count({ departure: { city: '  \t' } })).toBe(0);
    expect(count({ departure: { city: null, mode: 'car', maxStops: 1 } })).toBe(0);
    expect(count({ departure: null })).toBe(0);
  });

  it('AC-RULES-30: a fixed range counts even when malformed', () => {
    expect(count({ dateRange: { kind: 'fixed', start: '2027-06-01', end: '2027-06-08' } })).toBe(1);
    expect(count({ dateRange: { kind: 'fixed', start: 'nope', end: '' } })).toBe(1);
  });

  it('AC-RULES-30: a flexible range counts with month or year, even invalid', () => {
    expect(count({ dateRange: { kind: 'flexible', month: 6 } })).toBe(1);
    expect(count({ dateRange: { kind: 'flexible', year: 2027 } })).toBe(1);
    expect(count({ dateRange: { kind: 'flexible', month: 0 } })).toBe(1);
  });

  it('AC-RULES-30: a flexible range with only durationNights or note does not count', () => {
    expect(count({ dateRange: { kind: 'flexible', durationNights: 7 } })).toBe(0);
    expect(count({ dateRange: { kind: 'flexible', note: 'sometime' } })).toBe(0);
    expect(count({ dateRange: { kind: 'flexible' } })).toBe(0);
    expect(count({ dateRange: null })).toBe(0);
  });

  it('AC-RULES-31: empty arrays and null fields do not count', () => {
    expect(count({ experiences: [], people: [] })).toBe(0);
    expect(count({ region: null, climate: null, departure: null, dateRange: null })).toBe(0);
  });

  it('AC-RULES-31: unmappedExperiences never counts', () => {
    expect(count({ unmappedExperiences: ['sailing', 'yoga'] })).toBe(0);
  });

  it('AC-RULES-31: a non-null climate counts; non-empty arrays count', () => {
    expect(count({ climate: 'tropical' })).toBe(1);
    expect(count({ experiences: ['golf'] })).toBe(1);
    expect(count({ people: [{ userType: 'child' }] })).toBe(1);
  });
});
