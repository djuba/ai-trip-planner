// Shared request bodies and the endpoint list, so the checks and the self-test agree.
// Bodies are literals validated against the request schemas, so test inputs cannot drift.
import { assertSchema } from '../../support/schemas.ts';

export interface PostEndpoint {
  path: string;
  /** The generated request schema id. */
  schema: string;
}

export const POST_ENDPOINTS: readonly PostEndpoint[] = [
  { path: '/v1/trip/extract', schema: 'ExtractRequest' },
  { path: '/v1/trip/recommend', schema: 'RecommendRequest' },
  { path: '/v1/trip/present', schema: 'PresentRequest' },
];

export const HEALTH_PATH = '/v1/health';
export const EXTRACT_PATH = '/v1/trip/extract';
export const RECOMMEND_PATH = '/v1/trip/recommend';
export const PRESENT_PATH = '/v1/trip/present';

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

const RECOMMENDATION = {
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

function valid<T>(schema: string, body: T): T {
  assertSchema(schema, body, `test input for ${schema}`);
  return body;
}

export const extractRequest = () =>
  valid('ExtractRequest', {
    message: 'A week in Hawaii in February, two adults, beach and snorkeling',
    referenceDate: '2030-01-15',
  });

export const recommendRequest = () =>
  valid('RecommendRequest', { profile: PROFILE, referenceDate: '2030-01-15' });

export const presentRequest = () =>
  valid('PresentRequest', { profile: PROFILE, recommendations: [RECOMMENDATION] });
