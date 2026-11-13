import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  costOf,
  estimateInputTokens,
  loadPricing,
  missingPrices,
  usd,
  worstCaseUsd,
  type Pricing,
} from './cost.ts';

const pricing: Pricing = {
  asOf: '2026-11-03',
  source: 'https://example.test/pricing',
  models: {
    cheap: { inputPerMTok: 1, outputPerMTok: 2 },
    dear: { inputPerMTok: 10, outputPerMTok: 20 },
  },
};

describe('pricing', () => {
  it('AC-EVAL-02: loads the committed pricing.json', () => {
    const loaded = loadPricing();
    expect(loaded.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Object.keys(loaded.models)).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5']);
  });

  it('AC-EVAL-02: rejects a malformed pricing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-pricing-'));
    try {
      const path = join(dir, 'pricing.json');
      writeFileSync(path, JSON.stringify({ ...pricing, asOf: 'yesterday' }));
      expect(() => loadPricing(path)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AC-EVAL-02: lists models with no price, once each, in input order', () => {
    expect(missingPrices(['cheap', 'x', 'dear', 'y', 'x', 'toString'], pricing)).toEqual([
      'x',
      'y',
      'toString',
    ]);
    expect(missingPrices(['cheap', 'dear'], pricing)).toEqual([]);
  });
});

describe('cost', () => {
  it('AC-EVAL-04: prices input and output tokens per model', () => {
    expect(usd('cheap', 1_000_000, 500_000, pricing)).toBe(2);
  });

  it('AC-EVAL-04: refuses to price an unknown model', () => {
    expect(() => usd('nope', 1, 1, pricing)).toThrow(/nope/);
  });

  it('AC-EVAL-04: sums across models and attempts, counting undefined tokens as 0', () => {
    const total = costOf(
      [
        { model: 'cheap', inputTokens: 1_000_000, outputTokens: 0 },
        { model: 'cheap', inputTokens: 1_000_000, outputTokens: 1_000_000 },
        { model: 'dear', inputTokens: undefined, outputTokens: 100_000 },
        { model: 'dear', inputTokens: 100_000, outputTokens: undefined },
      ],
      pricing,
    );
    expect(total).toBeCloseTo(1 + 3 + 2 + 1, 9);
    expect(costOf([], pricing)).toBe(0);
  });

  it('AC-EVAL-04: a worst case prices every call at its maxOutputTokens', () => {
    expect(
      worstCaseUsd(
        [
          { model: 'cheap', inputTokens: 1_000_000, maxOutputTokens: 1_000_000 },
          { model: 'dear', inputTokens: 100_000, maxOutputTokens: 50_000 },
        ],
        pricing,
      ),
    ).toBeCloseTo(3 + 2, 9);
  });

  it('AC-EVAL-04: estimates input tokens as one per code point', () => {
    expect(estimateInputTokens('')).toBe(0);
    expect(estimateInputTokens('abc')).toBe(3);
    expect(estimateInputTokens('\u{1F600}\u{1F600}')).toBe(2);
  });
});
