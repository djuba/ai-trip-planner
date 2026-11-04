import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildFixture, TripProfile } from '../wire/index.ts';
import { evaluateRules } from './index.ts';

const REF = '2027-03-01';

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const profile = (value: unknown): TripProfile => buildFixture(TripProfile, value);
const codes = (p: TripProfile) => evaluateRules(p, REF).map((v) => v.code);

describe('evaluateRules', () => {
  it('AC-RULES-34: returns violations in catalog order', () => {
    const p = profile({
      departure: { maxStops: -1 },
      dateRange: { kind: 'fixed', start: '2027-02-10', end: '2027-02-01' },
      people: [
        { userType: 'child', age: 18 },
        { userType: 'adult', age: 17 },
        { userType: 'child', age: 5 },
      ],
    });
    expect(codes(p)).toEqual([
      'CHILD_AGE_RANGE',
      'ADULT_AGE_RANGE',
      'DATE_ORDER',
      'DATE_NOT_PAST',
      'INSUFFICIENT_DETAIL',
      'MAX_STOPS_RANGE',
    ]);
  });

  it('AC-RULES-34: catalog order includes DATE_VALID and PARTY_HAS_ADULT', () => {
    const p = profile({
      dateRange: { kind: 'fixed', start: '2027-02-30', end: 'bad' },
      people: [{ userType: 'child', age: 20 }],
    });
    expect(codes(p)).toEqual([
      'CHILD_AGE_RANGE',
      'DATE_VALID',
      'DATE_VALID',
      'PARTY_HAS_ADULT',
      'INSUFFICIENT_DETAIL',
    ]);
  });

  it('AC-RULES-34: document order within a code, and path index matches the traveler', () => {
    const p = profile({
      region: 'Alps',
      climate: 'cold',
      people: [
        { userType: 'child', age: 3 },
        { userType: 'child', age: 18 },
        { userType: 'adult', age: 30 },
        { userType: 'child', age: -1 },
      ],
    });
    expect(evaluateRules(p, REF)).toEqual([
      { code: 'CHILD_AGE_RANGE', path: '/people/1/age', params: { age: 18, min: 0, max: 17 } },
      { code: 'CHILD_AGE_RANGE', path: '/people/3/age', params: { age: -1, min: 0, max: 17 } },
    ]);
  });

  it('AC-RULES-34: DATE_VALID reports start before end', () => {
    const p = profile({
      region: 'Alps',
      climate: 'cold',
      experiences: ['skiing'],
      dateRange: { kind: 'fixed', start: 'x', end: 'y' },
    });
    expect(evaluateRules(p, REF).map((v) => v.path)).toEqual([
      '/dateRange/start',
      '/dateRange/end',
    ]);
  });

  it('AC-RULES-34: an empty profile fires only INSUFFICIENT_DETAIL', () => {
    expect(evaluateRules(profile({}), REF)).toEqual([
      { code: 'INSUFFICIENT_DETAIL', path: '', params: { populated: 0, required: 3 } },
    ]);
  });

  it('AC-RULES-35: the same input twice gives equal output', () => {
    const p = profile({
      departure: { maxStops: -2 },
      people: [{ userType: 'child', age: 40 }],
    });
    expect(evaluateRules(p, REF)).toEqual(evaluateRules(p, REF));
  });

  it('AC-RULES-35: a deep-frozen input is not mutated and does not throw', () => {
    const input = {
      departure: { city: 'MSP', maxStops: -1 },
      dateRange: { kind: 'fixed', start: '2027-02-10', end: '2027-02-01' },
      region: 'Alps',
      experiences: ['skiing'],
      people: [
        { userType: 'child', age: 18 },
        { userType: 'adult', age: 200 },
      ],
    };
    const frozen = deepFreeze(profile(structuredClone(input)));
    const snapshot = structuredClone(frozen);
    let result: unknown;
    expect(() => {
      result = evaluateRules(frozen, REF);
    }).not.toThrow();
    expect(frozen).toEqual(snapshot);
    expect(result).toEqual(evaluateRules(structuredClone(snapshot), REF));
  });

  it('AC-RULES-35: rule source reads neither a clock nor a random source', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(join(dir, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(source, `${file} uses Date`).not.toMatch(/\bDate\b/);
      expect(source, `${file} uses Math.random`).not.toMatch(/Math\.random/);
      expect(source, `${file} uses performance.now`).not.toMatch(/performance\.now/);
      expect(source, `${file} uses Temporal`).not.toMatch(/\bTemporal\b/);
      expect(source, `${file} uses crypto`).not.toMatch(/\bcrypto\b/);
    }
  });
});
