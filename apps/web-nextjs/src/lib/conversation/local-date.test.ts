import { expect, it } from 'vitest';
import { localDate } from './local-date';

it('AC-CONV-01: formats the local calendar date as YYYY-MM-DD', () => {
  expect(localDate(new Date(2030, 0, 15, 12, 0))).toBe('2030-01-15');
});

it('AC-CONV-01: pads single-digit months and days', () => {
  expect(localDate(new Date(2030, 8, 3))).toBe('2030-09-03');
});

it('AC-CONV-01: uses local fields, so a late evening is still today', () => {
  expect(localDate(new Date(2030, 11, 31, 23, 59, 59))).toBe('2030-12-31');
});
