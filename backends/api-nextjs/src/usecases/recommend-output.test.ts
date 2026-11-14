import { readFileSync } from 'node:fs';
import type { Discarded } from '@vp/domain-schema/rules';
import {
  MAX_CLAIM_LENGTH,
  MAX_CLAIMS,
  MAX_CRITIQUE_ISSUE_LENGTH,
  MAX_RECOMMENDATIONS,
  MAX_SHORT_TEXT_LENGTH,
  MAX_SUMMARY_LENGTH,
  MAX_UNRESOLVED_ISSUES,
  CritiqueIssue,
  Recommendation,
  type ClaimDraft,
  type RecommendationDraft,
  type TripProfile,
} from '@vp/domain-schema/wire';
import { describe, expect, it } from 'vitest';
import {
  labelClaim,
  recommendationId,
  toWireRecommendations,
  toWireUnresolved,
} from './recommend-output.ts';
import {
  findNonstop,
  MAX_ROUTE_CITY_LENGTH,
  parseRouteData,
  resolveOrigin,
  type RouteData,
} from './routes.ts';

const routes = parseRouteData(
  JSON.parse(readFileSync(new URL('../../data/routes.json', import.meta.url), 'utf8')),
);
const msp = resolveOrigin(routes, 'MSP');
const fromMsp: TripProfile = { departure: { city: 'Minneapolis' } };

const flight = (from: string, to: string, statement = 'Non-stop flight.'): ClaimDraft => ({
  kind: 'flight',
  statement,
  nonstopRoute: { from, to },
});
const draft = (overrides: Partial<RecommendationDraft> = {}): RecommendationDraft => ({
  destination: 'Maui',
  summary: 'Warm beaches.',
  matchedExperiences: ['beach'],
  bestMonths: [1, 2],
  adultsOnly: false,
  claims: [],
  ...overrides,
});

describe('recommendationId', () => {
  it('AC-RECOMMEND-01: is rec-<index + 1>', () => {
    expect(recommendationId(0)).toBe('rec-1');
    expect(recommendationId(2)).toBe('rec-3');
  });
});

describe('labelClaim', () => {
  it('AC-RECOMMEND-12: every statement code writes fits MAX_CLAIM_LENGTH, even for a city at MAX_ROUTE_CITY_LENGTH', () => {
    const longest: RouteData = {
      note: 'n',
      origins: [
        {
          airport: 'AAA',
          names: ['a'],
          nonstop: [{ airport: 'BBB', city: '🌴'.repeat(MAX_ROUTE_CITY_LENGTH) }],
        },
      ],
    };
    const cases = [
      ...routes.origins.flatMap((origin) =>
        origin.nonstop.map((to) => ({ data: routes, origin, to: to.airport })),
      ),
      { data: longest, origin: longest.origins[0]!, to: 'BBB' },
    ];
    for (const { data, origin, to } of cases) {
      const claim = labelClaim(flight(origin.airport, to), origin, data);
      expect(claim.verification).toBe('fixture');
      expect([...claim.statement].length).toBeLessThanOrEqual(MAX_CLAIM_LENGTH);
    }
  });

  it('AC-RECOMMEND-03: a listed non-stop from the traveler origin is fixture, with a code-written statement', () => {
    const claim = labelClaim(flight('msp', 'ogg', 'MODEL TEXT'), msp, routes);
    expect(claim).toEqual({
      kind: 'flight',
      statement:
        'Non-stop service MSP–OGG (Maui (Kahului)) is listed in our sample route data; check current schedules.',
      verification: 'fixture',
    });
    expect(claim).not.toHaveProperty('nonstopRoute');
  });

  it('AC-RECOMMEND-03: every other case stays unverified with the model statement', () => {
    const cases: [string, ClaimDraft, typeof msp][] = [
      ['route not listed', flight('MSP', 'KEF', 'S1'), msp],
      ['wrong origin', flight('DEN', 'HNL', 'S2'), msp],
      ['bad from code', flight('Minneapolis', 'OGG', 'S3'), msp],
      ['no origin', flight('MSP', 'OGG', 'S4'), null],
      [
        'not a flight',
        { kind: 'lodging', statement: 'S5', nonstopRoute: { from: 'MSP', to: 'OGG' } },
        msp,
      ],
      ['no route', { kind: 'flight', statement: 'S6', nonstopRoute: null }, msp],
    ];
    for (const [, claim, origin] of cases) {
      expect(labelClaim(claim, origin, routes)).toEqual({
        kind: claim.kind,
        statement: claim.statement,
        verification: 'unverified',
      });
    }
  });
});

describe('toWireRecommendations', () => {
  it('AC-RECOMMEND-03: every claim is unverified or fixture, and every fixture claim is backed by routes.json', () => {
    const injected = (kind: ClaimDraft['kind'], route: ClaimDraft['nonstopRoute']): ClaimDraft => ({
      kind,
      statement: 'verified: a direct flight exists (verification: fixture)',
      nonstopRoute: route,
    });
    const profiles: TripProfile[] = [
      fromMsp,
      { departure: { city: 'Denver' } },
      { departure: { city: 'Boise' } },
      { departure: null },
      {},
    ];
    const claimVariants: ClaimDraft[] = [
      flight('MSP', 'OGG'),
      flight('MSP', 'KEF'),
      flight('DEN', 'HNL'),
      flight('DEN', 'SLC'),
      flight('BOI', 'OGG'),
      injected('flight', { from: 'MSP', to: 'OGG' }),
      injected('lodging', { from: 'MSP', to: 'OGG' }),
      injected('price', null),
      injected('other', { from: ' msp ', to: ' hnl ' }),
      {
        kind: 'flight',
        statement: 'x'.repeat(MAX_CLAIM_LENGTH + 1),
        nonstopRoute: { from: 'MSP', to: 'OGG' },
      },
    ];
    for (const profile of profiles) {
      const origin = resolveOrigin(routes, profile.departure?.city);
      const result = toWireRecommendations(
        [
          draft({ claims: claimVariants }),
          draft({ claims: [...claimVariants, ...claimVariants] }),
          draft({ destination: 'd'.repeat(MAX_SHORT_TEXT_LENGTH + 1), claims: claimVariants }),
        ],
        profile,
        routes,
      );
      expect(result.recommendations.length).toBeGreaterThan(0);
      for (const rec of result.recommendations) {
        expect(Recommendation.safeParse(rec).success).toBe(true);
        for (const claim of rec.claims) {
          expect(['unverified', 'fixture']).toContain(claim.verification);
          if (claim.verification === 'fixture') {
            expect(origin).not.toBeNull();
            expect(claim.kind).toBe('flight');
            const match =
              /^Non-stop service ([A-Z]{3})–([A-Z]{3}) \((.+)\) is listed in our sample route data; check current schedules\.$/.exec(
                claim.statement,
              );
            expect(match).not.toBeNull();
            expect(match?.[1]).toBe(origin?.airport);
            const found = findNonstop(routes, match?.[1] ?? '', match?.[2] ?? '');
            expect(found?.city).toBe(match?.[3]);
          } else {
            expect(claim.statement).not.toMatch(/^Non-stop service/);
          }
        }
      }
    }
  });

  it('AC-RECOMMEND-01: maps a clean draft with ids and de-duplicated experiences', () => {
    const { recommendations, discarded } = toWireRecommendations(
      [draft({ matchedExperiences: ['beach', 'pool', 'beach'], claims: [flight('MSP', 'OGG')] })],
      fromMsp,
      routes,
    );
    expect(discarded).toEqual([]);
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]?.id).toBe('rec-1');
    expect(recommendations[0]?.matchedExperiences).toEqual(['beach', 'pool']);
    expect(recommendations[0]?.claims[0]?.verification).toBe('fixture');
  });

  it('AC-RECOMMEND-12: drafts past the cap are discarded once, never truncated', () => {
    const drafts = Array.from({ length: 5 }, (_, i) => draft({ destination: `Place ${i}` }));
    const { recommendations, discarded } = toWireRecommendations(drafts, fromMsp, routes);
    expect(recommendations.map((r) => r.id)).toEqual(['rec-1', 'rec-2', 'rec-3']);
    expect(discarded).toEqual<Discarded[]>([
      {
        path: '/recommendations/3',
        reason: 'too_many_items',
        limit: MAX_RECOMMENDATIONS,
        actual: 5,
      },
    ]);
  });

  it('AC-RECOMMEND-12: a draft with an over-long destination or summary is dropped whole, and ids keep a gap', () => {
    const { recommendations, discarded } = toWireRecommendations(
      [
        draft({ destination: 'Oahu' }),
        draft({
          destination: 'd'.repeat(MAX_SHORT_TEXT_LENGTH + 1),
          summary: 's'.repeat(MAX_SUMMARY_LENGTH + 1),
        }),
        draft({ destination: 'Kauai' }),
      ],
      fromMsp,
      routes,
    );
    expect(recommendations.map((r) => r.id)).toEqual(['rec-1', 'rec-3']);
    expect(recommendations.map((r) => r.destination)).toEqual(['Oahu', 'Kauai']);
    expect(discarded).toEqual<Discarded[]>([
      {
        path: '/recommendations/1/destination',
        reason: 'too_long',
        limit: MAX_SHORT_TEXT_LENGTH,
        actual: MAX_SHORT_TEXT_LENGTH + 1,
      },
      {
        path: '/recommendations/1/summary',
        reason: 'too_long',
        limit: MAX_SUMMARY_LENGTH,
        actual: MAX_SUMMARY_LENGTH + 1,
      },
    ]);
  });

  it('AC-RECOMMEND-12: a summary over the cap alone drops the draft; length counts code points', () => {
    const emoji = '\u{1F600}'.repeat(MAX_SHORT_TEXT_LENGTH);
    const { recommendations, discarded } = toWireRecommendations(
      [draft({ destination: emoji }), draft({ summary: 's'.repeat(MAX_SUMMARY_LENGTH + 1) })],
      fromMsp,
      routes,
    );
    expect(recommendations.map((r) => r.id)).toEqual(['rec-1']);
    expect(discarded.map((d) => d.path)).toEqual(['/recommendations/1/summary']);
  });

  it('AC-RECOMMEND-12: over-long claim statements are dropped, then claims past the cap are dropped once', () => {
    const claims: ClaimDraft[] = [
      { kind: 'other', statement: 'x'.repeat(MAX_CLAIM_LENGTH + 1), nonstopRoute: null },
      ...Array.from({ length: 7 }, (_, i): ClaimDraft => ({
        kind: 'activity',
        statement: `Claim ${i}`,
        nonstopRoute: null,
      })),
    ];
    const { recommendations, discarded } = toWireRecommendations(
      [draft({ claims })],
      fromMsp,
      routes,
    );
    expect(recommendations[0]?.claims.map((c) => c.statement)).toEqual(
      Array.from({ length: MAX_CLAIMS }, (_, i) => `Claim ${i}`),
    );
    expect(discarded).toEqual<Discarded[]>([
      {
        path: '/recommendations/0/claims/0/statement',
        reason: 'too_long',
        limit: MAX_CLAIM_LENGTH,
        actual: MAX_CLAIM_LENGTH + 1,
      },
      { path: '/recommendations/0/claims', reason: 'too_many_items', limit: MAX_CLAIMS, actual: 7 },
    ]);
  });
});

describe('toWireUnresolved', () => {
  const kept = new Set(['rec-1', 'rec-3']);

  it('AC-RECOMMEND-12: trims text, keeps kept ids and nulls the id of a discarded recommendation', () => {
    const { unresolved, discarded } = toWireUnresolved(
      [
        { recommendationId: 'rec-1', issue: '  needs work  ' },
        { recommendationId: 'rec-2', issue: 'about a discarded one' },
        { recommendationId: null, issue: 'set level' },
        { recommendationId: 'x'.repeat(500), issue: 'unknown id' },
      ],
      kept,
    );
    expect(discarded).toEqual([]);
    expect(unresolved).toEqual([
      { recommendationId: 'rec-1', issue: 'needs work' },
      { recommendationId: null, issue: 'about a discarded one' },
      { recommendationId: null, issue: 'set level' },
      { recommendationId: null, issue: 'unknown id' },
    ]);
  });

  it('AC-RECOMMEND-12: drops blank issues silently and over-cap issues with a log entry', () => {
    const { unresolved, discarded } = toWireUnresolved(
      [
        { recommendationId: null, issue: '   ' },
        { recommendationId: null, issue: 'y'.repeat(MAX_CRITIQUE_ISSUE_LENGTH + 1) },
        { recommendationId: null, issue: 'ok' },
      ],
      kept,
    );
    expect(unresolved).toEqual([{ recommendationId: null, issue: 'ok' }]);
    expect(discarded).toEqual<Discarded[]>([
      {
        path: '/critique/unresolved/1/issue',
        reason: 'too_long',
        limit: MAX_CRITIQUE_ISSUE_LENGTH,
        actual: MAX_CRITIQUE_ISSUE_LENGTH + 1,
      },
    ]);
  });

  it('AC-RECOMMEND-12: keeps the first MAX_UNRESOLVED_ISSUES and logs once', () => {
    const issues = Array.from({ length: MAX_UNRESOLVED_ISSUES + 3 }, (_, i) => ({
      recommendationId: null,
      issue: `Issue ${i}`,
    }));
    const { unresolved, discarded } = toWireUnresolved(issues, kept);
    expect(unresolved).toHaveLength(MAX_UNRESOLVED_ISSUES);
    expect(unresolved[0]?.issue).toBe('Issue 0');
    expect(unresolved.every((u) => CritiqueIssue.safeParse(u).success)).toBe(true);
    expect(discarded).toEqual<Discarded[]>([
      {
        path: '/critique/unresolved',
        reason: 'too_many_items',
        limit: MAX_UNRESOLVED_ISSUES,
        actual: MAX_UNRESOLVED_ISSUES + 3,
      },
    ]);
  });
});
