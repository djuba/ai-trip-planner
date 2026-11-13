// The extract use case against recorded live calls (WU-09 plan D9): our prompts, the real adapter
// and the AI SDK provider all run; only the network is replayed. Gated runs always replay.
// Re-record with `pnpm record:cassettes extract.replay` (live, costs money), then review the diff.
// The functional tests send the vague and complete requests too, and reuse these cassettes.
import {
  codePointLength,
  ExtractResponse,
  MAX_CLARIFICATION_QUESTION_LENGTH,
  type ExtractRequest,
} from '@vp/domain-schema/wire';
import { afterAll, describe, expect, it } from 'vitest';
import type { Config } from '../../src/config.ts';
import { createLlmClient, type LlmCallLog } from '../../src/llm/index.ts';
import { extractTrip } from '../../src/usecases/extract.ts';
import { CASSETTE_DIR, baseEnv } from '../support/api-server.ts';
import { EXTRACT_REQUESTS } from '../support/extract-requests.ts';

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

afterAll(async () => {
  await runtime.flush();
});

async function extract(request: ExtractRequest): Promise<ExtractResponse> {
  const response = await extractTrip(request, {
    llm: runtime.client,
    logDiscarded: () => undefined,
  });
  // Exactly what the route would serialize: the wire schema must accept it.
  return ExtractResponse.parse(response);
}

const LIVE_TIMEOUT = 120_000; // recording makes live calls; replay is instant.

describe('extract against recorded live calls', () => {
  it(
    'AC-EXTRACT-02: a vague message needs clarification with INSUFFICIENT_DETAIL',
    async () => {
      const response = await extract(EXTRACT_REQUESTS.vague);
      expect(response.status).toBe('needs_clarification');
      if (response.status !== 'needs_clarification') return;
      expect(response.violations.map((v) => v.code)).toContain('INSUFFICIENT_DETAIL');
      expect(response.clarificationQuestion.trim()).not.toBe('');
    },
    LIVE_TIMEOUT,
  );

  it(
    'AC-EXTRACT-01, AC-EXTRACT-05: a complete message is ready, with an unmapped activity',
    async () => {
      const response = await extract(EXTRACT_REQUESTS.complete);
      expect(response.status).toBe('ready');
      const { departure, dateRange, experiences } = response.profile;
      expect(departure?.city).toContain('Minneapolis');
      expect(departure?.maxStops).toBe(0);
      expect(dateRange).toEqual({ kind: 'fixed', start: '2030-02-10', end: '2030-02-17' });
      expect(experiences).toEqual(['beach', 'snorkeling']);
      expect(response.profile.people).toHaveLength(2);
      expect(response.profile.unmappedExperiences?.join(' ').toLowerCase()).toContain('cooking');
    },
    LIVE_TIMEOUT,
  );

  it(
    'AC-EXTRACT-03: a correction replaces the party and keeps the rest of the profile',
    async () => {
      const response = await extract(EXTRACT_REQUESTS.correction);
      expect(response.status).toBe('ready');
      expect(response.profile.people).toHaveLength(5);
      expect(response.profile.people?.filter((p) => p.userType === 'child')).toHaveLength(2);
      expect(response.profile.region).toContain('Hawaii');
      expect(response.profile.dateRange).toEqual({
        kind: 'fixed',
        start: '2030-02-10',
        end: '2030-02-17',
      });
    },
    LIVE_TIMEOUT,
  );

  it(
    'AC-EXTRACT-04: a 19-year-old kid is kept as stated and flagged by CHILD_AGE_RANGE',
    async () => {
      const response = await extract(EXTRACT_REQUESTS.invalidAge);
      expect(response.status).toBe('needs_clarification');
      if (response.status !== 'needs_clarification') return;
      expect(response.violations).toEqual([
        { code: 'CHILD_AGE_RANGE', path: '/people/2/age', params: { age: 19, min: 0, max: 17 } },
      ]);
    },
    LIVE_TIMEOUT,
  );

  it(
    'AC-EXTRACT-14: an injection attempt is contained: wire-valid, within every cap',
    async () => {
      const response = await extract(EXTRACT_REQUESTS.injection);
      // `extract` already parsed the response against the wire schema, which carries every cap.
      // In the recorded run the model resisted (region "Somewhere nice", an ordinary question), so
      // no cap was hit here. Discarding over-cap model output is proven by the mock-based tests
      // (AC-EXTRACT-09, and the over-cap question cases of AC-EXTRACT-12); WU-18 measures resistance.
      expect(response.status).toBe('needs_clarification');
      if (response.status !== 'needs_clarification') return;
      expect(codePointLength(response.clarificationQuestion)).toBeLessThanOrEqual(
        MAX_CLARIFICATION_QUESTION_LENGTH,
      );
    },
    LIVE_TIMEOUT,
  );

  it('AC-LLM-11: every call succeeded on its first attempt, with no SDK warnings', () => {
    expect(logs.length).toBeGreaterThan(0);
    for (const entry of logs) {
      expect(entry).toMatchObject({ outcome: 'ok', attempt: 1, warnings: [] });
    }
  });
});
