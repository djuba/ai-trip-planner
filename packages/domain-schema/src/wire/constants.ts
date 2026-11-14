// Shared constants (CLAUDE.md §4.7), also written to spec/generated/constants.json for any client.

/** Semantic version of the HTTP contract, reported by `GET /v1/health`. */
export const CONTRACT_VERSION = '0.6.0';

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

/**
 * A string's length as the caps count it: Unicode code points, with a lone surrogate counting as
 * one (spec/normalize.md, Definitions). Matches Zod `.max()` and JSON Schema `maxLength`; never
 * use `.length`, which counts UTF-16 units. HTML `maxlength` also counts UTF-16 units.
 */
export function codePointLength(text: string): number {
  return [...text].length;
}
