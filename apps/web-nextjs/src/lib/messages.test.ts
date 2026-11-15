import type { RuleViolation } from '@vp/domain-schema/wire';
import type * as IntlModule from 'intl-messageformat';
import { describe, expect, it, vi } from 'vitest';
import { describeViolation, enumLabel } from './messages.ts';

// `format` is an instance property, so a test that needs a non-string result swaps it per instance.
const fake = vi.hoisted(() => ({ nonString: false }));
vi.mock('intl-messageformat', async (importOriginal) => {
  const original = await importOriginal<typeof IntlModule>();
  class Formatter extends original.IntlMessageFormat {
    constructor(...args: ConstructorParameters<typeof original.IntlMessageFormat>) {
      super(...args);
      if (fake.nonString) this.format = () => ['x'];
    }
  }
  return { ...original, IntlMessageFormat: Formatter };
});

const text = (violation: RuleViolation) => describeViolation(violation);

describe('describeViolation', () => {
  it('AC-CONV-05: CHILD_AGE_RANGE shows the age and bounds', () => {
    const out = text({
      code: 'CHILD_AGE_RANGE',
      path: '/people/0/age',
      params: { age: 18, min: 0, max: 17 },
    });
    expect(out).toContain('18');
    expect(out).toContain('17');
  });

  it('AC-CONV-05: ADULT_AGE_RANGE shows the age and bounds', () => {
    const out = text({
      code: 'ADULT_AGE_RANGE',
      path: '/people/1/age',
      params: { age: 121, min: 18, max: 120 },
    });
    expect(out).toContain('121');
    expect(out).toContain('120');
  });

  it('AC-CONV-05: DATE_ORDER shows both dates', () => {
    const out = text({
      code: 'DATE_ORDER',
      path: '/dateRange',
      params: { start: '2030-05-10', end: '2030-05-01' },
    });
    expect(out).toContain('2030-05-10');
    expect(out).toContain('2030-05-01');
  });

  it('AC-CONV-05: DATE_NOT_PAST shows the value and the reference date', () => {
    const out = text({
      code: 'DATE_NOT_PAST',
      path: '/dateRange/start',
      params: { value: '2020-01-01', referenceDate: '2026-11-15' },
    });
    expect(out).toContain('2020-01-01');
    expect(out).toContain('2026-11-15');
  });

  it('AC-CONV-05: DATE_VALID words each field differently', () => {
    const at = (path: string, value: string | number) =>
      text({ code: 'DATE_VALID', path, params: { value } });
    const outs = [
      at('/dateRange/month', 13),
      at('/dateRange/year', 2101),
      at('/dateRange/durationNights', 0),
      at('/dateRange/start', '2027-02-30'),
      at('/dateRange/end', '2027-13-01'),
    ];
    expect(new Set(outs).size).toBe(5);
    expect(outs[0]).toContain('13');
    expect(outs[1]).toContain('2101');
    expect(outs[2]).toContain('0');
    expect(outs[3]).toContain('2027-02-30');
    expect(outs[4]).toContain('2027-13-01');
  });

  it('AC-CONV-05: DATE_VALID falls back for an unknown field', () => {
    expect(text({ code: 'DATE_VALID', path: '', params: { value: 'x' } })).toContain('x');
  });

  it('AC-CONV-05: PARTY_HAS_ADULT needs no params', () => {
    expect(text({ code: 'PARTY_HAS_ADULT', path: '/people', params: {} })).toMatch(/adult/i);
  });

  it('AC-CONV-05: INSUFFICIENT_DETAIL shows both counts', () => {
    const out = text({
      code: 'INSUFFICIENT_DETAIL',
      path: '',
      params: { populated: 1, required: 3 },
    });
    expect(out).toContain('3');
    expect(out).toContain('1');
  });

  it('AC-CONV-05: MAX_STOPS_RANGE shows the value', () => {
    const out = text({
      code: 'MAX_STOPS_RANGE',
      path: '/departure/maxStops',
      params: { value: -2 },
    });
    expect(out).toContain('-2');
  });

  it('AC-CONV-05: formats the same code repeatedly from its cached formatter', () => {
    const violation: RuleViolation = { code: 'MAX_STOPS_RANGE', path: '', params: { value: -1 } };
    expect(text(violation)).toBe(text(violation));
  });

  it('AC-CONV-05: throws when a template formats to something other than a string', async () => {
    vi.resetModules();
    fake.nonString = true;
    try {
      const fresh = await import('./messages.ts');
      expect(() =>
        fresh.describeViolation({ code: 'PARTY_HAS_ADULT', path: '', params: {} }),
      ).toThrow('did not format to a string');
    } finally {
      fake.nonString = false;
    }
  });
});

describe('enumLabel', () => {
  it('AC-CONV-05: labels each enum kind from the catalog', () => {
    expect(enumLabel('experience', 'go-karts')).toBe('Go-karts');
    expect(enumLabel('climate', 'warm')).toBe('Warm');
    expect(enumLabel('travelMode', 'train')).toBe('Train');
    expect(enumLabel('userType', 'child')).toBe('Child');
  });
});
