// Every spec fixture through the real /extract handler with a mock LlmClient (CLAUDE.md §6.5, WU-09
// plan D7): rule cases prove serialization and ready vs needs_clarification routing; normalize
// cases prove the normalization spec end to end.
import { ClarificationOutput, ExtractionSchema } from '@vp/domain-schema/wire';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createExtractPost } from '../../src/http/extract.ts';
import { createMockLlmClient, mockObject, type LlmRuntime } from '../../src/llm/index.ts';
import { loadNormalizeFixtures, loadRuleFixtures } from '../support/spec-fixtures.ts';
import { expectedAfterNormalize, toExtraction } from '../support/to-extraction.ts';

const QUESTION = 'Could you tell me more about the trip?';

async function extract(extraction: ExtractionSchema, referenceDate: string) {
  const runtime: LlmRuntime = {
    client: createMockLlmClient(
      {
        extract: mockObject(ExtractionSchema, extraction),
        clarify: mockObject(ClarificationOutput, { question: QUESTION }),
      },
      { log: () => undefined, now: () => 0 },
    ),
    flush: () => Promise.resolve(),
  };
  const POST = createExtractPost({ llm: () => runtime, logDiscarded: () => undefined });
  const response = await POST(
    new Request('http://api.test/v1/trip/extract', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'fixture', referenceDate }),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const ruleFiles = loadRuleFixtures();
const normalizeFiles = loadNormalizeFixtures();

describe('spec fixtures through POST /v1/trip/extract', () => {
  beforeAll(() => {
    vi.stubEnv('LLM_MODE', 'mock');
    vi.stubEnv('MODEL_FAST', 'fast');
    vi.stubEnv('MODEL_REASONING', 'reasoning');
    vi.stubEnv('MODEL_CRITIC', 'critic');
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('AC-EXTRACT-07: finds rule fixture cases', () => {
    expect(ruleFiles.flatMap((file) => file.cases).length).toBeGreaterThan(0);
  });

  it('AC-EXTRACT-08: finds normalize fixture cases', () => {
    expect(normalizeFiles.flatMap((file) => file.cases).length).toBeGreaterThan(0);
  });

  for (const file of ruleFiles) {
    for (const fixture of file.cases) {
      it(`AC-EXTRACT-07: rules/${file.name}/${fixture.id}`, async () => {
        const { status, body } = await extract(
          toExtraction(fixture.profile),
          fixture.referenceDate,
        );

        expect(status).toBe(200);
        expect(body.status === 'ready').toBe(fixture.expectedViolations.length === 0);
        expect(body.violations ?? []).toEqual(fixture.expectedViolations);
        expect(body.profile).toEqual(expectedAfterNormalize(fixture.profile));
      });
    }
  }

  for (const file of normalizeFiles) {
    for (const fixture of file.cases) {
      it(`AC-EXTRACT-08: normalize/${file.name}/${fixture.id}`, async () => {
        const { status, body } = await extract(fixture.extraction, '2026-01-01');

        expect(status).toBe(200);
        expect(body.profile).toEqual(fixture.expectedProfile);
      });
    }
  }
});
