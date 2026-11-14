// The recommend use case against recorded live calls (WU-10 plan D12): our prompts, the loop, the
// real adapter and the AI SDK provider all run; only the network is replayed. Gated runs always
// replay. Re-record with `pnpm record:cassettes recommend.replay` (live, costs money), then review
// the diff. The functional tests send `firstTry` too, and reuse its cassettes.
import {
  RecommendationSet,
  RecommendResponse,
  type RecommendRequest,
} from '@vp/domain-schema/wire';
import { appendFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import type { Config } from '../../src/config.ts';
import { getRouteData } from '../../src/http/route-data.ts';
import { createLlmClient, type LlmCallLog } from '../../src/llm/index.ts';
import type { LlmClient, LlmObjectRequest } from '../../src/usecases/llm-client.ts';
import { recommendTrip } from '../../src/usecases/recommend.ts';
import { findNonstop, resolveOrigin } from '../../src/usecases/routes.ts';
import { CASSETTE_DIR, baseEnv } from '../support/api-server.ts';
import { FLAWED_FIRST_DRAFT, RECOMMEND_REQUESTS } from '../support/recommend-requests.ts';

// The same model IDs as the spawned server, so the functional tests share these cassettes.
const env = baseEnv();
const recording = process.env.LLM_MODE === 'record';

const config: Config = {
  llmMode: recording ? 'record' : 'replay',
  models: {
    fast: env.MODEL_FAST ?? '',
    reasoning: env.MODEL_REASONING ?? '',
    critic: env.MODEL_CRITIC ?? '',
  },
  webOrigin: 'http://localhost:3000',
  cassetteDir: CASSETTE_DIR,
  ...(recording ? { anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '' } : {}),
};

const logs: LlmCallLog[] = [];
const runtime = createLlmClient(config, { log: (entry) => logs.push(entry) });
const routes = getRouteData();

afterAll(async () => {
  await runtime.flush();
});

/** The first recommend call answers with a fixed draft; every other call is real (plan D12). */
function startingFrom(client: LlmClient): LlmClient {
  let first = true;
  return {
    generateObject<T>(request: LlmObjectRequest<T>): Promise<T> {
      if (request.stage === 'recommend' && first) {
        first = false;
        return Promise.resolve(
          request.schema.parse(RecommendationSet.parse({ recommendations: [FLAWED_FIRST_DRAFT] })),
        );
      }
      return client.generateObject(request);
    },
  };
}

/** Runs the stage and reports the calls it made, with their summed latency (deployment Note). */
async function recommend(request: RecommendRequest, llm: LlmClient = runtime.client) {
  const before = logs.length;
  const response = await recommendTrip(request, { llm, routes, logDiscarded: () => undefined });
  const calls = logs.slice(before);
  if (recording) {
    const ms = calls.reduce((sum, call) => sum + call.latencyMs, 0);
    const out = calls.reduce((sum, call) => sum + (call.outputTokens ?? 0), 0);
    const line =
      `[recorded] calls=${calls.map((c) => `${c.stage}:${c.outputTokens}`).join(',')} ` +
      `latencyMs=${Math.round(ms)} outputTokens=${out}`;
    console.info(line);
    // Vitest keeps console output only for failing tests, so a recording can ask for a file too.
    if (process.env.VP_RECORD_SUMMARY) appendFileSync(process.env.VP_RECORD_SUMMARY, `${line}\n`);
  }
  // Exactly what the route would serialize: the wire schema must accept it.
  return { response: RecommendResponse.parse(response), calls };
}

/** AC-RECOMMEND-03: every fixture label is a listed non-stop from the traveler's own airport. */
function expectHonestLabels(request: RecommendRequest, response: RecommendResponse): void {
  const origin = resolveOrigin(routes, request.profile.departure?.city);
  for (const claim of response.recommendations.flatMap((r) => r.claims)) {
    if (claim.verification !== 'fixture') continue;
    expect(origin).not.toBeNull();
    const match = /^Non-stop service ([A-Z]{3})–([A-Z]{3}) \(/.exec(claim.statement);
    expect(match?.[1]).toBe(origin?.airport);
    expect(findNonstop(routes, match?.[1] ?? '', match?.[2] ?? '')).not.toBeNull();
  }
}

const LIVE_TIMEOUT = 600_000; // recording makes up to 6 live Sonnet calls; replay is instant.

describe('recommend against recorded live calls', () => {
  it(
    "AC-RECOMMEND-16: the contract's Hawaii request passes on the first try",
    async () => {
      const request = RECOMMEND_REQUESTS.firstTry;
      const { response, calls } = await recommend(request);
      expect(calls.map((c) => c.stage)).toEqual(['recommend', 'critic']);
      expect(response.critique).toEqual({ pass: true, unresolved: [] });
      expect(response.recommendations.length).toBeGreaterThanOrEqual(1);
      expect(
        response.recommendations.some((r) => r.claims.some((c) => c.verification === 'fixture')),
      ).toBe(true);
      expectHonestLabels(request, response);
      expect(calls.every((c) => c.warnings.length === 0)).toBe(true);
    },
    LIVE_TIMEOUT,
  );

  it(
    'AC-RECOMMEND-16: a draft with a route the data does not list passes after one revision',
    async () => {
      const request = RECOMMEND_REQUESTS.revision;
      const { response, calls } = await recommend(request, startingFrom(runtime.client));
      // The fixed draft 0 makes no call; its critic, the revision and its critic are real.
      expect(calls.map((c) => c.stage)).toEqual(['critic', 'recommend', 'critic']);
      expect(response.critique).toEqual({ pass: true, unresolved: [] });
      expectHonestLabels(request, response);
    },
    LIVE_TIMEOUT,
  );

  it(
    'AC-RECOMMEND-16: a non-stop-only trip to a region with no listed non-stop is still failing after two revisions',
    async () => {
      const request = RECOMMEND_REQUESTS.stillFailing;
      const { response, calls } = await recommend(request);
      expect(calls.filter((c) => c.stage === 'recommend' && c.outcome === 'ok')).toHaveLength(3);
      expect(calls.filter((c) => c.stage === 'critic' && c.outcome === 'ok')).toHaveLength(3);
      expect(response.critique.pass).toBe(false);
      expect(response.critique.unresolved.length).toBeGreaterThan(0);
      // The region comes first (approval change 2): the answer stays in Bhutan.
      expect(
        response.recommendations.every((r) => /bhutan/i.test(`${r.destination} ${r.summary}`)),
      ).toBe(true);
      expectHonestLabels(request, response);
    },
    LIVE_TIMEOUT,
  );

  it(
    'AC-RECOMMEND-17: instructions planted in profile strings are contained',
    async () => {
      const request = RECOMMEND_REQUESTS.containment;
      const { response } = await recommend(request);
      // Wire-valid (recommend() parses it), so every cap held; labels are code's, not the model's.
      expectHonestLabels(request, response);
      expect(response.recommendations.length).toBeGreaterThanOrEqual(1);
    },
    LIVE_TIMEOUT,
  );
});
