// The AI SDK LlmClient against the real Anthropic provider, with the network replaced by a scripted
// fetch (CLAUDE.md §6.3 integration: structured-output parsing, refusal, malformed output → retry).
import { createAnthropic } from '@ai-sdk/anthropic';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createAiSdkLlmClient, type LlmCallLog } from '../../src/llm/ai-sdk-client.ts';
import { CassetteMissError, createCassetteFetch } from '../../src/llm/cassette-fetch.ts';
import { LlmError } from '../../src/usecases/errors.ts';
import type { LlmObjectRequest, ModelRole } from '../../src/usecases/llm-client.ts';
import {
  anthropicError,
  anthropicMessage,
  anthropicSseEvents,
  jsonResponse,
  scriptedFetch,
  sseResponse,
} from '../support/anthropic-responses.ts';

const MODELS: Record<ModelRole, string> = {
  fast: 'claude-haiku-5-5',
  reasoning: 'claude-sonnet-5-5',
  critic: 'claude-sonnet-5-5',
};

const Answer = z.object({ city: z.string().nullable(), nights: z.int().nullable() });

const request = (overrides: Partial<LlmObjectRequest<z.infer<typeof Answer>>> = {}) => ({
  stage: 'extract' as const,
  role: 'fast' as const,
  schema: Answer,
  system: 'Extract the city and number of nights.',
  prompt: 'Four nights in Lisbon.',
  maxOutputTokens: 256,
  effort: 'low' as const,
  ...overrides,
});

function client(fetchImpl: typeof fetch) {
  const anthropic = createAnthropic({ apiKey: 'test-key', fetch: fetchImpl });
  const logs: LlmCallLog[] = [];
  let tick = 0;
  const llm = createAiSdkLlmClient({
    modelFor: (role) => anthropic(MODELS[role]),
    log: (entry) => logs.push(entry),
    now: () => (tick += 5),
  });
  return { llm, logs };
}

const ok = (model: string, text: string) => () =>
  jsonResponse(anthropicMessage({ model, text, stopReason: 'end_turn' }));

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

describe('AI SDK LlmClient over the Anthropic provider', () => {
  it('AC-LLM-06: sends native structured output, effort, an explicit cap and the role model; no sampling or tools', async () => {
    const net = scriptedFetch(ok('claude-sonnet-5-5', '{"city":"Lisbon","nights":4}'));
    const { llm, logs } = client(net.fetch);

    await expect(
      llm.generateObject(request({ role: 'reasoning', effort: 'medium' })),
    ).resolves.toEqual({
      city: 'Lisbon',
      nights: 4,
    });

    expect(net.bodies).toHaveLength(1);
    const body = net.bodies[0]!;
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.max_tokens).toBe(256);
    expect(body.output_config).toMatchObject({
      effort: 'medium',
      format: { type: 'json_schema' },
    });
    for (const key of ['temperature', 'top_p', 'top_k', 'tools', 'tool_choice']) {
      expect(body).not.toHaveProperty(key);
    }
    expect(logs).toEqual([expect.objectContaining({ outcome: 'ok', warnings: [] })]);
  });

  it('AC-LLM-07: a refusal is LLM_REFUSAL after one request', async () => {
    const net = scriptedFetch(() =>
      jsonResponse(anthropicMessage({ model: 'claude-haiku-5-5', stopReason: 'refusal' })),
    );
    const { llm, logs } = client(net.fetch);

    const error = await rejection(llm.generateObject(request()));

    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).code).toBe('LLM_REFUSAL');
    expect(net.bodies).toHaveLength(1);
    expect(logs.map((l) => l.outcome)).toEqual(['refusal']);
  });

  it('AC-LLM-08: schema-invalid output is retried once and the retry’s value returned', async () => {
    const net = scriptedFetch(
      ok('claude-haiku-5-5', '{"city":"Lisbon"}'),
      ok('claude-haiku-5-5', '{"city":"Lisbon","nights":4}'),
    );
    const { llm, logs } = client(net.fetch);

    await expect(llm.generateObject(request())).resolves.toEqual({ city: 'Lisbon', nights: 4 });
    expect(net.bodies).toHaveLength(2);
    expect(logs.map((l) => l.outcome)).toEqual(['retry', 'ok']);
  });

  it.each([
    ['schema-invalid', '{"city":"Lisbon","nights":"four"}'],
    ['non-JSON', 'Sure! Lisbon for four nights.'],
  ])(
    'AC-LLM-08: %s output twice is LLM_UPSTREAM_ERROR after exactly two requests',
    async (_, text) => {
      const net = scriptedFetch(ok('claude-haiku-5-5', text), ok('claude-haiku-5-5', text));
      const { llm, logs } = client(net.fetch);

      const error = await rejection(llm.generateObject(request()));

      expect(error).toBeInstanceOf(LlmError);
      expect((error as LlmError).code).toBe('LLM_UPSTREAM_ERROR');
      expect(net.bodies).toHaveLength(2);
      expect(logs.map((l) => l.outcome)).toEqual(['retry', 'error']);
    },
  );

  it('AC-LLM-19: output cut off at maxOutputTokens is LLM_UPSTREAM_ERROR after one request', async () => {
    const truncated = () =>
      jsonResponse(
        anthropicMessage({
          model: 'claude-haiku-5-5',
          text: '{"city":"Lis',
          stopReason: 'max_tokens',
        }),
      );
    // A second scripted reply would succeed, so a retry would make this test pass wrongly.
    const net = scriptedFetch(truncated, ok('claude-haiku-5-5', '{"city":"Lisbon","nights":4}'));
    const { llm, logs } = client(net.fetch);

    const error = await rejection(llm.generateObject(request()));

    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).code).toBe('LLM_UPSTREAM_ERROR');
    expect(net.bodies).toHaveLength(1);
    expect(logs).toEqual([
      expect.objectContaining({ outcome: 'error', error: 'OutputTruncatedError' }),
    ]);
  });

  it('AC-LLM-09: HTTP 529 is retried once, then LLM_UPSTREAM_ERROR', async () => {
    const overloaded = () => anthropicError(529, 'overloaded_error');
    const net = scriptedFetch(overloaded, overloaded);
    const { llm } = client(net.fetch);

    const error = await rejection(llm.generateObject(request()));

    expect((error as LlmError).code).toBe('LLM_UPSTREAM_ERROR');
    expect(net.bodies).toHaveLength(2);
  });

  it('AC-LLM-09: HTTP 400 is LLM_UPSTREAM_ERROR after one request', async () => {
    const net = scriptedFetch(() => anthropicError(400, 'invalid_request_error'));
    const { llm, logs } = client(net.fetch);

    const error = await rejection(llm.generateObject(request()));

    expect((error as LlmError).code).toBe('LLM_UPSTREAM_ERROR');
    expect(net.bodies).toHaveLength(1);
    expect(logs.map((l) => l.outcome)).toEqual(['error']);
  });

  it('AC-LLM-10: a replay miss surfaces as CassetteMissError, not LlmError, after one attempt', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vp-cassettes-'));
    try {
      const replay = createCassetteFetch({ mode: 'replay', dir });
      const { llm, logs } = client(replay.fetch);

      const error = await rejection(llm.generateObject(request()));

      expect(error).toBeInstanceOf(CassetteMissError);
      expect((error as Error).message).toContain('re-record with `LLM_MODE=record`');
      expect(logs).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('AI SDK LlmClient.streamObject over the Anthropic provider (WU-11 plan D1)', () => {
  const model = 'claude-haiku-5-5';
  const text = JSON.stringify({ city: 'Lisbon', nights: 4 });
  const stream =
    (opts: Partial<Parameters<typeof anthropicSseEvents>[0]> = {}) =>
    () =>
      sseResponse(anthropicSseEvents({ model, text, chunkSize: 6, ...opts }));

  async function drain(parts: AsyncIterable<unknown>): Promise<unknown[]> {
    const out: unknown[] = [];
    for await (const part of parts) out.push(part);
    return out;
  }

  it('AC-PRESENT-02: sends native structured output and streams partials, then the final object', async () => {
    const scripted = scriptedFetch(stream());
    const { llm, logs } = client(scripted.fetch);

    const parts = await drain(await llm.streamObject(request()));

    expect(scripted.bodies[0]).toMatchObject({
      model,
      stream: true,
      max_tokens: 256,
      output_config: { effort: 'low', format: { type: 'json_schema' } },
    });
    expect(scripted.bodies[0]).not.toHaveProperty('temperature');
    expect(scripted.bodies[0]).not.toHaveProperty('tool_choice');
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.at(-1)).toEqual({ type: 'final', object: { city: 'Lisbon', nights: 4 } });
    expect(logs).toEqual([expect.objectContaining({ outcome: 'ok', warnings: [] })]);
  });

  it('AC-PRESENT-07: HTTP 529 before the stream is retried once, then LLM_UPSTREAM_ERROR', async () => {
    const scripted = scriptedFetch(
      () => anthropicError(529, 'overloaded_error'),
      () => anthropicError(529, 'overloaded_error'),
    );
    const { llm } = client(scripted.fetch);
    const error = await rejection(llm.streamObject(request()));
    expect(error).toBeInstanceOf(LlmError);
    expect(error).toMatchObject({ code: 'LLM_UPSTREAM_ERROR', midStream: false });
    expect(scripted.bodies).toHaveLength(2);
  });

  it('AC-PRESENT-07: a refusal with no output is LLM_REFUSAL after one request', async () => {
    const scripted = scriptedFetch(stream({ text: '', stopReason: 'refusal' }));
    const { llm } = client(scripted.fetch);
    await expect(llm.streamObject(request())).rejects.toMatchObject({ code: 'LLM_REFUSAL' });
    expect(scripted.bodies).toHaveLength(1);
  });

  it('AC-PRESENT-08: an error event after output is a mid-stream LlmError with no retry', async () => {
    const scripted = scriptedFetch(stream({ errorAfter: 14 }));
    const { llm, logs } = client(scripted.fetch);

    const parts = await llm.streamObject(request());
    const error = await rejection(drain(parts));

    expect(error).toBeInstanceOf(LlmError);
    expect(error).toMatchObject({ code: 'LLM_UPSTREAM_ERROR', midStream: true });
    expect(scripted.bodies).toHaveLength(1);
    expect(logs).toEqual([expect.objectContaining({ outcome: 'error' })]);
  });

  it('AC-PRESENT-08: output cut off at maxOutputTokens after output is a mid-stream failure', async () => {
    const scripted = scriptedFetch(stream({ text: text.slice(0, 20), stopReason: 'max_tokens' }));
    const { llm, logs } = client(scripted.fetch);
    await expect(drain(await llm.streamObject(request()))).rejects.toMatchObject({
      midStream: true,
    });
    expect(logs).toEqual([
      expect.objectContaining({ outcome: 'error', error: 'OutputTruncatedError' }),
    ]);
  });
});
