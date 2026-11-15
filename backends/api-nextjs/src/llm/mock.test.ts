import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LlmError } from '../usecases/errors.ts';
import type { LlmObjectRequest, LlmStage } from '../usecases/llm-client.ts';
import type { LlmCallLog } from './ai-sdk-client.ts';
import {
  createMockLlmClient,
  mockObject,
  mockRaw,
  mockRefusal,
  mockStreamFailure,
  MockNotConfiguredError,
  type MockResponder,
} from './mock.ts';

const Answer = z.object({ answer: z.string() });
const Count = z.object({ count: z.number() });

function requestFor(stage: LlmStage): LlmObjectRequest<{ answer: string }> {
  return {
    stage,
    role: 'fast',
    schema: Answer,
    system: 'system',
    prompt: 'prompt',
    maxOutputTokens: 100,
    effort: 'low',
  };
}

function clientWith(responders: Partial<Record<LlmStage, MockResponder>>) {
  const logs: LlmCallLog[] = [];
  const client = createMockLlmClient(responders, { log: (e) => logs.push(e), now: () => 0 });
  return { client, logs };
}

describe('mock LlmClient', () => {
  it('AC-LLM-13: returns the configured value for each stage', async () => {
    const { client, logs } = clientWith({
      extract: mockObject(Answer, { answer: 'one' }),
      clarify: mockObject(Answer, { answer: 'two' }),
    });

    await expect(client.generateObject(requestFor('extract'))).resolves.toEqual({ answer: 'one' });
    await expect(client.generateObject(requestFor('clarify'))).resolves.toEqual({ answer: 'two' });
    expect(logs.map((l) => [l.stage, l.model, l.outcome])).toEqual([
      ['extract', 'mock-fast', 'ok'],
      ['clarify', 'mock-fast', 'ok'],
    ]);
  });

  it('AC-LLM-13: mockObject rejects a value that does not match its schema', () => {
    expect(() => mockObject(Count, { count: 'many' })).toThrow(/count/);
  });

  it('AC-LLM-13: mockRefusal surfaces as LLM_REFUSAL', async () => {
    const { client } = clientWith({ extract: mockRefusal() });

    await expect(client.generateObject(requestFor('extract'))).rejects.toMatchObject({
      constructor: LlmError,
      code: 'LLM_REFUSAL',
    });
  });

  it('AC-LLM-13: malformed output twice surfaces as LLM_UPSTREAM_ERROR', async () => {
    const { client, logs } = clientWith({ extract: mockRaw('{') });

    await expect(client.generateObject(requestFor('extract'))).rejects.toMatchObject({
      code: 'LLM_UPSTREAM_ERROR',
    });
    expect(logs.map((l) => l.outcome)).toEqual(['retry', 'error']);
  });

  it('AC-LLM-13: a responder function sees the attempt, so the real retry runs', async () => {
    const attempts: number[] = [];
    const { client } = clientWith({
      extract: (_request, attempt) => {
        attempts.push(attempt);
        return attempt === 1 ? mockRaw('{') : mockObject(Answer, { answer: 'second' });
      },
    });

    await expect(client.generateObject(requestFor('extract'))).resolves.toEqual({
      answer: 'second',
    });
    expect(attempts).toEqual([1, 2]);
  });

  it('AC-LLM-13: a stage with no responder rejects with MockNotConfiguredError', async () => {
    const { client } = clientWith({ extract: mockObject(Answer, { answer: 'x' }) });

    const error: unknown = await client
      .generateObject(requestFor('present'))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MockNotConfiguredError);
    expect(error).not.toBeInstanceOf(LlmError);
    expect((error as Error).message).toContain('present');
  });
});

describe('mock LlmClient streaming (WU-11 plan D1)', () => {
  const long = { answer: 'A long enough answer to need several chunks of mock text.' };

  async function drain(parts: AsyncIterable<unknown>) {
    const out: unknown[] = [];
    for await (const part of parts) out.push(part);
    return out;
  }

  it('AC-PRESENT-02: streams the reply in chunks, ending in the final object', async () => {
    const { client, logs } = clientWith({ present: mockObject(Answer, long) });
    const parts = await drain(await client.streamObject(requestFor('present')));
    expect(parts.length).toBeGreaterThan(3);
    expect(parts.at(-1)).toEqual({ type: 'final', object: long });
    expect(logs).toEqual([expect.objectContaining({ model: 'mock-fast', outcome: 'ok' })]);
  });

  it('AC-PRESENT-08: mockStreamFailure fails mid-stream after some output', async () => {
    const { client } = clientWith({ present: mockStreamFailure(Answer, long, 30) });
    const stream = await client.streamObject(requestFor('present'));
    await expect(drain(stream)).rejects.toMatchObject({ midStream: true });
  });

  it('AC-PRESENT-07: a refusal rejects before any output, and the retry sees attempt 2', async () => {
    const { client } = clientWith({ present: mockRefusal() });
    await expect(client.streamObject(requestFor('present'))).rejects.toBeInstanceOf(LlmError);

    const attempts: number[] = [];
    const retried = clientWith({
      present: (_request, attempt) => {
        attempts.push(attempt);
        return attempt === 1 ? mockRaw('') : mockObject(Answer, long);
      },
    });
    await drain(await retried.client.streamObject(requestFor('present')));
    expect(attempts).toEqual([1, 2]);
  });

  it('a stage with no responder rejects with MockNotConfiguredError', async () => {
    const { client } = clientWith({});
    await expect(client.streamObject(requestFor('present'))).rejects.toBeInstanceOf(
      MockNotConfiguredError,
    );
  });
});
