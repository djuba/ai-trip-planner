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

  it('AC-JOURNEY-09: --journeys needs no filters and passes any it has through', () => {
    expect(planRecord(['--journeys'])).toEqual({ kind: 'journeys', filters: [] });
    expect(planRecord(['--journeys', '--grep', '@smoke'])).toEqual({
      kind: 'journeys',
      filters: ['--grep', '@smoke'],
    });
  });

  it('AC-JOURNEY-09: --prune takes no filters', () => {
    expect(planRecord(['--prune'])).toEqual({ kind: 'prune' });
    expect(() => planRecord(['--prune', 'x'])).toThrow(/no filters/);
  });

  it('AC-JOURNEY-09: --journeys, --prune, --contract and --project exclude each other', () => {
    expect(() => planRecord(['--journeys', '--prune'])).toThrow(/exclude each other/);
    expect(() => planRecord(['--prune', '--contract'])).toThrow(RecordPlanError);
    expect(() => planRecord(['--journeys', '--contract'])).toThrow(RecordPlanError);
    expect(() => planRecord(['--prune', '--project', 'integration'])).toThrow(RecordPlanError);
    // Stricter than before WU-15, when --project was silently ignored next to --contract.
    expect(() => planRecord(['--contract', '--project', 'integration'])).toThrow(RecordPlanError);
  });
});
