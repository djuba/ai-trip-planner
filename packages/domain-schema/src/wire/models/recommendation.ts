// Recommendations (CLAUDE.md §7 stage 2). The model produces these through `RecommendationSet`, so
// everything here uses only ADR 0001 Q3 constructs. Provisional under contract 0.x.
import { z } from 'zod';
import { ClaimKind, Experience, Verification } from './enums.ts';

/** A factual statement (flight, lodging, price, …), never presented as fact unless fixture-backed. */
export const FactualClaim = z.object({
  kind: ClaimKind,
  statement: z.string(),
  verification: Verification,
});
export type FactualClaim = z.infer<typeof FactualClaim>;

export const Recommendation = z.object({
  /** Stable within one set; `/present` cards refer back to it. */
  id: z.string(),
  destination: z.string(),
  summary: z.string(),
  matchedExperiences: z.array(Experience),
  claims: z.array(FactualClaim),
});
export type Recommendation = z.infer<typeof Recommendation>;

/** A critic finding still open after the revise cap (§7 stage 2b). */
export const CritiqueIssue = z.object({
  recommendationId: z.string().nullable(),
  issue: z.string(),
});
export type CritiqueIssue = z.infer<typeof CritiqueIssue>;
