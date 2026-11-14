// The LLM critic prompt (CLAUDE.md §7 stage 2b; WU-10 plan D9 and approval change 2). It reviews
// what code can't: fit to the profile and honest wording. The deterministic issues already found
// are passed in, so the critic doesn't count them twice. Everything per request is a data block.
import {
  MAX_CRITIQUE_ISSUE_LENGTH,
  type CritiqueIssue,
  type RecommendationDraft,
  type TripProfile,
} from '@vp/domain-schema/wire';
import type { PromptPair } from './extraction.ts';
import { DATA_BLOCK_RULE, dataBlock } from './prompt-data.ts';
import type { TripStart } from '../trip-month.ts';
import { tripStartLine, withIds } from './recommend.ts';

/** Most issues the critic is asked for; more are discarded (plan D8, approval change 8). */
export const MAX_CRITIC_ISSUES = 10;

export const CRITIC_SYSTEM = [
  'You review vacation recommendations before a traveler sees them, as the JSON schema you are ' +
    'given.',
  '',
  'You receive the reference date, the month the trip starts if known, the trip profile, the ' +
    'recommendations (each with an id), and the issues our automatic checks already found.',
  '',
  'Find problems only of these kinds:',
  '- The destination does not fit the requested region, climate, experiences, travelers, ' +
    'season or way of travel (for example, not reachable by car on a car trip).',
  '- The summary states a flight, lodging, price or schedule specific, which belongs in a claim.',
  '- A claim states something as a fact that nobody could know without live data, such as an ' +
    'exact price, a schedule or that a flight certainly runs, instead of wording it as something ' +
    'to check.',
  '',
  'Rules:',
  '- Do not repeat an issue that is already in the automatic checks, and do not judge how claims ' +
    'are labeled: our code sets the labels. Do not judge bestMonths or adultsOnly: our code checks ' +
    'them against the trip.',
  '- A recommendation that keeps the requested region and says no non-stop is listed is fine on ' +
    'that point.',
  `- Each issue is one plain sentence of at most ${MAX_CRITIQUE_ISSUE_LENGTH} characters, with ` +
    'the recommendation id it concerns, or null for the set as a whole. Give at most ' +
    `${MAX_CRITIC_ISSUES} issues.`,
  '- pass is true only when there are no issues; then issues is empty.',
  '- Ask nothing of the traveler and add nothing that is not about this trip.',
  `- ${DATA_BLOCK_RULE}`,
].join('\n');

export interface CriticPromptInput {
  profile: TripProfile;
  referenceDate: string;
  tripStart: TripStart | null;
  drafts: readonly RecommendationDraft[];
  /** Deterministic issues found on these drafts (code-written text). */
  alreadyFound: readonly CritiqueIssue[];
}

export function buildCriticPrompt(input: CriticPromptInput): PromptPair {
  const prompt = [
    `Reference date: ${input.referenceDate}`,
    tripStartLine(input.tripStart),
    '',
    'Trip profile:',
    dataBlock('profile', input.profile),
    '',
    'Recommendations:',
    dataBlock('recommendations', withIds(input.drafts)),
    '',
    'Issues our automatic checks found:',
    dataBlock('automaticIssues', input.alreadyFound),
  ].join('\n');
  return { system: CRITIC_SYSTEM, prompt };
}
