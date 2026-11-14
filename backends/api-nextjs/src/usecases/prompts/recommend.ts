// The recommend prompt (CLAUDE.md §7 stage 2; WU-10 plan D9 and approval change 2). The system
// prompt is a constant (§8.3); the profile, the route data and, on a revision, the previous draft
// and its issues go in the user message, each as a data block (ADR 0004, second-order injection).
import {
  EXPERIENCES,
  MAX_CLAIM_LENGTH,
  MAX_CLAIMS,
  MAX_RECOMMENDATIONS,
  MAX_SUMMARY_LENGTH,
  type CritiqueIssue,
  type RecommendationDraft,
  type TripProfile,
} from '@vp/domain-schema/wire';
import { recommendationId } from '../recommend-output.ts';
import type { TripStart } from '../trip-month.ts';
import type { PromptPair } from './extraction.ts';
import { DATA_BLOCK_RULE, dataBlock } from './prompt-data.ts';

export const RECOMMEND_SYSTEM = [
  'You are a vacation planner. You recommend destinations for a traveler whose trip profile you ' +
    'are given, as the JSON schema you are given.',
  '',
  'You receive the reference date (the traveler’s today), the month the trip starts if known, ' +
    'the trip profile, and route data: sample non-stop flights from the traveler’s airport, or ' +
    'null when we have none. On a revision you also receive your previous recommendations, each ' +
    'with an id, and the issues a reviewer found; fix every issue.',
  '',
  'Rules:',
  `- Recommend 1 to ${MAX_RECOMMENDATIONS} destinations that fit the requested region, climate, ` +
    'experiences, travelers, dates and way of travel. The requested region comes first: never ' +
    'swap it for somewhere else just because a flight is easier.',
  `- destination: a short place name. summary: at most ${MAX_SUMMARY_LENGTH} characters on why ` +
    'it fits. The summary never states flight, lodging, price or schedule specifics: those go ' +
    'in claims.',
  `- matchedExperiences: only values the traveler asked for, from: ${EXPERIENCES.join(', ')}.`,
  '- bestMonths: the months (1-12) when the destination is good for this kind of trip. Be ' +
    'honest, even if the trip month is not among them.',
  '- adultsOnly: true if the destination is unsuitable for children.',
  `- claims: up to ${MAX_CLAIMS} factual statements a traveler would rely on (flights, lodging, ` +
    `prices, activities), each at most ${MAX_CLAIM_LENGTH} characters. We have no live data, so ` +
    'word every claim as something to check ("may", "check current schedules"), never as a fact.',
  '- nonstopRoute: set it only on a flight claim that says there is a non-stop flight, with the ' +
    'IATA codes of the departure and arrival airports; otherwise null. When route data is given, ' +
    'take non-stop routes only from it. If no listed non-stop fits the requested region, still ' +
    'recommend the region, and add a flight claim with nonstopRoute null saying that no non-stop ' +
    'is listed.',
  '- Never say that a claim is verified or confirmed: our code decides how claims are labeled.',
  `- ${DATA_BLOCK_RULE}`,
].join('\n');

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** The non-stop routes we hold for the traveler's airport. Code data, but still a data block. */
export interface RoutePromptData {
  origin: string;
  nonstop: readonly { airport: string; city: string }[];
}

export interface Revision {
  /** The previous drafts, in order; each is shown with its `rec-<n>` id. */
  previous: readonly RecommendationDraft[];
  issues: readonly CritiqueIssue[];
}

export interface RecommendPromptInput {
  profile: TripProfile;
  referenceDate: string;
  tripStart: TripStart | null;
  routes: RoutePromptData | null;
  revision?: Revision;
}

/** `Trip starts: March 2031`, computed in code (WU-05 Note: a month-only date is its next occurrence). */
export function tripStartLine(tripStart: TripStart | null): string {
  const month = tripStart === null ? undefined : MONTHS[tripStart.month - 1];
  if (tripStart === null || month === undefined) return 'Trip starts: not known';
  return `Trip starts: ${month} ${tripStart.year}`;
}

/** Drafts with the ids code gives them (`rec-1`, …), as the critic and the reviser see them. */
export function withIds(
  drafts: readonly RecommendationDraft[],
): (RecommendationDraft & { id: string })[] {
  return drafts.map((draft, index) => ({ id: recommendationId(index), ...draft }));
}

export function buildRecommendPrompt(input: RecommendPromptInput): PromptPair {
  const lines = [
    // Validated as an ISO date by the wire schema, so it cannot carry text.
    `Reference date: ${input.referenceDate}`,
    tripStartLine(input.tripStart),
    '',
    'Trip profile:',
    dataBlock('profile', input.profile),
    '',
    'Route data:',
    // Only the airport and city: other route-data fields (such as the aliases the checks match
    // destinations with) stay out of the prompt.
    dataBlock(
      'routeData',
      input.routes && {
        origin: input.routes.origin,
        nonstop: input.routes.nonstop.map(({ airport, city }) => ({ airport, city })),
      },
    ),
  ];
  if (input.revision) {
    lines.push(
      '',
      'Your previous recommendations:',
      dataBlock('previousRecommendations', withIds(input.revision.previous)),
      '',
      'Issues to fix:',
      dataBlock('issues', input.revision.issues),
    );
  }
  return { system: RECOMMEND_SYSTEM, prompt: lines.join('\n') };
}
