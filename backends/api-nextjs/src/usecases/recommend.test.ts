// The recommend use case over the real adapter with a mock model (CLAUDE.md §6.3): the refusal
// check, the one retry, both safeParses and `accept` run for real; only the model is fake.
import type { Discarded } from '@vp/domain-schema/rules';
import {
  CritiqueResult,
  RecommendationSet,
  RecommendResponse,
  type RecommendationDraft,
  type RecommendRequest,
  type TripProfile,
} from '@vp/domain-schema/wire';
import { describe, expect, it } from 'vitest';
import {
  createMockLlmClient,
  mockObject,
  mockRaw,
  mockRefusal,
  type MockReply,
  type MockResponder,
} from '../llm/index.ts';
import { UNSHOWABLE_ISSUE } from './critic/llm-critic.ts';
import { LlmError, ProfileNotReadyError } from './errors.ts';
import type { LlmObjectRequest, LlmStage } from './llm-client.ts';
import { MAX_CRITIC_ISSUES } from './prompts/critic.ts';
import { MAX_REVISIONS, pickBest, recommendTrip, type Attempt } from './recommend.ts';
import { parseRouteData } from './routes.ts';
import { CRITIC_MAX_OUTPUT_TOKENS, RECOMMEND_MAX_OUTPUT_TOKENS } from './token-budget.ts';

const ROUTES = parseRouteData({
  note: 'Test data.',
  origins: [
    {
      airport: 'MSP',
      names: ['Minneapolis'],
      nonstop: [
        { airport: 'OGG', city: 'Maui (Kahului)' },
        { airport: 'HNL', city: 'Honolulu' },
      ],
    },
  ],
});

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
const REQUEST: RecommendRequest = { profile: PROFILE, referenceDate: '2030-01-15' };

const GOOD: RecommendationDraft = {
  destination: 'Maui, Hawaii',
  summary: 'Warm beaches and calm snorkeling water in February.',
  matchedExperiences: ['beach', 'snorkeling'],
  bestMonths: [1, 2, 3],
  adultsOnly: false,
  claims: [
    {
      kind: 'flight',
      statement: 'There may be a non-stop from Minneapolis to Maui.',
      nonstopRoute: { from: 'MSP', to: 'OGG' },
    },
    { kind: 'price', statement: 'Hotels may cost around $300 a night.', nonstopRoute: null },
  ],
};
/** Fails SEASON_MISMATCH: February is not among its best months. */
const OFF_SEASON: RecommendationDraft = { ...GOOD, bestMonths: [7, 8] };

const drafts = (...items: RecommendationDraft[]) =>
  mockObject(RecommendationSet, { recommendations: items });
const pass = mockObject(CritiqueResult, { pass: true, issues: [] });
const critique = (...issues: { recommendationId: string | null; issue: string }[]) =>
  mockObject(CritiqueResult, { pass: issues.length === 0, issues });

/** Replies in call order (a retry is a call); the last reply repeats once the queue runs out. */
function queue(...replies: MockReply[]): MockResponder {
  let index = 0;
  return () => {
    const reply = replies[Math.min(index, replies.length - 1)];
    index += 1;
    if (reply === undefined) throw new Error('empty queue');
    return reply;
  };
}

function setup(responders: Partial<Record<LlmStage, MockResponder>>) {
  const requests: LlmObjectRequest<unknown>[] = [];
  const discarded: Discarded[] = [];
  const recording = Object.fromEntries(
    Object.entries(responders).map(([stage, responder]) => [
      stage,
      (request: LlmObjectRequest<unknown>, attempt: number) => {
        requests.push(request);
        return typeof responder === 'function' ? responder(request, attempt) : responder;
      },
    ]),
  );
  const llm = createMockLlmClient(recording, { log: () => undefined, now: () => 0 });
  const run = (request: RecommendRequest = REQUEST) =>
    recommendTrip(request, { llm, routes: ROUTES, logDiscarded: (d) => discarded.push(d) });
  const stages = () => requests.map((r) => r.stage);
  return { run, requests, discarded, stages };
}

/** Every data block in a prompt, parsed back. */
function blocks(prompt: string): Record<string, unknown> {
  return Object.fromEntries(
    [...prompt.matchAll(/<data name="([A-Za-z]+)">\n([^\n]*)\n<\/data>/g)].map(
      ([, name, json]): [string, unknown] => [name ?? '', JSON.parse(json ?? '')],
    ),
  );
}

describe('recommendTrip', () => {
  it('AC-RECOMMEND-01, AC-RECOMMEND-09: a first-try pass returns ids rec-<n> and an empty critique', async () => {
    const { run, stages } = setup({ recommend: drafts(GOOD, GOOD), critic: pass });
    const response = await run();
    expect(RecommendResponse.parse(response)).toEqual(response);
    expect(response.recommendations.map((r) => r.id)).toEqual(['rec-1', 'rec-2']);
    expect(response.critique).toEqual({ pass: true, unresolved: [] });
    expect(stages()).toEqual(['recommend', 'critic']);
  });

  it('AC-RECOMMEND-03: labels come from code: the route-backed claim is fixture with code text, the rest unverified', async () => {
    const { run } = setup({ recommend: drafts(GOOD), critic: pass });
    const [rec] = (await run()).recommendations;
    expect(rec?.claims).toEqual([
      {
        kind: 'flight',
        statement: expect.stringContaining('MSP–OGG') as unknown,
        verification: 'fixture',
      },
      {
        kind: 'price',
        statement: 'Hotels may cost around $300 a night.',
        verification: 'unverified',
      },
    ]);
    expect(rec?.claims[0]?.statement).not.toContain('There may be');
  });

  it('AC-RECOMMEND-02: a profile that is not ready is refused before any model call', async () => {
    const { run, requests } = setup({ recommend: drafts(GOOD), critic: pass });
    const notReady = {
      ...REQUEST,
      profile: { ...PROFILE, people: [{ userType: 'child' as const, age: 8 }] },
    };
    const error = await run(notReady).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProfileNotReadyError);
    expect((error as ProfileNotReadyError).codes).toEqual(['PARTY_HAS_ADULT']);
    expect((error as Error).message).toContain('PARTY_HAS_ADULT');
    expect(requests).toHaveLength(0);
  });

  it('AC-RECOMMEND-08: deterministic issues still go to the critic, and the revision carries the draft and the issues', async () => {
    const { run, requests, stages } = setup({
      recommend: queue(drafts(OFF_SEASON), drafts(GOOD)),
      critic: queue(
        critique({ recommendationId: 'rec-1', issue: 'Too far from the beach.' }),
        pass,
      ),
    });
    const response = await run();
    expect(stages()).toEqual(['recommend', 'critic', 'recommend', 'critic']);
    const firstCritic = blocks(requests[1]?.prompt ?? '');
    expect(firstCritic.automaticIssues).toEqual([
      { recommendationId: 'rec-1', issue: expect.any(String) as unknown },
    ]);
    const revision = blocks(requests[2]?.prompt ?? '');
    expect(revision.previousRecommendations).toEqual([{ id: 'rec-1', ...OFF_SEASON }]);
    expect(revision.issues).toHaveLength(2);
    expect((revision.issues as { issue: string }[])[1]?.issue).toBe('Too far from the beach.');
    expect(response.critique).toEqual({ pass: true, unresolved: [] });
  });

  it('AC-RECOMMEND-09: critic issues alone trigger a revision', async () => {
    const { run, stages } = setup({
      recommend: drafts(GOOD),
      critic: queue(critique({ recommendationId: null, issue: 'Only one option.' }), pass),
    });
    expect((await run()).critique.pass).toBe(true);
    expect(stages()).toEqual(['recommend', 'critic', 'recommend', 'critic']);
  });

  it('AC-RECOMMEND-10: never passing stops after MAX_REVISIONS revisions with the best attempt unresolved', async () => {
    const { run, stages } = setup({
      recommend: drafts(OFF_SEASON),
      critic: critique({ recommendationId: 'rec-1', issue: 'Wrong season.' }),
    });
    const response = await run();
    expect(MAX_REVISIONS).toBe(2);
    expect(stages().filter((s) => s === 'recommend')).toHaveLength(3);
    expect(stages().filter((s) => s === 'critic')).toHaveLength(3);
    expect(response.critique.pass).toBe(false);
    expect(response.critique.unresolved).toHaveLength(2);
    expect(response.critique.unresolved[1]).toEqual({
      recommendationId: 'rec-1',
      issue: 'Wrong season.',
    });
  });

  it('AC-RECOMMEND-11: the best attempt has the fewest issues, and a tie goes to the later one', () => {
    const attempt = (n: number, tag: string): Attempt => ({
      drafts: [{ ...GOOD, destination: tag }],
      issues: Array.from({ length: n }, () => ({ recommendationId: null, issue: 'x' })),
    });
    expect(
      pickBest([attempt(2, 'a'), attempt(1, 'b'), attempt(1, 'c')]).drafts[0]?.destination,
    ).toBe('c');
    expect(
      pickBest([attempt(1, 'a'), attempt(2, 'b'), attempt(3, 'c')]).drafts[0]?.destination,
    ).toBe('a');
    expect(() => pickBest([])).toThrow('at least one attempt');
  });

  it('AC-RECOMMEND-11: the loop returns the attempt with the fewest issues', async () => {
    const { run } = setup({
      recommend: queue(
        drafts(OFF_SEASON),
        drafts({ ...GOOD, destination: 'Wailea, Maui' }),
        drafts(OFF_SEASON),
      ),
      critic: critique({ recommendationId: null, issue: 'Could be better.' }),
    });
    const response = await run();
    expect(response.recommendations[0]?.destination).toBe('Wailea, Maui');
    expect(response.critique).toEqual({
      pass: false,
      unresolved: [{ recommendationId: null, issue: 'Could be better.' }],
    });
  });

  it('AC-RECOMMEND-11: a critic issue naming an id not in the draft is reported with a null id', async () => {
    const { run } = setup({
      recommend: drafts(GOOD),
      critic: critique({ recommendationId: 'rec-9', issue: 'Hmm.' }),
    });
    expect((await run()).critique.unresolved).toEqual([{ recommendationId: null, issue: 'Hmm.' }]);
  });

  it('AC-RECOMMEND-12: over-cap or blank critic issues are replaced by fixed text and logged; extra issues are dropped', async () => {
    const many = Array.from({ length: MAX_CRITIC_ISSUES + 2 }, (_, i) => ({
      recommendationId: 'rec-1',
      issue: i === 0 ? 'x'.repeat(301) : i === 1 ? '   ' : `Issue ${i}.`,
    }));
    const { run, discarded } = setup({ recommend: drafts(GOOD), critic: critique(...many) });
    const { unresolved } = (await run()).critique;
    expect(unresolved).toHaveLength(MAX_CRITIC_ISSUES);
    expect(unresolved[0]).toEqual({ recommendationId: 'rec-1', issue: UNSHOWABLE_ISSUE });
    expect(unresolved[1]).toEqual({ recommendationId: 'rec-1', issue: UNSHOWABLE_ISSUE });
    expect(JSON.stringify(unresolved)).not.toContain('xxx');
    expect(discarded).toEqual(
      expect.arrayContaining([
        {
          path: '/critique/issues',
          reason: 'too_many_items',
          limit: MAX_CRITIC_ISSUES,
          actual: 12,
        },
        { path: '/critique/issues/0/issue', reason: 'too_long', limit: 300, actual: 301 },
        { path: '/critique/issues/1/issue', reason: 'too_long', limit: 300, actual: 0 },
      ]),
    );
  });

  it('AC-RECOMMEND-12: an issue about a discarded recommendation gets a null id; nothing left is a 502', async () => {
    const tooLong = { ...GOOD, summary: 'x'.repeat(501) };
    const partial = setup({
      recommend: drafts(tooLong, GOOD),
      critic: critique({ recommendationId: 'rec-1', issue: 'Summary too long.' }),
    });
    const response = await partial.run();
    expect(response.recommendations.map((r) => r.id)).toEqual(['rec-2']);
    expect(response.critique.unresolved.every((i) => i.recommendationId !== 'rec-1')).toBe(true);
    expect(partial.discarded).toContainEqual(
      expect.objectContaining({ path: '/recommendations/0/summary', reason: 'too_long' }),
    );

    const none = setup({ recommend: drafts(tooLong), critic: pass });
    await expect(none.run()).rejects.toMatchObject({ code: 'LLM_UPSTREAM_ERROR' });
  });

  it('AC-RECOMMEND-14: a refusal on either call is LLM_REFUSAL', async () => {
    const onRecommend = setup({ recommend: mockRefusal(), critic: pass });
    await expect(onRecommend.run()).rejects.toMatchObject({ code: 'LLM_REFUSAL' });
    const onCritic = setup({ recommend: drafts(GOOD), critic: mockRefusal() });
    const error = await onCritic.run().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect(error).toMatchObject({ code: 'LLM_REFUSAL' });
  });

  it('AC-RECOMMEND-14: an empty list, or a critic whose pass disagrees with its issues, twice is LLM_UPSTREAM_ERROR', async () => {
    const empty = setup({
      recommend: mockObject(RecommendationSet, { recommendations: [] }),
      critic: pass,
    });
    await expect(empty.run()).rejects.toMatchObject({ code: 'LLM_UPSTREAM_ERROR' });
    expect(empty.stages()).toEqual(['recommend', 'recommend']);

    const inconsistent = mockObject(CritiqueResult, {
      pass: true,
      issues: [{ recommendationId: null, issue: 'x' }],
    });
    const critic = setup({ recommend: drafts(GOOD), critic: inconsistent });
    await expect(critic.run()).rejects.toMatchObject({ code: 'LLM_UPSTREAM_ERROR' });
    expect(critic.stages()).toEqual(['recommend', 'critic', 'critic']);
  });

  it('AC-RECOMMEND-14: invalid output once, then valid, still answers', async () => {
    const { run } = setup({
      recommend: queue(mockRaw('{"recommendations": "none"}'), drafts(GOOD)),
      critic: queue(mockRaw('not json'), pass),
    });
    expect((await run()).critique.pass).toBe(true);
  });

  it('AC-RECOMMEND-15: roles, effort and output budgets per call', async () => {
    const { run, requests } = setup({ recommend: drafts(GOOD), critic: pass });
    await run();
    expect(
      requests.map(({ stage, role, effort, maxOutputTokens }) => ({
        stage,
        role,
        effort,
        maxOutputTokens,
      })),
    ).toEqual([
      {
        stage: 'recommend',
        role: 'reasoning',
        effort: 'medium',
        maxOutputTokens: RECOMMEND_MAX_OUTPUT_TOKENS,
      },
      {
        stage: 'critic',
        role: 'critic',
        effort: 'medium',
        maxOutputTokens: CRITIC_MAX_OUTPUT_TOKENS,
      },
    ]);
  });

  it('AC-RECOMMEND-13: route data for the traveler’s own airport goes in the prompt; an uncovered city gets null', async () => {
    const covered = setup({ recommend: drafts(GOOD), critic: pass });
    await covered.run();
    expect(blocks(covered.requests[0]?.prompt ?? '').routeData).toEqual({
      origin: 'MSP',
      nonstop: ROUTES.origins[0]?.nonstop,
    });
    expect(covered.requests[0]?.prompt).toContain('Trip starts: February 2030');

    const elsewhere = setup({ recommend: drafts({ ...GOOD, claims: [] }), critic: pass });
    const profile = {
      ...PROFILE,
      departure: { city: 'Boise', mode: 'plane' as const, maxStops: 0 },
    };
    await elsewhere.run({ ...REQUEST, profile });
    expect(blocks(elsewhere.requests[0]?.prompt ?? '').routeData).toBeNull();
  });
});
