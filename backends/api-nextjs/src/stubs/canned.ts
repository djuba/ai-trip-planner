// STUB data, replaced in WU-09/10/11. Typed with the wire types so it cannot drift from the contract.
import type { ExtractResponse, PresentationModel, RecommendResponse } from '@vp/domain-schema/wire';

export const CANNED_EXTRACT = {
  status: 'ready',
  profile: {
    departure: { city: 'Minneapolis', mode: 'plane', maxStops: 0 },
    dateRange: { kind: 'fixed', start: '2030-02-10', end: '2030-02-17' },
    region: 'Hawaii',
    climate: 'tropical',
    experiences: ['beach', 'snorkeling'],
    people: [
      { userType: 'adult', age: 40 },
      { userType: 'adult', age: 38 },
    ],
  },
} satisfies ExtractResponse;

export const CANNED_RECOMMEND = {
  recommendations: [
    {
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
    },
  ],
  critique: { pass: true, unresolved: [] },
} satisfies RecommendResponse;

export const CANNED_PRESENT = {
  headline: 'A week of sun and snorkeling in Maui',
  intro: 'Here is a destination that fits your dates, climate and interests.',
  cards: [
    {
      recommendationId: 'rec-1',
      title: 'Maui, Hawaii',
      blurb: 'Warm beaches and calm snorkeling water in February.',
      highlights: ['Molokini snorkeling', 'Kaanapali Beach'],
      claims: [
        {
          kind: 'flight',
          statement: 'Flights from Minneapolis may be available with one stop.',
          verification: 'unverified',
        },
      ],
    },
  ],
} satisfies PresentationModel;
