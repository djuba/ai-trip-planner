// `maxOutputTokens` per call, sized from the contract caps (ADR 0004; WU-09 plan D5 and review
// change 3). Output over the budget is a final 502 with no retry (OutputTruncatedError, WU-08), so
// the budget must fit any output `normalize` would keep, and nothing much larger.
import {
  MAX_CLARIFICATION_QUESTION_LENGTH,
  MAX_DATE_TEXT_LENGTH,
  MAX_EXPERIENCES,
  MAX_NOTE_LENGTH,
  MAX_PEOPLE,
  MAX_SHORT_TEXT_LENGTH,
  MAX_UNMAPPED_EXPERIENCES,
} from '@vp/domain-schema/wire';

/** Worst case for text: emoji and many non-Latin scripts cost more than one token per code point. */
export const TOKENS_PER_CODE_POINT = 2;
/** JSON keys, punctuation and enum values around one list item or object. */
const TOKENS_PER_ITEM = 24;
/** The top-level object and its keys. */
const TOKENS_PER_OBJECT = 256;
const MARGIN = 1024;

const roundUp = (tokens: number, step = 256): number => Math.ceil(tokens / step) * step;

/** Every capped string in a profile, at its cap, in code points. */
export const PROFILE_TEXT_CODE_POINTS =
  MAX_SHORT_TEXT_LENGTH + // region
  MAX_SHORT_TEXT_LENGTH + // departure.city
  MAX_NOTE_LENGTH + // flexible note
  2 * MAX_DATE_TEXT_LENGTH + // fixed start and end
  MAX_UNMAPPED_EXPERIENCES * MAX_SHORT_TEXT_LENGTH + // unmappedExperiences items
  MAX_PEOPLE * MAX_SHORT_TEXT_LENGTH; // people[].gender

const PROFILE_ITEMS = MAX_EXPERIENCES + MAX_UNMAPPED_EXPERIENCES + MAX_PEOPLE;

export const EXTRACT_MAX_OUTPUT_TOKENS = roundUp(
  PROFILE_TEXT_CODE_POINTS * TOKENS_PER_CODE_POINT +
    PROFILE_ITEMS * TOKENS_PER_ITEM +
    TOKENS_PER_OBJECT +
    MARGIN,
);

export const CLARIFY_MAX_OUTPUT_TOKENS = roundUp(
  MAX_CLARIFICATION_QUESTION_LENGTH * TOKENS_PER_CODE_POINT + TOKENS_PER_OBJECT,
  1024,
);
