// Table-driven run of fixtures/rules/*.json against evaluateRules. Expectations are written from
// rules.md, not from the implementation: a mismatch is a finding, never a reason to edit a case.
import { describe, expect, it } from 'vitest';
import { loadAllRuleFixtures } from '../../tests/support/rule-fixtures.ts';
import { RuleViolation } from '../wire/index.ts';
import { evaluateRules } from './index.ts';

describe.each(loadAllRuleFixtures())('fixtures/rules/$name', ({ cases }) => {
  it.each(cases)('$ac: $description', ({ profile, referenceDate, expectedViolations }) => {
    const actual = evaluateRules(profile, referenceDate);
    expect(actual).toEqual(expectedViolations);
    for (const violation of actual) {
      expect(RuleViolation.safeParse(violation).success, JSON.stringify(violation)).toBe(true);
    }
  });
});
