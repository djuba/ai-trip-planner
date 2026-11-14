// Recommendations on the wire (CLAUDE.md §5, §7 stage 2). The server writes these, so the caps are
// its own guarantees (§4.5, ADR 0004). The model never fills them in directly: it fills the
// unconstrained `RecommendationSet` (src/wire/llm/), and code assigns ids and verification labels,
// and discards anything over a cap (WU-10 plan D2, D3, D8).
import { z } from 'zod';
import {
  MAX_CLAIM_LENGTH,
  MAX_CLAIMS,
  MAX_CRITIQUE_ISSUE_LENGTH,
  MAX_EXPERIENCES,
  MAX_SHORT_TEXT_LENGTH,
  MAX_SUMMARY_LENGTH,
} from '../constants.ts';
import { ClaimKind, Experience, Verification } from './enums.ts';

/**
 * A factual statement (flight, lodging, price, …). `fixture` means our sample route data lists it;
 * anything else is `unverified`. Code sets the label, never the model.
 */
export const FactualClaim = z.object({
  kind: ClaimKind,
  statement: z.string().max(MAX_CLAIM_LENGTH),
  verification: Verification,
});
export type FactualClaim = z.infer<typeof FactualClaim>;

export const Recommendation = z.object({
  /** `rec-<n>`, unique within one response; `/present` cards and critique issues refer to it. */
  id: z.string().max(MAX_SHORT_TEXT_LENGTH),
  destination: z.string().max(MAX_SHORT_TEXT_LENGTH),
  summary: z.string().max(MAX_SUMMARY_LENGTH),
  matchedExperiences: z.array(Experience).max(MAX_EXPERIENCES),
  claims: z.array(FactualClaim).max(MAX_CLAIMS),
});
export type Recommendation = z.infer<typeof Recommendation>;

/** A critic finding still open after the revise cap (§7 stage 2b). */
export const CritiqueIssue = z.object({
  /** The recommendation it concerns, or null for the set as a whole or a discarded one. */
  recommendationId: z.string().max(MAX_SHORT_TEXT_LENGTH).nullable(),
  issue: z.string().max(MAX_CRITIQUE_ISSUE_LENGTH),
});
export type CritiqueIssue = z.infer<typeof CritiqueIssue>;
