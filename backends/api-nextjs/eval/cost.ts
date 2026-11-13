// Prices and cost arithmetic for the eval (WU-18 plan D3, D10). Pricing is read from pricing.json
// at run time; the run prints its `asOf` date.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const Price = z.strictObject({
  inputPerMTok: z.number().nonnegative(),
  outputPerMTok: z.number().nonnegative(),
});

export const Pricing = z.strictObject({
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.string().min(1),
  note: z.string().optional(),
  models: z.record(z.string(), Price),
});
export type Pricing = z.infer<typeof Pricing>;

export const PRICING_PATH = fileURLToPath(new URL('./pricing.json', import.meta.url));

export function loadPricing(path: string = PRICING_PATH): Pricing {
  return Pricing.parse(JSON.parse(readFileSync(path, 'utf8')));
}

/** Model ids with no price, deduplicated, in input order. */
export function missingPrices(modelIds: readonly string[], pricing: Pricing): string[] {
  const missing = new Set<string>();
  for (const id of modelIds) {
    if (!Object.hasOwn(pricing.models, id)) missing.add(id);
  }
  return [...missing];
}

export function usd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  pricing: Pricing,
): number {
  const price = Object.hasOwn(pricing.models, model) ? pricing.models[model] : undefined;
  if (price === undefined) throw new Error(`no price for model ${model} in pricing.json`);
  return (inputTokens * price.inputPerMTok + outputTokens * price.outputPerMTok) / 1_000_000;
}

export function costOf(
  entries: readonly {
    model: string;
    inputTokens: number | undefined;
    outputTokens: number | undefined;
  }[],
  pricing: Pricing,
): number {
  let total = 0;
  for (const e of entries) total += usd(e.model, e.inputTokens ?? 0, e.outputTokens ?? 0, pricing);
  return total;
}

/** What a set of calls costs if each uses its whole input and `maxOutputTokens`. */
export function worstCaseUsd(
  calls: readonly { model: string; inputTokens: number; maxOutputTokens: number }[],
  pricing: Pricing,
): number {
  let total = 0;
  for (const c of calls) total += usd(c.model, c.inputTokens, c.maxOutputTokens, pricing);
  return total;
}

/**
 * Deliberately high: one token per code point (emoji and some scripts cost more than one token per
 * character; English costs far less). Used only for the worst case (WU-18 unit review #4).
 */
export function estimateInputTokens(text: string): number {
  return [...text].length;
}
