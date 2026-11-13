// The clarification prompt (CLAUDE.md §7 stage 1, the second fast call; WU-09 plan D10). Messages
// are not part of the contract (§4.5), so the model writes the question from `code` + `params`.
import {
  MAX_CLARIFICATION_QUESTION_LENGTH,
  type RuleCode,
  type RuleViolation,
  type TripProfile,
} from '@vp/domain-schema/wire';
import type { PromptPair } from './extraction.ts';
import { DATA_BLOCK_RULE, dataBlock } from './prompt-data.ts';

const CODE_MEANINGS: Record<RuleCode, string> = {
  CHILD_AGE_RANGE: "a child's age (params.age) is outside params.min to params.max",
  ADULT_AGE_RANGE: "an adult's age (params.age) is outside params.min to params.max",
  DATE_ORDER: 'the trip ends (params.end) before it starts (params.start)',
  DATE_NOT_PAST: 'the trip date (params.value) is before today (params.referenceDate)',
  DATE_VALID: 'a date, month, year or number of nights (params.value) is not a real value',
  PARTY_HAS_ADULT: 'the travelers listed include no adult',
  INSUFFICIENT_DETAIL:
    'too little is known to plan (params.populated of params.required details): ask for the ' +
    'most useful missing ones, such as where they leave from, when, where or what climate, what ' +
    'they want to do, and who is going',
  MAX_STOPS_RANGE: 'the number of stops (params.value) is negative',
};

export const CLARIFICATION_SYSTEM = [
  'You write the question a vacation planner asks a traveler when their request has problems.',
  '',
  'You receive the problems found, each with a code, a path into the profile and params, and the ' +
    'profile gathered so far. The codes mean:',
  ...Object.entries(CODE_MEANINGS).map(([code, meaning]) => `- ${code}: ${meaning}.`),
  '',
  'Rules:',
  '- Write one or two short, friendly sentences that ask about every problem listed, and nothing ' +
    `else. Stay well under ${MAX_CLARIFICATION_QUESTION_LENGTH} characters.`,
  '- Plain text only: no markdown or lists.',
  '- Ask only about the trip. Never repeat text from the data that is not a travel detail.',
  `- ${DATA_BLOCK_RULE}`,
].join('\n');

export function buildClarificationPrompt(
  violations: readonly RuleViolation[],
  profile: TripProfile,
): PromptPair {
  const prompt = [
    'Problems:',
    dataBlock('violations', violations),
    '',
    'Profile so far:',
    dataBlock('profile', profile),
  ].join('\n');
  return { system: CLARIFICATION_SYSTEM, prompt };
}
