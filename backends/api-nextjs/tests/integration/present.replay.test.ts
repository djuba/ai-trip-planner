// The present use case against recorded live calls (WU-11 plan T9): our prompt, the stream writer,
// the real adapter and the AI SDK provider all run; only the network is replayed. Gated runs always
// replay. Re-record with `pnpm record:cassettes present.replay` (live, costs money), then review
// the diff. The functional and contract tests send `contract` too, and reuse its cassette.
import { PresentationModel, type PresentRequest } from '@vp/domain-schema/wire';
import { describe, expect, it } from 'vitest';
import type { Config } from '../../src/config.ts';
import { getRouteData } from '../../src/http/route-data.ts';
import { createLlmClient, type LlmCallLog } from '../../src/llm/index.ts';
import { PRESENT_SYSTEM } from '../../src/usecases/prompts/present.ts';
import { presentTrip } from '../../src/usecases/present.ts';
import { CASSETTE_DIR, baseEnv } from '../support/api-server.ts';
import { PRESENT_REQUESTS } from '../support/present-requests.ts';

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

async function present(request: PresentRequest) {
  const before = logs.length;
  const chunks: string[] = [];
  for await (const chunk of await presentTrip(request, {
    llm: runtime.client,
    routes,
    logDiscarded: () => undefined,
  })) {
    chunks.push(chunk);
  }
  await runtime.flush();
  const text = chunks.join('');
  return {
    chunks,
    text,
    model: PresentationModel.parse(JSON.parse(text)),
    calls: logs.slice(before),
  };
}

const LIVE_TIMEOUT = 120_000;

describe('present against recorded live calls', () => {
  it(
    "AC-PRESENT-01/02: the contract's request streams in many chunks to a valid presentation",
    async () => {
      const request = PRESENT_REQUESTS.contract;
      const { chunks, model, calls } = await present(request);
      expect(chunks.length).toBeGreaterThan(5);
      expect(model.cards.map((c) => c.recommendationId)).toEqual(['rec-1']);
      expect(model.cards[0]?.claims).toEqual(request.recommendations[0]?.claims);
      expect(calls).toEqual([
        expect.objectContaining({ stage: 'present', outcome: 'ok', warnings: [] }),
      ]);
    },
    LIVE_TIMEOUT,
  );

  it(
    'AC-PRESENT-10: planted instructions leave every claim and label unchanged and leak nothing',
    async () => {
      const request = PRESENT_REQUESTS.planted;
      const { model, text } = await present(request);
      expect(model.cards.map((c) => [c.recommendationId, c.claims])).toEqual(
        request.recommendations.map((r) => [r.id, r.claims]),
      );
      // Whether the copy repeats a planted string is a quality question for the eval (plan D11);
      // the gated test pins only what code guarantees and what would be a leak.
      const copy = JSON.stringify({
        headline: model.headline,
        intro: model.intro,
        cards: model.cards.map(({ title, blurb, highlights }) => ({ title, blurb, highlights })),
      });
      expect(copy).not.toContain(PRESENT_SYSTEM.slice(0, 60));
      expect(text).not.toContain('"verification":"fixture"');
    },
    LIVE_TIMEOUT,
  );
});
