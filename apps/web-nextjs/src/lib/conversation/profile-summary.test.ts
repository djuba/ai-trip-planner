import { buildFixture } from '@vp/domain-schema/testing';
import { RuleViolation, TripProfile } from '@vp/domain-schema/wire';
import { describe, expect, it } from 'vitest';
import { summarizeProfile } from './profile-summary.ts';

const profile = (value: unknown) => buildFixture(TripProfile, value);
const violation = (path: string) =>
  buildFixture(RuleViolation, { code: 'PARTY_HAS_ADULT', path, params: {} });
const only = (value: unknown) => summarizeProfile(profile(value), [])[0];

describe('summarizeProfile', () => {
  it('AC-CONV-06: no profile gives no rows', () => {
    expect(summarizeProfile(undefined, [])).toEqual([]);
  });

  it('AC-CONV-06: omits absent, null, empty and blank fields', () => {
    const rows = summarizeProfile(
      profile({
        departure: { city: ' ', mode: null, maxStops: null },
        dateRange: { kind: 'flexible', note: ' ' },
        region: '  ',
        climate: null,
        experiences: [],
        unmappedExperiences: [' '],
        people: [],
      }),
      [],
    );
    expect(rows).toEqual([]);
    expect(summarizeProfile(profile({ departure: null, dateRange: null }), [])).toEqual([]);
  });

  it('AC-CONV-06: rows come in a fixed order with fixed labels', () => {
    const rows = summarizeProfile(
      profile({
        people: [{ userType: 'adult' }],
        unmappedExperiences: ['bungee'],
        experiences: ['beach'],
        climate: 'warm',
        region: 'Caribbean',
        dateRange: { kind: 'fixed', start: '2030-02-01', end: '2030-02-08' },
        departure: { city: 'Boston' },
      }),
      [],
    );
    expect(rows.map((r) => [r.field, r.label])).toEqual([
      ['departure', 'From'],
      ['dateRange', 'When'],
      ['region', 'Where'],
      ['climate', 'Climate'],
      ['experiences', 'Experiences'],
      ['unmappedExperiences', 'Also asked for'],
      ['people', 'Travelers'],
    ]);
  });

  it('AC-CONV-06: departure joins city, mode and stops', () => {
    expect(only({ departure: { city: ' Boston ', mode: 'plane', maxStops: 0 } })?.values).toEqual([
      'Boston · Plane · non-stop',
    ]);
    expect(only({ departure: { maxStops: 1 } })?.values).toEqual(['up to 1 stop']);
    expect(only({ departure: { mode: 'train', maxStops: 3 } })?.values).toEqual([
      'Train · up to 3 stops',
    ]);
  });

  it('AC-CONV-06: a fixed range shows the dates as given', () => {
    expect(
      only({ dateRange: { kind: 'fixed', start: '2030-02-30', end: 'soon' } })?.values,
    ).toEqual(['2030-02-30 to soon']);
  });

  it('AC-CONV-06: a flexible range shows month, year, nights and note', () => {
    const range = (extra: object) => only({ dateRange: { kind: 'flexible', ...extra } })?.values;
    expect(range({ month: 2, year: 2030, durationNights: 7, note: 'school break' })).toEqual([
      'February 2030, 7 nights, school break',
    ]);
    expect(range({ month: 12 })).toEqual(['December']);
    expect(range({ year: 2030, durationNights: 1 })).toEqual(['2030, 1 night']);
    expect(range({ month: 13 })).toEqual(['month 13']);
    expect(range({ month: 0 })).toEqual(['month 0']);
    expect(range({ note: ' later ' })).toEqual(['later']);
  });

  it('AC-CONV-06: region, climate and experiences use text and catalog labels', () => {
    expect(only({ region: ' Alps ' })?.values).toEqual(['Alps']);
    expect(only({ climate: 'cold' })?.values).toEqual(['Cold']);
    expect(only({ experiences: ['skiing', 'go-karts'] })?.values).toEqual(['Skiing', 'Go-karts']);
    expect(only({ unmappedExperiences: ['bungee', ' ', 'rafting'] })?.values).toEqual([
      'bungee',
      'rafting',
    ]);
  });

  it('AC-CONV-06: travelers show type, age and gender', () => {
    expect(
      only({
        people: [
          { userType: 'adult', age: 40, gender: ' f ' },
          { userType: 'child', age: null, gender: ' ' },
          { userType: 'child', age: 0 },
        ],
      })?.values,
    ).toEqual(['Adult, 40, f', 'Child', 'Child, 0']);
  });

  it('AC-CONV-06: a violation flags its field and descendants, not others', () => {
    const p = profile({ region: 'Alps', people: [{ userType: 'child', age: 20 }] });
    const flags = (path: string) =>
      Object.fromEntries(
        summarizeProfile(p, [violation(path)]).map((r) => [r.field, r.needsAttention]),
      );
    expect(flags('/people/0/age')).toEqual({ region: false, people: true });
    expect(flags('/people')).toEqual({ region: false, people: true });
    expect(flags('/peopleX')).toEqual({ region: false, people: false });
    expect(flags('')).toEqual({ region: false, people: false });
  });
});
