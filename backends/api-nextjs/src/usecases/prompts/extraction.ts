// The extraction prompt (CLAUDE.md §7 stage 1; WU-09 plan D10). The system prompt is a constant, so
// prompt caching and cassette keys hold (§8.3); everything per request goes in the user message.
import { EXPERIENCES, type Experience, type ExtractRequest } from '@vp/domain-schema/wire';
import { DATA_BLOCK_RULE, dataBlock } from './prompt-data.ts';

const EXPERIENCE_MEANINGS: Record<Experience, string> = {
  beach: 'time on a beach',
  pool: 'a swimming pool',
  golf: 'playing golf',
  'go-karts': 'go-kart racing',
  hiking: 'hiking or trekking',
  snorkeling: 'snorkeling',
  'theme-parks': 'theme or amusement parks',
  museums: 'museums or galleries',
  nightlife: 'bars, clubs or nightlife',
  skiing: 'skiing or snowboarding',
};

export const EXTRACTION_SYSTEM = [
  "You turn a traveler's vacation request into the JSON schema you are given.",
  '',
  "You receive the reference date (the traveler's today), the profile gathered so far in this " +
    "conversation (null on the first message), and the traveler's new message.",
  '',
  'Rules:',
  '- Return the full updated profile, not only what changed: start from the current profile and ' +
    'apply the new message. When the message corrects or replaces something, the new value wins.',
  '- Use null for anything neither the current profile nor the message mentions. Never guess.',
  '- departure: the city they leave from, the mode (plane, car or train), and maxStops, the most ' +
    'stops they accept when flying, where 0 means non-stop only.',
  '- dateRange: use kind "fixed" with start and end as YYYY-MM-DD when they give specific dates. ' +
    'Otherwise use kind "flexible" with month (1-12), year, durationNights and a short note, each ' +
    'null if not given. Resolve relative dates such as "next March" against the reference date.',
  '- region: where they want to go, in their words. climate: only if they describe the weather ' +
    'they want.',
  '- experiences: only these values, each for what it means: ' +
    EXPERIENCES.map((value) => `${value} (${EXPERIENCE_MEANINGS[value]})`).join(', ') +
    '. Put anything else they want to do in unmappedExperiences, a few words each.',
  '- people: one entry per traveler. userType is "child" for anyone they call a child, kid, son, ' +
    'daughter or baby, and "adult" otherwise. Copy ages exactly as stated, even if they look ' +
    'inconsistent: our code checks them, so never correct them.',
  `- ${DATA_BLOCK_RULE}`,
].join('\n');

export interface PromptPair {
  system: string;
  prompt: string;
}

export function buildExtractionPrompt(request: ExtractRequest): PromptPair {
  const prompt = [
    // Validated as an ISO date by the wire schema, so it cannot carry text.
    `Reference date: ${request.referenceDate}`,
    '',
    'Current profile:',
    dataBlock('currentProfile', request.currentProfile ?? null),
    '',
    'New message:',
    dataBlock('message', request.message),
  ].join('\n');
  return { system: EXTRACTION_SYSTEM, prompt };
}
