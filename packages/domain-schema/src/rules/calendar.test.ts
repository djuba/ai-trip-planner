import { describe, expect, it } from 'vitest';
import { isCalendarDate } from './calendar.ts';

describe('isCalendarDate', () => {
  it.each(['2028-02-29', '2400-02-29', '2000-02-29'])(
    'AC-RULES-18: accepts Feb 29 in leap year (%s)',
    (value) => {
      expect(isCalendarDate(value)).toBe(true);
    },
  );

  it.each(['2027-01-31', '2027-04-30', '2027-02-28', '2027-12-31', '2027-01-01'])(
    'AC-RULES-18: accepts valid boundary date %s',
    (value) => {
      expect(isCalendarDate(value)).toBe(true);
    },
  );

  it.each(['2027-02-29', '2100-02-29', '1900-02-29', '2027-04-31', '2027-02-30'])(
    'AC-RULES-19: rejects nonexistent date %s',
    (value) => {
      expect(isCalendarDate(value)).toBe(false);
    },
  );

  it.each(['2027-00-10', '2027-13-10', '2027-06-00', '2027-06-32', '2027-01-32'])(
    'AC-RULES-19: rejects out-of-range month or day %s',
    (value) => {
      expect(isCalendarDate(value)).toBe(false);
    },
  );

  it.each([
    ['unpadded', '2027-6-1'],
    ['ISO datetime', '2027-06-01T00:00:00Z'],
    ['empty string', ''],
    ['trailing newline', '2027-06-01\n'],
    ['leading space', ' 2027-06-01'],
    ['Arabic-Indic digits', '٢٠٢٧-٠٦-٠١'],
    ['slashes', '2027/06/01'],
  ])('AC-RULES-20: rejects malformed date (%s)', (_label, value) => {
    expect(isCalendarDate(value)).toBe(false);
  });
});
