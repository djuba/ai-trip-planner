import type { TripProfile } from '@vp/domain-schema/wire';
import { describe, expect, it } from 'vitest';
import { tripStart } from './trip-month.ts';

const flexible = (range: { month?: number; year?: number }): TripProfile => ({
  dateRange: { kind: 'flexible', ...range },
});

describe('tripStart', () => {
  it('AC-RECOMMEND-06: a flexible month equal to the reference month is this year', () => {
    expect(tripStart(flexible({ month: 6 }), '2030-06-15')).toEqual({ month: 6, year: 2030 });
  });

  it('AC-RECOMMEND-06: a flexible month before the reference month is next year', () => {
    expect(tripStart(flexible({ month: 3 }), '2030-06-15')).toEqual({ month: 3, year: 2031 });
  });

  it('AC-RECOMMEND-06: a flexible month after the reference month is this year', () => {
    expect(tripStart(flexible({ month: 9 }), '2030-06-15')).toEqual({ month: 9, year: 2030 });
  });

  it('AC-RECOMMEND-06: a December reference date makes January next year', () => {
    expect(tripStart(flexible({ month: 1 }), '2030-12-20')).toEqual({ month: 1, year: 2031 });
  });

  it('AC-RECOMMEND-06: a flexible month with a year uses both as given', () => {
    expect(tripStart(flexible({ month: 2, year: 2035 }), '2030-06-15')).toEqual({
      month: 2,
      year: 2035,
    });
  });

  it('AC-RECOMMEND-06: a fixed range uses the month and year of its start', () => {
    const profile: TripProfile = {
      dateRange: { kind: 'fixed', start: '2031-07-04', end: '2031-07-11' },
    };
    expect(tripStart(profile, '2030-06-15')).toEqual({ month: 7, year: 2031 });
  });

  it('AC-RECOMMEND-06: a year only, a null range and no range give null', () => {
    expect(tripStart(flexible({ year: 2031 }), '2030-06-15')).toBeNull();
    expect(tripStart({ dateRange: null }, '2030-06-15')).toBeNull();
    expect(tripStart({}, '2030-06-15')).toBeNull();
  });
});
