// `LlmClient.streamObject` over the AI SDK (WU-11 plan D1): failures before the first partial get
// the one retry and become a plain LlmError (a JSON 502); failures after it are thrown from the
// iterator as mid-stream LlmErrors, with no retry and no unhandled rejection.
import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LlmError } from '../usecases/errors.ts';
import type { LlmStreamPart } from '../usecases/llm-client.ts';
import { createAiSdkLlmClient, type LlmCallLog } from './ai-sdk-client.ts';
import { CassetteMissError } from './cassette-fetch.ts';

const usage = {
  inputTokens: { total: 12, noCache: 12, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 34, text: 34, reasoning: undefined },
};

type Part = Record<string, unknown>;
const finish = (unified: string, raw?: string): Part => ({
  type: 'finish',
  finishReason: { unified, raw },
  usage,
});
const deltas = (text: string, size = 5): Part[] => {
  const out: Part[] = [{ type: 'text-start', id: 't' }];
  for (let i = 0; i < text.length; i += size) {
    out.push({ type: 'text-delta', id: 't', delta: text.slice(i, i + size) });
  }
  return out;
};
const ok = (text: string): Part[] => [
  { type: 'stream-start', warnings: [] },
  ...deltas(text),
  { type: 'text-end', id: 't' },
  finish('stop'),
];

const overloaded = () =>
  new APICallError({
    message: 'Overloaded',
    url: 'https://api.anthropic.com/v1/messages',
    requestBodyValues: {},
    statusCode: 529,
    isRetryable: true,
  });

const schema = z.object({ title: z.string(), tags: z.array(z.string()) });
const request = {
  stage: 'present' as const,
  role: 'fast' as const,
  schema,
  system: 'Write copy.',
  prompt: 'Data.',
  maxOutputTokens: 256,
  effort: 'low' as const,
};
const TEXT = JSON.stringify({ title: 'Sunny beaches in Maui', tags: ['beach', 'snorkeling'] });

/** A part list ending in HANG never closes: the model is still writing. */
const HANG: Part = { type: 'hang' };

/** Each attempt is a list of stream parts, or an error the model call rejects with. */
function setup(...attempts: Array<Part[] | Error>) {
  let calls = 0;
  let cancelled = false;
  const model = new MockLanguageModelV4({
    modelId: 'mock-fast',
    doStream: () => {
      calls += 1;
      const attempt = attempts.shift();
      if (attempt === undefined) throw new Error('no attempt scripted');
      if (attempt instanceof Error) return Promise.reject(attempt);
      let i = 0;
      return Promise.resolve({
        stream: new ReadableStream({
          pull(controller) {
            const part = attempt[i++];
            if (part === HANG) return new Promise<void>(() => undefined);
            if (part === undefined) controller.close();
            else controller.enqueue(part);
            return undefined;
          },
          cancel() {
            cancelled = true;
          },
        }),
      } as never);
    },
  });
  const logs: LlmCallLog[] = [];
  let clock = 0;
  const llm = createAiSdkLlmClient({
    modelFor: () => model,
    log: (entry) => logs.push(entry),
    now: () => (clock += 10),
  });
  return { llm, logs, calls: () => calls, cancelled: () => cancelled };
}

async function collect<T>(stream: AsyncIterable<LlmStreamPart<T>>) {
  const parts: LlmStreamPart<T>[] = [];
  for await (const part of stream) parts.push(part);
  return parts;
}

let unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);
beforeEach(() => {
  unhandled = [];
  process.on('unhandledRejection', onUnhandled);
});
afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('streamObject: a clean stream', () => {
  it('AC-PRESENT-02: yields growing partials, then one final object that passed the schema', async () => {
    const { llm, logs } = setup(ok(TEXT));
    const parts = await collect(await llm.streamObject(request));

    const partials = parts.filter((p) => p.type === 'partial');
    expect(partials.length).toBeGreaterThan(3);
    expect(parts.at(-1)).toEqual({
      type: 'final',
      object: { title: 'Sunny beaches in Maui', tags: ['beach', 'snorkeling'] },
    });
    expect(parts.filter((p) => p.type === 'final')).toHaveLength(1);
    // Each partial differs from the last; none is repeated.
    const seen = partials.map((p) => JSON.stringify(p.partial));
    expect(new Set(seen).size).toBe(seen.length);
    expect(logs).toEqual([
      expect.objectContaining({
        stage: 'present',
        attempt: 1,
        outcome: 'ok',
        inputTokens: 12,
        outputTokens: 34,
      }),
    ]);
  });

  it('AC-PRESENT-02: an early break cancels the model stream and logs the attempt once', async () => {
    const { llm, logs, cancelled } = setup([
      { type: 'stream-start', warnings: [] },
      ...deltas(TEXT.slice(0, 30)),
      HANG,
    ]);
    for await (const part of await llm.streamObject(request)) {
      expect(part.type).toBe('partial');
      break;
    }
    expect(cancelled()).toBe(true);
    expect(logs).toEqual([expect.objectContaining({ outcome: 'error', error: 'AbortError' })]);
    // Aborting the SDK call must not leave a rejection nobody handles (review fix 8).
    await settle();
    expect(unhandled).toEqual([]);
  });
});

describe('streamObject: failures before the first output', () => {
  it('AC-PRESENT-07: a retryable error before any output is retried once, then streams', async () => {
    const { llm, logs, calls } = setup(overloaded(), ok(TEXT));
    const parts = await collect(await llm.streamObject(request));
    expect(parts.at(-1)?.type).toBe('final');
    expect(calls()).toBe(2);
    expect(logs.map((l) => l.outcome)).toEqual(['retry', 'ok']);
  });

  it('AC-PRESENT-07: two failures reject the promise with LLM_UPSTREAM_ERROR, not mid-stream', async () => {
    const { llm, logs } = setup(overloaded(), [
      { type: 'stream-start', warnings: [] },
      { type: 'error', error: overloaded() },
    ]);
    const error = await llm.streamObject(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect(error).toMatchObject({ code: 'LLM_UPSTREAM_ERROR', midStream: false });
    expect(logs.map((l) => l.outcome)).toEqual(['retry', 'error']);
  });

  it('AC-PRESENT-07: a stream that ends with no output is retried', async () => {
    const { llm, calls } = setup(
      [{ type: 'stream-start', warnings: [] }, finish('stop')],
      ok(TEXT),
    );
    await collect(await llm.streamObject(request));
    expect(calls()).toBe(2);
  });

  it('AC-PRESENT-07: a refusal before any output is LLM_REFUSAL, with no retry', async () => {
    const { llm, logs, calls } = setup([
      { type: 'stream-start', warnings: [] },
      finish('content-filter', 'refusal'),
    ]);
    await expect(llm.streamObject(request)).rejects.toMatchObject({
      code: 'LLM_REFUSAL',
      midStream: false,
    });
    expect(calls()).toBe(1);
    expect(logs.map((l) => l.outcome)).toEqual(['refusal']);
  });

  it('AC-PRESENT-07: hitting maxOutputTokens before any output is final, with no retry', async () => {
    const { llm, calls } = setup([{ type: 'stream-start', warnings: [] }, finish('length')]);
    await expect(llm.streamObject(request)).rejects.toMatchObject({ code: 'LLM_UPSTREAM_ERROR' });
    expect(calls()).toBe(1);
  });

  it('a cassette miss rejects as itself (a 500), never as a 502', async () => {
    const { llm } = setup(new CassetteMissError('abc', undefined, 'replay-dir'));
    await expect(llm.streamObject(request)).rejects.toBeInstanceOf(CassetteMissError);
  });
});

describe('streamObject: failures after the first output', () => {
  const half = TEXT.slice(0, 30);

  it('AC-PRESENT-08: an error part mid-stream is thrown by the iterator, with no retry', async () => {
    const { llm, logs, calls } = setup([
      { type: 'stream-start', warnings: [] },
      ...deltas(half),
      { type: 'error', error: overloaded() },
    ]);
    const stream = await llm.streamObject(request);
    const seen: LlmStreamPart<unknown>[] = [];
    const error = await (async () => {
      for await (const part of stream) seen.push(part);
    })().catch((e: unknown) => e);

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((p) => p.type === 'partial')).toBe(true);
    expect(error).toBeInstanceOf(LlmError);
    expect(error).toMatchObject({ code: 'LLM_UPSTREAM_ERROR', midStream: true });
    expect(calls()).toBe(1);
    expect(logs).toEqual([expect.objectContaining({ outcome: 'error', attempt: 1 })]);
    await settle();
    expect(unhandled).toEqual([]);
  });

  it('AC-PRESENT-08: a refusal after output is a mid-stream LLM_REFUSAL', async () => {
    const { llm } = setup([
      { type: 'stream-start', warnings: [] },
      ...deltas(half),
      finish('content-filter', 'refusal'),
    ]);
    await expect(collect(await llm.streamObject(request))).rejects.toMatchObject({
      code: 'LLM_REFUSAL',
      midStream: true,
    });
  });

  it('AC-PRESENT-08: a cut-off at maxOutputTokens after output is a mid-stream failure', async () => {
    const { llm, logs } = setup([
      { type: 'stream-start', warnings: [] },
      ...deltas(half),
      finish('length'),
    ]);
    await expect(collect(await llm.streamObject(request))).rejects.toMatchObject({
      code: 'LLM_UPSTREAM_ERROR',
      midStream: true,
    });
    expect(logs).toEqual([
      expect.objectContaining({ outcome: 'error', error: 'OutputTruncatedError' }),
    ]);
  });

  it('AC-PRESENT-08: a stream that closes without a finish part is a mid-stream failure', async () => {
    const { llm } = setup([{ type: 'stream-start', warnings: [] }, ...deltas(half)]);
    await expect(collect(await llm.streamObject(request))).rejects.toMatchObject({
      midStream: true,
    });
  });

  it('AC-PRESENT-08: a final object that fails the schema is a mid-stream failure', async () => {
    const { llm } = setup(ok(JSON.stringify({ title: 'x', tags: 'not a list' })));
    await expect(collect(await llm.streamObject(request))).rejects.toMatchObject({
      code: 'LLM_UPSTREAM_ERROR',
      midStream: true,
    });
  });

  it('AC-PRESENT-08: a final object that fails accept is a mid-stream failure', async () => {
    const { llm } = setup(ok(TEXT));
    const stream = await llm.streamObject({
      ...request,
      accept: z.object({ title: z.string().max(3) }),
    });
    await expect(collect(stream)).rejects.toMatchObject({ midStream: true });
    await settle();
    expect(unhandled).toEqual([]);
  });

  it('a cassette miss mid-stream is thrown as itself', async () => {
    const { llm } = setup([
      { type: 'stream-start', warnings: [] },
      ...deltas(half),
      { type: 'error', error: new CassetteMissError('abc', undefined, 'replay-dir') },
    ]);
    await expect(collect(await llm.streamObject(request))).rejects.toBeInstanceOf(
      CassetteMissError,
    );
  });
});
