// `maxOutputTokens` per call, sized from the contract caps (ADR 0004; WU-09 plan D5 and review
// change 3). Output over the budget is a final 502 with no retry (OutputTruncatedError, WU-08), so
// the budget must fit any output `normalize` would keep, and nothing much larger.
import {
  EXPERIENCES,
  MAX_CLAIM_LENGTH,
  MAX_CLAIMS,
  MAX_CLARIFICATION_QUESTION_LENGTH,
  MAX_CRITIQUE_ISSUE_LENGTH,
  MAX_DATE_TEXT_LENGTH,
  MAX_EXPERIENCES,
  MAX_NOTE_LENGTH,
  MAX_PEOPLE,
  MAX_RECOMMENDATIONS,
  MAX_SHORT_TEXT_LENGTH,
  MAX_SUMMARY_LENGTH,
  MAX_UNMAPPED_EXPERIENCES,
} from '@vp/domain-schema/wire';
import { MAX_CRITIC_ISSUES } from './prompts/critic.ts';

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

// Recommend and critic (WU-10 plan D10). Sonnet 5.5's thinking is adaptive and can't be turned off
// (ADR 0001 Q4), so at `effort: 'medium'` it may spend tokens before the JSON: a fixed margin.
export const THINKING_MARGIN = 4096;

/** Every draft field that survives the wire caps, at its cap, in code points. */
export const DRAFT_TEXT_CODE_POINTS =
  MAX_SHORT_TEXT_LENGTH + // destination
  MAX_SUMMARY_LENGTH + // summary
  MAX_CLAIMS * (MAX_CLAIM_LENGTH + 2 * 8); // claim statements and their nonstopRoute codes

/** List items in one draft: every experience, every month, every claim. */
const DRAFT_ITEMS = EXPERIENCES.length + 12 + MAX_CLAIMS;

export const RECOMMEND_MAX_OUTPUT_TOKENS = roundUp(
  MAX_RECOMMENDATIONS *
    (DRAFT_TEXT_CODE_POINTS * TOKENS_PER_CODE_POINT + DRAFT_ITEMS * TOKENS_PER_ITEM) +
    TOKENS_PER_OBJECT +
    MARGIN +
    THINKING_MARGIN,
);

/** `MAX_CRITIC_ISSUES` issues at the issue cap, each with a short id. */
export const CRITIC_MAX_OUTPUT_TOKENS = roundUp(
  MAX_CRITIC_ISSUES *
    ((MAX_CRITIQUE_ISSUE_LENGTH + MAX_SHORT_TEXT_LENGTH) * TOKENS_PER_CODE_POINT +
      TOKENS_PER_ITEM) +
    TOKENS_PER_OBJECT +
    MARGIN +
    THINKING_MARGIN,
);
