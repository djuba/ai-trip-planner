// One real provider call, recorded live once and replayed from a committed cassette (WU-08 required
// test; plan D11). Gated runs always replay. Re-record with `pnpm record:cassettes llm-client.replay`
// (live, costs money), then review the cassette diff.
import { ExtractionSchema } from '@vp/domain-schema/wire';
import { afterAll, describe, expect, it } from 'vitest';
import type { Config } from '../../src/config.ts';
import { createLlmClient, type LlmCallLog } from '../../src/llm/index.ts';
import { CASSETTE_DIR } from '../support/api-server.ts';

// Hard-coded, not read from the environment: the model is part of the cassette key (review #5).
const MODEL = 'claude-haiku-5-5';
const recording = process.env.LLM_MODE === 'record';

const config: Config = {
  llmMode: recording ? 'record' : 'replay',
  models: { fast: MODEL, reasoning: MODEL, critic: MODEL },
  webOrigin: 'http://localhost:3000',
  cassetteDir: CASSETTE_DIR,
  ...(recording ? { anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '' } : {}),
};

// A static, test-only prompt. WU-09 owns the real extraction prompt and its own cassettes.
const SYSTEM =
  'You extract vacation preferences from a traveler message into the given JSON schema. ' +
  'Use null for anything the message does not mention. Put requested activities that have no ' +
  'matching experience value in unmappedExperiences.';
const PROMPT =
  'Reference date: 2026-11-08.\n' +
  'Message: Two adults and a 7-year-old from Minneapolis want a beach and snorkeling trip in ' +
  'March 2027.';

const logs: LlmCallLog[] = [];
const runtime = createLlmClient(config, { log: (entry) => logs.push(entry) });

afterAll(async () => {
  await runtime.flush();
});

describe('LlmClient against a recorded live call', () => {
  it('AC-LLM-11: the committed cassette replays to schema-valid output with no SDK warnings', async () => {
    const extraction = await runtime.client.generateObject({
      stage: 'extract',
      role: 'fast',
      schema: ExtractionSchema,
      system: SYSTEM,
      prompt: PROMPT,
      maxOutputTokens: 1024,
      effort: 'low',
    });

    expect(ExtractionSchema.safeParse(extraction).success).toBe(true);
    expect(extraction.experiences).toEqual(expect.arrayContaining(['beach', 'snorkeling']));
    expect(extraction.people).toHaveLength(3);
    expect(logs).toHaveLength(1);
    const [entry] = logs;
    expect(entry).toMatchObject({ outcome: 'ok', model: MODEL, warnings: [] });
    expect(entry?.inputTokens).toBeGreaterThan(0);
    expect(entry?.outputTokens).toBeGreaterThan(0);
  }, 60_000); // a live recording takes several seconds; replay is instant.
});
