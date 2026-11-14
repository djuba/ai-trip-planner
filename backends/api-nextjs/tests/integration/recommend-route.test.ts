// The real /recommend handler with real Request objects, a mock LlmClient and the committed route
// data (CLAUDE.md §6.3; WU-10 plan D11): status codes, the error envelope, CORS and the discard log.
import type { Discarded } from '@vp/domain-schema/rules';
import {
  CritiqueResult,
  RecommendationSet,
  RecommendResponse,
  type RecommendationDraft,
  type TripProfile,
} from '@vp/domain-schema/wire';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { consoleRecommendDiscardLog, createRecommendPost } from '../../src/http/recommend.ts';
import { getRouteData } from '../../src/http/route-data.ts';
import {
  createMockLlmClient,
  mockObject,
  mockRefusal,
  type LlmRuntime,
  type MockResponder,
} from '../../src/llm/index.ts';
import type { LlmStage } from '../../src/usecases/llm-client.ts';
import { authHeaders } from '../support/invite.ts';
import { stubInviteEnv } from '../support/stub-invite-env.ts';

const WEB_ORIGIN = 'https://web.example.test';

const PROFILE: TripProfile = {
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

const DRAFT: RecommendationDraft = {
  destination: 'Maui, Hawaii',
  summary: 'Warm beaches in February.',
  matchedExperiences: ['beach'],
  bestMonths: [1, 2, 3],
  adultsOnly: false,
  claims: [
    { kind: 'flight', statement: 'Maybe non-stop.', nonstopRoute: { from: 'MSP', to: 'OGG' } },
  ],
};

const post = (body: unknown) =>
  new Request('http://api.test/v1/trip/recommend', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: WEB_ORIGIN, ...authHeaders() },
    body: JSON.stringify(body),
  });

function handler(responders: Partial<Record<LlmStage, MockResponder>>) {
  const discarded: Discarded[] = [];
  const calls: LlmStage[] = [];
  let flushes = 0;
  const recording = Object.fromEntries(
    Object.entries(responders).map(([stage, responder]) => [
      stage,
      (...args: Parameters<Extract<MockResponder, (...a: never[]) => unknown>>) => {
        calls.push(stage as LlmStage);
        return typeof responder === 'function' ? responder(...args) : responder;
      },
    ]),
  );
  const runtime: LlmRuntime = {
    client: createMockLlmClient(recording, { log: () => undefined, now: () => 0 }),
    flush: () => {
      flushes += 1;
      return Promise.resolve();
    },
  };
  const POST = createRecommendPost({
    llm: () => runtime,
    routes: getRouteData,
    logDiscarded: (entry) => discarded.push(entry),
  });
  return { POST, discarded, calls, flushes: () => flushes };
}

const drafts = (...items: RecommendationDraft[]) =>
  mockObject(RecommendationSet, { recommendations: items });
const pass = mockObject(CritiqueResult, { pass: true, issues: [] });

describe('POST /v1/trip/recommend handler', () => {
  beforeAll(() => {
    stubInviteEnv();
    vi.stubEnv('WEB_ORIGIN', WEB_ORIGIN);
    vi.stubEnv('LLM_MODE', 'mock');
    vi.stubEnv('MODEL_FAST', 'fast');
    vi.stubEnv('MODEL_REASONING', 'reasoning');
    vi.stubEnv('MODEL_CRITIC', 'critic');
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('AC-RECOMMEND-01: answers 200 with CORS, labels from the committed route data, and flushes', async () => {
    const { POST, flushes } = handler({ recommend: drafts(DRAFT), critic: pass });

    const response = await POST(post({ profile: PROFILE, referenceDate: '2030-01-15' }));

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
    const body = RecommendResponse.parse(await response.json());
    expect(body.recommendations[0]?.claims[0]).toMatchObject({ verification: 'fixture' });
    expect(body.critique).toEqual({ pass: true, unresolved: [] });
    expect(flushes()).toBe(1);
  });

  it('AC-RECOMMEND-02: a profile that is not ready is a 422 naming the codes, with no model call', async () => {
    const { POST, calls } = handler({ recommend: drafts(DRAFT), critic: pass });

    const response = await POST(
      post({
        profile: { ...PROFILE, people: [{ userType: 'child', age: 8 }] },
        referenceDate: '2030-01-15',
      }),
    );

    expect(response.status).toBe(422);
    expect(response.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
    expect(await response.json()).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'The profile is not ready for recommendations: PARTY_HAS_ADULT',
      },
    });
    expect(calls).toEqual([]);
  });

  it('AC-RECOMMEND-12: logs discards and answers a wire-valid body', async () => {
    const { POST, discarded } = handler({
      recommend: drafts({ ...DRAFT, destination: 'd'.repeat(105) }, DRAFT),
      critic: pass,
    });

    const response = await POST(post({ profile: PROFILE, referenceDate: '2030-01-15' }));

    expect(response.status).toBe(200);
    const body = RecommendResponse.parse(await response.json());
    expect(body.recommendations.map((r) => r.id)).toEqual(['rec-2']);
    expect(discarded).toContainEqual({
      path: '/recommendations/0/destination',
      reason: 'too_long',
      limit: 100,
      actual: 105,
    });
  });

  it('AC-RECOMMEND-14: a refusal is a 502 LLM_REFUSAL envelope with CORS, after a flush', async () => {
    const { POST, flushes } = handler({ recommend: drafts(DRAFT), critic: mockRefusal() });

    const response = await POST(post({ profile: PROFILE, referenceDate: '2030-01-15' }));

    expect(response.status).toBe(502);
    expect(response.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
    expect(await response.json()).toMatchObject({ error: { code: 'LLM_REFUSAL' } });
    expect(flushes()).toBe(1);
  });

  it('AC-RECOMMEND-12: the console discard log names path, reason, cap and size only', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    consoleRecommendDiscardLog({
      path: '/recommendations/0/summary',
      reason: 'too_long',
      limit: 500,
      actual: 900,
    });
    expect(warn).toHaveBeenCalledWith(
      '[recommend] discarded path=/recommendations/0/summary reason=too_long limit=500 actual=900',
    );
    warn.mockRestore();
  });
});
