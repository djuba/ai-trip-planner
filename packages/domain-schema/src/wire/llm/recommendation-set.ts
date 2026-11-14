// What the recommendation model fills in (CLAUDE.md §7 stage 2; WU-10 plan D2). It never crosses
// HTTP: code turns it into `Recommendation`s, assigning ids and verification labels, writing the
// statement of every fixture-backed claim, and discarding anything over a wire cap. Uses only
// ADR 0001 Q3 constructs: no constraints, so an out-of-range value is a critic issue, not a 502.
import { z } from 'zod';
import { ClaimKind, Experience } from '../models/enums.ts';

export const ClaimDraft = z.object({
  kind: ClaimKind,
  statement: z.string(),
  /** IATA codes, set only when the claim asserts a non-stop flight from `from` to `to`. */
  nonstopRoute: z.object({ from: z.string(), to: z.string() }).nullable(),
});
export type ClaimDraft = z.infer<typeof ClaimDraft>;

export const RecommendationDraft = z.object({
  destination: z.string(),
  summary: z.string(),
  /** Only experiences the traveler asked for. */
  matchedExperiences: z.array(Experience),
  /** Months (1-12) when the destination suits the trip. */
  bestMonths: z.array(z.int()),
  /** True when the destination is unsuitable for children. */
  adultsOnly: z.boolean(),
  claims: z.array(ClaimDraft),
});
export type RecommendationDraft = z.infer<typeof RecommendationDraft>;

export const RecommendationSet = z.object({
  recommendations: z.array(RecommendationDraft),
});
export type RecommendationSet = z.infer<typeof RecommendationSet>;
