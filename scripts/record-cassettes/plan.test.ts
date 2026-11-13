import { describe, expect, it } from 'vitest';
import { RecordPlanError, planRecord } from './plan.ts';

describe('planRecord', () => {
  it('defaults to the integration project', () => {
    expect(planRecord(['extract.replay'])).toEqual({
      kind: 'vitest',
      project: 'integration',
      filters: ['extract.replay'],
    });
  });

  it('accepts --project functional-api, as two args or with =', () => {
    const expected = { kind: 'vitest', project: 'functional-api', filters: ['extract'] };
    expect(planRecord(['--project', 'functional-api', 'extract'])).toEqual(expected);
    expect(planRecord(['extract', '--project=functional-api'])).toEqual(expected);
  });

  it('rejects an unknown or missing project', () => {
    expect(() => planRecord(['--project', 'unit', 'x'])).toThrow(RecordPlanError);
    expect(() => planRecord(['--project', 'unit', 'x'])).toThrow(/integration, functional-api/);
    expect(() => planRecord(['x', '--project'])).toThrow(RecordPlanError);
  });

  it('requires filters for a vitest project', () => {
    expect(() => planRecord([])).toThrow(/name the test files/);
    expect(() => planRecord(['--project', 'integration'])).toThrow(RecordPlanError);
  });

  it('--contract needs no filters and passes any it has through', () => {
    expect(planRecord(['--contract'])).toEqual({ kind: 'contract', filters: [] });
    expect(planRecord(['--contract', 'conformance/extract'])).toEqual({
      kind: 'contract',
      filters: ['conformance/extract'],
    });
  });
});
