import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildFixture, ErrorResponse, TripProfile } from './index.ts';

describe('buildFixture', () => {
  it('returns the parsed, typed data for a valid payload', () => {
    const profile = buildFixture(TripProfile, { region: 'Caribbean', climate: 'warm' });
    expect(profile.climate).toBe('warm');
    expect(profile).toEqual({ region: 'Caribbean', climate: 'warm' });
  });

  it('strips unknown keys', () => {
    const profile = buildFixture(TripProfile, { region: 'Alps', surprise: true });
    expect(profile).toEqual({ region: 'Alps' });
  });

  it('throws listing every issue path', () => {
    expect(() =>
      buildFixture(TripProfile, {
        climate: 'hot',
        people: [{ userType: 'adult' }, { age: 4 }],
      }),
    ).toThrowError(/climate:[\s\S]*people\.1\.userType:/);
  });

  it('names a root-level issue "(root)"', () => {
    expect(() => buildFixture(ErrorResponse, null)).toThrowError(/\(root\):/);
  });

  it('prefixes the message so the cause is obvious', () => {
    expect(() => buildFixture(z.object({ a: z.string() }), {})).toThrowError(
      /^Fixture does not match the contract:\n {2}a: /,
    );
  });
});
