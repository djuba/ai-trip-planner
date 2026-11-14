// What the LLM critic fills in (CLAUDE.md §7 stage 2b; WU-10 plan D2). It never crosses HTTP:
// open issues go out as `RecommendResponse.critique.unresolved`, which carries the caps. Uses only
// ADR 0001 Q3 constructs; the backend checks lengths and discards over-cap issues (plan D8).
import { z } from 'zod';

export const CritiqueResult = z.object({
  /** True only when `issues` is empty. */
  pass: z.boolean(),
  issues: z.array(
    z.object({
      /** A `rec-<n>` id from the recommendations reviewed, or null for the set as a whole. */
      recommendationId: z.string().nullable(),
      issue: z.string(),
    }),
  ),
});
export type CritiqueResult = z.infer<typeof CritiqueResult>;
