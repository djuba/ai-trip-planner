// What `/v1/trip/present` streams (CLAUDE.md §5, §7 stage 3). The server writes the stream, so the
// caps are its own guarantees (§4.5, ADR 0004). The model never fills this in: it fills the
// unconstrained `PresentationCopy` (src/wire/llm/), and code maps `recommendationId` and `claims`
// from the request and writes the JSON (WU-11 plan D2, D3). Clients treat every field as possibly
// missing or cut short until the stream ends.
import { z } from 'zod';
import {
  MAX_BLURB_LENGTH,
  MAX_CARD_TITLE_LENGTH,
  MAX_CLAIMS,
  MAX_HEADLINE_LENGTH,
  MAX_HIGHLIGHT_LENGTH,
  MAX_HIGHLIGHTS,
  MAX_INTRO_LENGTH,
  MAX_RECOMMENDATIONS,
  MAX_SHORT_TEXT_LENGTH,
} from '../constants.ts';
import { FactualClaim } from './recommendation.ts';

export const PresentationCard = z.object({
  /** The `Recommendation.id` this card presents; cards follow the request's order. */
  recommendationId: z.string().max(MAX_SHORT_TEXT_LENGTH),
  /** The recommendation's claims, unchanged except that code may relabel `fixture` as `unverified`. */
  claims: z.array(FactualClaim).max(MAX_CLAIMS),
  title: z.string().max(MAX_CARD_TITLE_LENGTH),
  blurb: z.string().max(MAX_BLURB_LENGTH),
  highlights: z.array(z.string().max(MAX_HIGHLIGHT_LENGTH)).max(MAX_HIGHLIGHTS),
});
export type PresentationCard = z.infer<typeof PresentationCard>;

export const PresentationModel = z.object({
  headline: z.string().max(MAX_HEADLINE_LENGTH),
  intro: z.string().max(MAX_INTRO_LENGTH),
  cards: z.array(PresentationCard).max(MAX_RECOMMENDATIONS),
});
export type PresentationModel = z.infer<typeof PresentationModel>;
