// STUB data, replaced in WU-11. Typed with the wire types so it cannot drift from the contract.
import type { PresentationModel } from '@vp/domain-schema/wire';

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
