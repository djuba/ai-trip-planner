import { describe, expect, it } from 'vitest';
import {
  CLARIFY_MAX_OUTPUT_TOKENS,
  EXTRACT_MAX_OUTPUT_TOKENS,
  PROFILE_TEXT_CODE_POINTS,
  TOKENS_PER_CODE_POINT,
} from './token-budget.ts';

describe('output token budgets', () => {
  it('AC-EXTRACT-13: counts every capped profile string at its cap', () => {
    // region 100 + city 100 + note 300 + dates 2 × 32 + 10 unmapped × 100 + 50 genders × 100.
    expect(PROFILE_TEXT_CODE_POINTS).toBe(6564);
  });

  it('AC-EXTRACT-13: the extraction budget fits all text at the worst-case token ratio, and stays bounded', () => {
    expect(EXTRACT_MAX_OUTPUT_TOKENS).toBe(16_384);
    expect(EXTRACT_MAX_OUTPUT_TOKENS).toBeGreaterThan(
      PROFILE_TEXT_CODE_POINTS * TOKENS_PER_CODE_POINT,
    );
  });

  it('AC-EXTRACT-13: the clarification budget fits a question at its cap', () => {
    expect(CLARIFY_MAX_OUTPUT_TOKENS).toBe(1024);
    expect(CLARIFY_MAX_OUTPUT_TOKENS).toBeGreaterThan(300 * TOKENS_PER_CODE_POINT);
  });
});
