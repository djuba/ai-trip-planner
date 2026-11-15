// The present prompt (CLAUDE.md §7 stage 3; WU-11 plan D4, D7, D12). The system prompt is a
// constant (§8.3); the profile and the recommendations go in the user message as data blocks. The
// model sees only the prose-bearing fields of each recommendation: no claims and no ids, so it
// cannot restate or relabel a fact (AC-PRESENT-09).
import {
  MAX_BLURB_LENGTH,
  MAX_CARD_TITLE_LENGTH,
  MAX_HEADLINE_LENGTH,
  MAX_HIGHLIGHT_LENGTH,
  MAX_INTRO_LENGTH,
  type PresentationModel,
  type Recommendation,
  type TripProfile,
} from '@vp/domain-schema/wire';
import type { PromptPair } from './extraction.ts';
import { DATA_BLOCK_RULE, dataBlock } from './prompt-data.ts';

const half = (cap: number): number => Math.floor(cap / 2);

export const PRESENT_SYSTEM = [
  'You write presentation copy for vacation recommendations, as the JSON schema you are given.',
  '',
  'You receive the traveler’s trip profile and the recommended destinations, each with a ' +
    'summary and the experiences it matches.',
  '',
  'Rules:',
  '- Write one card per recommendation, in the order given, with the same number of cards.',
  '- Write prose only. Never state flight, lodging, price or schedule specifics, and never say ' +
    'that anything is verified or confirmed: our code shows those facts separately.',
  `- headline: at most ${half(MAX_HEADLINE_LENGTH)} characters. intro: at most ` +
    `${half(MAX_INTRO_LENGTH)} characters, addressed to the traveler.`,
  `- Each card: title at most ${half(MAX_CARD_TITLE_LENGTH)} characters (the destination), ` +
    `blurb at most ${half(MAX_BLURB_LENGTH)} characters, and 2 to 4 highlights of at most ` +
    `${half(MAX_HIGHLIGHT_LENGTH)} characters each.`,
  `- ${DATA_BLOCK_RULE}`,
].join('\n');

export interface PresentPromptInput {
  profile: TripProfile;
  recommendations: Recommendation[];
}

export function buildPresentPrompt(input: PresentPromptInput): PromptPair {
  const lines = [
    'Trip profile:',
    dataBlock('profile', input.profile),
    '',
    'Recommendations:',
    dataBlock(
      'recommendations',
      input.recommendations.map(({ destination, summary, matchedExperiences }) => ({
        destination,
        summary,
        matchedExperiences,
      })),
    ),
  ];
  return { system: PRESENT_SYSTEM, prompt: lines.join('\n') };
}

/** Streamed when the request has no recommendations: the model is not called (D12). */
export const EMPTY_PRESENTATION: PresentationModel = {
  headline: 'No matching destinations this time',
  intro:
    'None of the destinations we considered matched this request. Try adjusting your dates, ' +
    'region or the experiences you want, and ask again.',
  cards: [],
};
