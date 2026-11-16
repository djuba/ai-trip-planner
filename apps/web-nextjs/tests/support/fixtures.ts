// Contract-valid sample bodies, built through `buildFixture` so they cannot drift from the wire
// schemas (CLAUDE.md §6.1). Shared by the msw, Pact and Playwright tests.
//
// The request bodies are copied exactly (values and key order) from
// `tests/contract/conformance/checks/requests.ts`. That file is black-box tooling the web app
// cannot import, and the Pact interactions must reuse requests that already have LLM cassettes,
// since cassettes are keyed by a hash of the model request built from the HTTP request.
import { buildFixture } from '@vp/domain-schema/testing';
import {
  ErrorResponse,
  ExtractRequest,
  ExtractResponse,
  HealthResponse,
  PresentationModel,
  PresentRequest,
  RecommendRequest,
  RecommendResponse,
} from '@vp/domain-schema/wire';

export const PROFILE = {
  departure: { city: 'Minneapolis', mode: 'plane', maxStops: 0 },
  dateRange: { kind: 'fixed', start: '2030-02-10', end: '2030-02-17' },
  region: 'Hawaii',
  climate: 'tropical',
  experiences: ['beach', 'snorkeling'],
  people: [
    { userType: 'adult', age: 40 },
    { userType: 'adult', age: 38 },
  ],
};

export const RECOMMENDATION = {
  id: 'rec-1',
  destination: 'Maui, Hawaii',
  summary: 'Warm beaches and calm snorkeling water in February.',
  matchedExperiences: ['beach', 'snorkeling'],
  claims: [
    {
      kind: 'flight',
      statement: 'Flights from Minneapolis may be available with one stop.',
      verification: 'unverified',
    },
  ],
};

export const extractRequest = () =>
  buildFixture(ExtractRequest, {
    message: 'A week in Hawaii in February, two adults, beach and snorkeling',
    referenceDate: '2030-01-15',
  });

/** Too little to plan a trip from, so a backend must ask for more. */
export const vagueExtractRequest = () =>
  buildFixture(ExtractRequest, { message: 'Somewhere warm', referenceDate: '2030-01-15' });

/** A complete profile plus a confirmation, so a backend has nothing left to ask. */
export const confirmExtractRequest = () =>
  buildFixture(ExtractRequest, {
    message: 'That all sounds right.',
    currentProfile: PROFILE,
    referenceDate: '2030-01-15',
  });

export const recommendRequest = () =>
  buildFixture(RecommendRequest, { profile: PROFILE, referenceDate: '2030-01-15' });

/** A schema-valid request whose profile is not ready: a party with no adult (PARTY_HAS_ADULT). */
export const notReadyRecommendRequest = () =>
  buildFixture(RecommendRequest, {
    profile: { ...PROFILE, people: [{ userType: 'child', age: 8 }] },
    referenceDate: '2030-01-15',
  });

export const presentRequest = () =>
  buildFixture(PresentRequest, { profile: PROFILE, recommendations: [RECOMMENDATION] });

// Sample responses.

/** `contractVersion` matches `spec/generated/constants.json`. */
export const healthResponse = () =>
  buildFixture(HealthResponse, { status: 'ok', contractVersion: '0.8.0' });

export const needsClarificationResponse = () =>
  buildFixture(ExtractResponse, {
    status: 'needs_clarification',
    profile: { climate: 'warm' },
    violations: [{ code: 'INSUFFICIENT_DETAIL', path: '', params: { populated: 1, required: 3 } }],
    clarificationQuestion: 'Where would you like to go, and when?',
  });

export const readyResponse = () =>
  buildFixture(ExtractResponse, { status: 'ready', profile: PROFILE });

export const recommendResponse = () =>
  buildFixture(RecommendResponse, {
    recommendations: [RECOMMENDATION],
    critique: { pass: true, unresolved: [] },
  });

export const errorBody = (code: string, message: string) =>
  buildFixture(ErrorResponse, { error: { code, message } });

/** A child aged 19 (CHILD_AGE_RANGE); the question carries markup to check it shows as text. */
export const childAgeClarificationResponse = () =>
  buildFixture(ExtractResponse, {
    status: 'needs_clarification',
    profile: {
      region: 'Hawaii',
      climate: 'tropical',
      people: [
        { userType: 'adult', age: 40 },
        { userType: 'child', age: 19 },
      ],
    },
    violations: [
      { code: 'CHILD_AGE_RANGE', path: '/people/1/age', params: { age: 19, min: 0, max: 17 } },
    ],
    clarificationQuestion: 'Is the 19-year-old traveling as an adult? <b>Tell me</b>',
  });

/** The answer to `childAgeClarificationResponse`: the traveler is an adult, so nothing is left. */
export const readyAfterCorrectionResponse = () =>
  buildFixture(ExtractResponse, {
    status: 'ready',
    profile: {
      region: 'Hawaii',
      climate: 'tropical',
      dateRange: { kind: 'flexible', month: 2, year: 2030, durationNights: 7 },
      people: [
        { userType: 'adult', age: 40 },
        { userType: 'adult', age: 19 },
      ],
    },
  });

// Recommendations and their presentation (WU-14 plan fix 1). Two trips, so a test can see one
// card finish while the next is still streaming; both verification labels appear.

const TRIP_RECOMMENDATIONS = [
  {
    id: 'rec-1',
    destination: 'Maui, Hawaii',
    summary: 'Warm beaches and calm snorkeling water in February.',
    matchedExperiences: ['beach', 'snorkeling'],
    claims: [
      {
        kind: 'flight',
        statement: 'Non-stop flights run from MSP to OGG.',
        verification: 'fixture',
      },
      {
        kind: 'lodging',
        statement: 'Beachfront condos are common in Kihei.',
        verification: 'unverified',
      },
    ],
  },
  {
    id: 'rec-2',
    destination: 'Kauai, Hawaii',
    summary: 'Quieter beaches and reef snorkeling.',
    matchedExperiences: ['beach', 'snorkeling'],
    claims: [
      {
        kind: 'price',
        statement: 'Rentals run about $250 a night in February.',
        verification: 'unverified',
      },
    ],
  },
];

export const tripRecommendResponse = () =>
  buildFixture(RecommendResponse, {
    recommendations: TRIP_RECOMMENDATIONS,
    critique: { pass: true, unresolved: [] },
  });

/** The critic still had a concern after its revise cap (AC-CARDS-08). */
export const tripRecommendWithConcernsResponse = () =>
  buildFixture(RecommendResponse, {
    recommendations: TRIP_RECOMMENDATIONS,
    critique: {
      pass: false,
      unresolved: [{ recommendationId: 'rec-2', issue: 'The nightly price may be out of date.' }],
    },
  });

export const emptyRecommendResponse = () =>
  buildFixture(RecommendResponse, {
    recommendations: [],
    critique: { pass: true, unresolved: [] },
  });

/** What `/present` streams for `tripRecommendResponse`, in the server's key order. */
export const tripPresentation = () =>
  buildFixture(PresentationModel, {
    headline: 'Two calm Hawaiian beach weeks',
    intro: 'Both islands are warm in February and good for snorkeling.',
    cards: [
      {
        recommendationId: 'rec-1',
        claims: TRIP_RECOMMENDATIONS[0]!.claims,
        title: 'Maui: beaches and turtles',
        blurb: 'Calm turquoise bays on the south shore, with turtles close to the beach.',
        highlights: ['Snorkel at Molokini', 'Sunset in Kihei'],
      },
      {
        recommendationId: 'rec-2',
        claims: TRIP_RECOMMENDATIONS[1]!.claims,
        title: 'Kauai: quiet reefs',
        blurb: 'Fewer crowds and reef snorkeling at Poipu.',
        highlights: ['Poipu Beach', 'Waimea Canyon lookout'],
      },
    ],
  });

/** What `/present` streams for no recommendations (AC-PRESENT-13). */
export const emptyPresentation = () =>
  buildFixture(PresentationModel, {
    headline: 'No trips to show',
    intro: 'Nothing matched this profile.',
    cards: [],
  });
