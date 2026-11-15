import { readFileSync } from 'node:fs';
import {
  MAX_BLURB_LENGTH,
  MAX_CARD_TITLE_LENGTH,
  MAX_CLAIM_LENGTH,
  MAX_SHORT_TEXT_LENGTH,
  MAX_SUMMARY_LENGTH,
  PresentationCard,
  Recommendation,
  type FactualClaim,
  type TripProfile,
} from '@vp/domain-schema/wire';
import { describe, expect, it } from 'vitest';
import { fixtureStatement } from '../recommend-output.ts';
import { findNonstop, parseRouteData, resolveOrigin } from '../routes.ts';
import { cardData, fallbackCopy, recheckClaim } from './mapping.ts';

const routes = parseRouteData(
  JSON.parse(readFileSync(new URL('../../../data/routes.json', import.meta.url), 'utf8')),
);
const msp = resolveOrigin(routes, 'MSP');
const atl = resolveOrigin(routes, 'Atlanta');
if (msp === null || atl === null) throw new Error('routes.json lacks MSP or ATL');
const hnl = findNonstop(routes, 'MSP', 'HNL');
if (hnl === null) throw new Error('routes.json lacks MSP-HNL');

const fromMsp: TripProfile = { departure: { city: 'Minneapolis' } };
const mspStatement = fixtureStatement('MSP', hnl);

const fixtureClaim = (statement = mspStatement): FactualClaim => ({
  kind: 'flight',
  statement,
  verification: 'fixture',
});
const unverified: FactualClaim = {
  kind: 'lodging',
  statement: 'Resorts may be available; check current options.',
  verification: 'unverified',
};

/** Built through the wire schema, so the fixture cannot drift from the contract (CLAUDE.md §6.1). */
const recommendation = (overrides: Partial<Recommendation> = {}): Recommendation =>
  Recommendation.parse({
    id: 'rec-1',
    destination: 'Maui',
    summary: 'Warm beaches.',
    matchedExperiences: ['beach'],
    claims: [],
    ...overrides,
  });

describe('cardData', () => {
  it('AC-PRESENT-03: carries each id and its claims, in order, with unverified claims unchanged', () => {
    const recs = [
      recommendation({ id: 'rec-1', claims: [unverified, fixtureClaim()] }),
      recommendation({ id: 'rec-3', destination: 'Cancun', claims: [] }),
      recommendation({ id: 'rec-2', claims: [unverified] }),
    ];
    const cards = cardData(recs, fromMsp, routes);
    expect(cards.map((c) => c.recommendationId)).toEqual(['rec-1', 'rec-3', 'rec-2']);
    expect(cards[0]?.claims).toEqual([unverified, fixtureClaim()]);
    expect(cards[1]?.claims).toEqual([]);
    expect(cards[2]?.claims).toEqual([unverified]);
  });

  it('AC-PRESENT-04: resolves the origin from the profile and demotes a fixture claim without one', () => {
    const recs = [recommendation({ claims: [fixtureClaim()] })];
    expect(cardData(recs, fromMsp, routes)[0]?.claims[0]?.verification).toBe('fixture');
    expect(cardData(recs, {}, routes)[0]?.claims[0]?.verification).toBe('unverified');
    expect(cardData(recs, { departure: { city: null } }, routes)[0]?.claims[0]?.verification).toBe(
      'unverified',
    );
    expect(
      cardData(recs, { departure: { city: 'Nowhereville' } }, routes)[0]?.claims[0]?.verification,
    ).toBe('unverified');
  });
});

describe('recheckClaim', () => {
  it('AC-PRESENT-04: returns an unverified claim unchanged', () => {
    expect(recheckClaim(unverified, msp, routes)).toBe(unverified);
    expect(recheckClaim(unverified, null, routes)).toBe(unverified);
  });

  it('AC-PRESENT-04: keeps fixture when the statement matches a listed non-stop from the origin', () => {
    const claim = fixtureClaim();
    expect(recheckClaim(claim, msp, routes)).toEqual(claim);
  });

  it('AC-PRESENT-04: demotes fixture when the kind is not flight, keeping the statement', () => {
    const claim: FactualClaim = { ...fixtureClaim(), kind: 'lodging' };
    expect(recheckClaim(claim, msp, routes)).toEqual({ ...claim, verification: 'unverified' });
  });

  it('AC-PRESENT-04: demotes fixture when the statement was edited', () => {
    const claim = fixtureClaim(`${mspStatement} Book now!`);
    expect(recheckClaim(claim, msp, routes)).toEqual({ ...claim, verification: 'unverified' });
  });

  it('AC-PRESENT-04: demotes fixture when the route is not in the data', () => {
    const claim = fixtureClaim(fixtureStatement('MSP', { airport: 'XXX', city: 'Atlantis' }));
    expect(recheckClaim(claim, msp, routes)).toEqual({ ...claim, verification: 'unverified' });
  });

  it('AC-PRESENT-04: demotes fixture when the statement names a different origin than the traveler', () => {
    const claim = fixtureClaim();
    expect(recheckClaim(claim, atl, routes)).toEqual({ ...claim, verification: 'unverified' });
  });

  it('AC-PRESENT-04: demotes fixture when the traveler has no known origin', () => {
    const claim = fixtureClaim();
    expect(recheckClaim(claim, null, routes)).toEqual({ ...claim, verification: 'unverified' });
  });
});

describe('fallbackCopy', () => {
  it('AC-PRESENT-05: uses the destination as title and the summary as blurb, with no highlights', () => {
    expect(fallbackCopy(recommendation())).toEqual({
      title: 'Maui',
      blurb: 'Warm beaches.',
      highlights: [],
    });
  });

  it('AC-PRESENT-05: a recommendation at its caps always yields a valid card', () => {
    expect(MAX_SHORT_TEXT_LENGTH).toBeLessThanOrEqual(MAX_CARD_TITLE_LENGTH);
    expect(MAX_SUMMARY_LENGTH).toBeLessThanOrEqual(MAX_BLURB_LENGTH);
    const full = recommendation({
      destination: 'D'.repeat(MAX_SHORT_TEXT_LENGTH),
      summary: 'S'.repeat(MAX_SUMMARY_LENGTH),
      claims: [
        { kind: 'activity', statement: 'C'.repeat(MAX_CLAIM_LENGTH), verification: 'unverified' },
      ],
    });
    const card = { recommendationId: full.id, claims: full.claims, ...fallbackCopy(full) };
    expect(PresentationCard.safeParse(card).success).toBe(true);
  });
});
