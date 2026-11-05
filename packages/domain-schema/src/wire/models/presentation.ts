// What `/v1/trip/present` streams (CLAUDE.md §5, §7 stage 3). `recommendationId` and `claims` are
// mapped in code; the rest is model-written copy. Uses only ADR 0001 Q3 constructs. Clients treat
// every field as possibly missing or truncated until the stream ends.
import { z } from 'zod';
import { FactualClaim } from './recommendation.ts';

export const PresentationCard = z.object({
  recommendationId: z.string(),
  title: z.string(),
  blurb: z.string(),
  highlights: z.array(z.string()),
  claims: z.array(FactualClaim),
});
export type PresentationCard = z.infer<typeof PresentationCard>;

export const PresentationModel = z.object({
  headline: z.string(),
  intro: z.string(),
  cards: z.array(PresentationCard),
});
export type PresentationModel = z.infer<typeof PresentationModel>;
