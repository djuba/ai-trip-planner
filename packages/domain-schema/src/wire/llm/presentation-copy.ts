// What the LLM writes for `/v1/trip/present` (CLAUDE.md §7 stage 3; WU-11 plan D2). Only the copy:
// no ids and no claims, which code maps from the request. It never crosses HTTP: code turns it into
// the capped `PresentationModel` stream (plan D3, D4). Uses only ADR 0001 Q3 constructs.
import { z } from 'zod';

export const PresentationCopy = z.object({
  headline: z.string(),
  intro: z.string(),
  /** One card per recommendation, in the order given. */
  cards: z.array(
    z.object({
      title: z.string(),
      blurb: z.string(),
      highlights: z.array(z.string()),
    }),
  ),
});
export type PresentationCopy = z.infer<typeof PresentationCopy>;
