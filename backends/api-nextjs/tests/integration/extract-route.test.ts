// The real /extract handler with real Request objects and a mock LlmClient (CLAUDE.md §6.3; WU-09
// plan D6): status codes, the error envelope, CORS and the discard log through the HTTP adapter.
import type { Discarded } from '@vp/domain-schema/rules';
import {
  ClarificationOutput,
  ExtractionSchema,
  ExtractResponse,
  MAX_SHORT_TEXT_LENGTH,
} from '@vp/domain-schema/wire';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { consoleDiscardLog, createExtractPost } from '../../src/http/extract.ts';
import {
  createMockLlmClient,
  mockObject,
  mockRefusal,
  type LlmRuntime,
  type MockResponder,
} from '../../src/llm/index.ts';
import type { LlmStage } from '../../src/usecases/llm-client.ts';

const WEB_ORIGIN = 'https://web.example.test';

const VAGUE: ExtractionSchema = {
  departure: null,
  dateRange: null,
  region: null,
  climate: 'warm',
  experiences: null,
  unmappedExperiences: null,
  people: null,
};

const post = (body: unknown) =>
  new Request('http://api.test/v1/trip/extract', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: WEB_ORIGIN },
    body: JSON.stringify(body),
  });

function handler(responders: Partial<Record<LlmStage, MockResponder>>) {
  const discarded: Discarded[] = [];
  let flushes = 0;
  const runtime: LlmRuntime = {
    client: createMockLlmClient(responders, { log: () => undefined, now: () => 0 }),
    flush: () => {
      flushes += 1;
      return Promise.resolve();
    },
  };
  const POST = createExtractPost({
    llm: () => runtime,
    logDiscarded: (entry) => discarded.push(entry),
  });
  return { POST, discarded, flushes: () => flushes };
}

describe('POST /v1/trip/extract handler', () => {
  beforeAll(() => {
    vi.stubEnv('WEB_ORIGIN', WEB_ORIGIN);
    vi.stubEnv('LLM_MODE', 'mock');
    vi.stubEnv('MODEL_FAST', 'fast');
    vi.stubEnv('MODEL_REASONING', 'reasoning');
    vi.stubEnv('MODEL_CRITIC', 'critic');
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('AC-EXTRACT-02: answers 200 needs_clarification with CORS, and flushes recordings first', async () => {
    const { POST, flushes } = handler({
      extract: mockObject(ExtractionSchema, VAGUE),
      clarify: mockObject(ClarificationOutput, { question: 'Where would you like to go?' }),
    });

    const response = await POST(post({ message: 'Somewhere warm', referenceDate: '2030-01-15' }));

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
    const body: unknown = await response.json();
    expect(ExtractResponse.parse(body)).toMatchObject({
      status: 'needs_clarification',
      clarificationQuestion: 'Where would you like to go?',
    });
    expect(flushes()).toBe(1);
  });

  it('AC-EXTRACT-09: logs a discard and still answers a wire-valid profile', async () => {
    const { POST, discarded } = handler({
      extract: mockObject(ExtractionSchema, {
        ...VAGUE,
        region: 'r'.repeat(MAX_SHORT_TEXT_LENGTH + 5),
      }),
      clarify: mockObject(ClarificationOutput, { question: 'Where to?' }),
    });

    const response = await POST(post({ message: 'Somewhere warm', referenceDate: '2030-01-15' }));

    expect(response.status).toBe(200);
    expect(ExtractResponse.safeParse(await response.json()).success).toBe(true);
    expect(discarded).toEqual([
      { path: '/region', reason: 'too_long', limit: MAX_SHORT_TEXT_LENGTH, actual: 105 },
    ]);
  });

  it('AC-EXTRACT-11: a refusal is a 502 LLM_REFUSAL envelope with CORS, after a flush', async () => {
    const { POST, flushes } = handler({
      extract: mockObject(ExtractionSchema, VAGUE),
      clarify: mockRefusal(),
    });

    const response = await POST(post({ message: 'x', referenceDate: '2030-01-15' }));

    expect(response.status).toBe(502);
    expect(response.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
    expect(await response.json()).toMatchObject({ error: { code: 'LLM_REFUSAL' } });
    // The extraction call succeeded, so in record mode its cassette must still reach disk.
    expect(flushes()).toBe(1);
  });

  it('AC-EXTRACT-15: a schema-invalid body is a 422 and never reaches the model', async () => {
    const { POST, flushes } = handler({});

    const response = await POST(post({ message: '', referenceDate: '2030-01-15' }));

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    expect(flushes()).toBe(0);
  });

  it('AC-EXTRACT-09: the console discard log names path, reason, cap and length only', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    consoleDiscardLog({ path: '/region', reason: 'too_long', limit: 100, actual: 250 });
    expect(warn).toHaveBeenCalledWith(
      '[extract] discarded path=/region reason=too_long limit=100 actual=250',
    );
    warn.mockRestore();
  });
});
