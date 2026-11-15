// Shared constants (CLAUDE.md §4.7), also written to spec/generated/constants.json for any client.

/** Semantic version of the HTTP contract, reported by `GET /v1/health`. */
export const CONTRACT_VERSION = '0.8.0';

/** A profile with fewer populated fields than this yields INSUFFICIENT_DETAIL (§4.7). */
export const MIN_POPULATED_FIELDS = 3;

/** A request body larger than this many bytes gets a 413 `PAYLOAD_TOO_LARGE` (§5). */
export const MAX_REQUEST_BODY_BYTES = 1_048_576;

// Resource caps (ADR 0004). Lengths count Unicode code points (spec/normalize.md, Definitions).
// A value over a cap fails the wire schema (422); `normalize` discards model output over a cap.

/** Most code points in `ExtractRequest.message`. */
export const MAX_MESSAGE_LENGTH = 2000;

/** Most code points in `region`, `departure.city`, `people[].gender` and each unmapped experience. */
export const MAX_SHORT_TEXT_LENGTH = 100;

/** Most code points in a flexible `dateRange.note`. */
export const MAX_NOTE_LENGTH = 300;

/** Most code points in a fixed `dateRange.start` or `end` (malformed dates are a rule, not a cap). */
export const MAX_DATE_TEXT_LENGTH = 32;

/** Most items in `experiences` (duplicates are allowed on the wire). */
export const MAX_EXPERIENCES = 20;

/** Most items in `unmappedExperiences`. */
export const MAX_UNMAPPED_EXPERIENCES = 10;

/** Most travelers in `people`. */
export const MAX_PEOPLE = 50;

/** Most code points in `ExtractResponse.clarificationQuestion`: a sentence or two (ADR 0004). */
export const MAX_CLARIFICATION_QUESTION_LENGTH = 300;

// Output caps on recommendations (ADR 0004; WU-10 plan D2). The model's RecommendationSet and
// CritiqueResult stay unconstrained (ADR 0001 Q3); code discards over-cap model output.

/** Most recommendations in `RecommendResponse` and `PresentRequest`. */
export const MAX_RECOMMENDATIONS = 3;

/** Most claims on one recommendation. */
export const MAX_CLAIMS = 5;

/** Most code points in `Recommendation.summary`. */
export const MAX_SUMMARY_LENGTH = 500;

/** Most code points in `FactualClaim.statement`. */
export const MAX_CLAIM_LENGTH = 200;

/** Most code points in `CritiqueIssue.issue`. */
export const MAX_CRITIQUE_ISSUE_LENGTH = 300;

/** Most issues in `RecommendResponse.critique.unresolved`. */
export const MAX_UNRESOLVED_ISSUES = 24;

// Output caps on the presentation (ADR 0004 addendum; WU-11 plan D2, D4). The model's
// PresentationCopy stays unconstrained (ADR 0001 Q3). Streamed text can't be discarded once sent,
// so the stream writer ends an over-cap string at a word boundary with "…", within the cap.

/** Most code points in `PresentationModel.headline`. */
export const MAX_HEADLINE_LENGTH = 120;

/** Most code points in `PresentationModel.intro`. */
export const MAX_INTRO_LENGTH = 600;

/** Most code points in `PresentationCard.title`. */
export const MAX_CARD_TITLE_LENGTH = 100;

/** Most code points in `PresentationCard.blurb`. */
export const MAX_BLURB_LENGTH = 600;

/** Most items in `PresentationCard.highlights`. */
export const MAX_HIGHLIGHTS = 5;

/** Most code points in each of `PresentationCard.highlights`. */
export const MAX_HIGHLIGHT_LENGTH = 120;

/**
 * A string's length as the caps count it: Unicode code points, with a lone surrogate counting as
 * one (spec/normalize.md, Definitions). Matches Zod `.max()` and JSON Schema `maxLength`; never
 * use `.length`, which counts UTF-16 units. HTML `maxlength` also counts UTF-16 units.
 */
export function codePointLength(text: string): number {
  return [...text].length;
}
