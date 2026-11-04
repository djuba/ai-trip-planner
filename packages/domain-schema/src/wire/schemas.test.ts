import { describe, expect, it } from 'vitest';
import { SAMPLES } from '../../test/samples.ts';
import { CONTRACT_SCHEMAS, EXPERIENCES, RuleCode, RuleViolation } from './index.ts';

const ids = Object.keys(CONTRACT_SCHEMAS) as (keyof typeof CONTRACT_SCHEMAS)[];

describe('sample table', () => {
  it('covers every registered schema with at least one valid and one invalid sample', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      expect(SAMPLES[id].valid.length, `${id} valid`).toBeGreaterThanOrEqual(1);
      expect(SAMPLES[id].invalid.length, `${id} invalid`).toBeGreaterThanOrEqual(1);
    }
  });
});

describe.each(ids)('%s', (id) => {
  const schema = CONTRACT_SCHEMAS[id];

  it.each(SAMPLES[id].valid.map((v, i) => [i, v] as const))('accepts valid sample %i', (_i, v) => {
    const result = schema.safeParse(v);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it.each(SAMPLES[id].invalid.map((v, i) => [i, v] as const))(
    'rejects invalid sample %i',
    (_i, v) => {
      expect(schema.safeParse(v).success).toBe(false);
    },
  );
});

describe('contract vocabulary', () => {
  it('RuleViolation discriminates on exactly the RuleCode values', () => {
    const codes = RuleViolation.options.map((option) => option.shape.code.value);
    expect([...codes].sort()).toEqual([...RuleCode.options].sort());
  });

  it('Experience is the closed list from CLAUDE.md section 4.3', () => {
    expect([...EXPERIENCES]).toEqual([
      'beach',
      'pool',
      'golf',
      'go-karts',
      'hiking',
      'snorkeling',
      'theme-parks',
      'museums',
      'nightlife',
      'skiing',
    ]);
  });
});
