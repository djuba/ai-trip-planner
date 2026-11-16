// Turns a partial or complete PresentationModel into what the cards show (WU-14 plan D3).
// Pure and defensive: the input is whatever the stream has produced so far, so every field is
// checked at runtime and nothing here throws.
import type { Verification } from '@vp/domain-schema/wire';

export interface ClaimView {
  statement: string;
  verification: Verification;
}

export interface CardView {
  /** The card's recommendationId. */
  key: string;
  /** As received, possibly cut short. */
  title?: string;
  blurb?: string;
  /** Only the string items so far. */
  highlights: string[];
  /** `null` = held back until the blurb is done. */
  claims: ClaimView[] | null;
}

export interface PresentationView {
  headline?: string;
  intro?: string;
  cards: CardView[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isVerification(value: unknown): value is Verification {
  return value === 'unverified' || value === 'fixture';
}

function claimViews(raw: unknown): ClaimView[] {
  if (!Array.isArray(raw)) return [];
  const claims: ClaimView[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const { statement, verification } = item;
    if (typeof statement === 'string' && isVerification(verification)) {
      claims.push({ statement, verification });
    }
  }
  return claims;
}

export function presentationView(
  partial: unknown,
  options: { finished: boolean },
): PresentationView {
  if (!isRecord(partial)) return { cards: [] };
  const view: PresentationView = { cards: [] };
  if (typeof partial.headline === 'string') view.headline = partial.headline;
  if (typeof partial.intro === 'string') view.intro = partial.intro;
  const rawCards = Array.isArray(partial.cards) ? (partial.cards as unknown[]) : [];
  rawCards.forEach((raw, index) => {
    if (!isRecord(raw) || typeof raw.recommendationId !== 'string') return;
    const hasHighlights = Array.isArray(raw.highlights);
    const done = hasHighlights || index < rawCards.length - 1 || options.finished;
    const card: CardView = {
      key: raw.recommendationId,
      highlights: hasHighlights
        ? (raw.highlights as unknown[]).filter((item): item is string => typeof item === 'string')
        : [],
      claims: done ? claimViews(raw.claims) : null,
    };
    if (typeof raw.title === 'string') card.title = raw.title;
    if (typeof raw.blurb === 'string') card.blurb = raw.blurb;
    view.cards.push(card);
  });
  return view;
}
