// LLM_MODE=mock (CLAUDE.md §6.1, §8.3; WU-08 plan D6; WU-11 plan D1). Each call builds an AI SDK
// mock model bound to the stage's responder and runs it through the real adapter, so the refusal
// check, the one retry and the `safeParse` all run for real. Only the model is fake. A streamed
// call gets the same reply in small text chunks.
import { MockLanguageModelV4 } from 'ai/test';
import type { z } from 'zod';
import type { LlmClient, LlmObjectRequest, LlmStage } from '../usecases/llm-client.ts';
import { createAiSdkLlmClient, type LlmCallLog } from './ai-sdk-client.ts';

interface ReplyData {
  readonly text: string | undefined;
  readonly refusal: boolean;
  /** Streamed calls only: send this many characters of `text`, then an `error` part. */
  readonly failAfter?: number;
}

/** What a mock model answers with. Build one with `mockObject`, `mockRefusal` or `mockRaw`. */
export type MockReply = { readonly __mockReply: ReplyData };

/** A fixed reply, or a function of the request and the 1-based attempt (the retry is attempt 2). */
export type MockResponder =
  MockReply | ((request: LlmObjectRequest<unknown>, attempt: number) => MockReply);

/** A stage was called with no responder configured. A test-setup failure, never a 502. */
export class MockNotConfiguredError extends Error {
  constructor(stage: LlmStage) {
    super(`LLM_MODE=mock has no responder for stage "${stage}".`);
    this.name = 'MockNotConfiguredError';
  }
}

/** A reply whose text is `value`, checked against `schema` here so a mock cannot drift (§6.1). */
export function mockObject<T>(schema: z.ZodType<T>, value: unknown): MockReply {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Mock reply does not match its schema: ${parsed.error.message}`);
  }
  return { __mockReply: { text: JSON.stringify(parsed.data), refusal: false } };
}

/** A refusal: the call succeeds with `finishReason: 'content-filter'` and no content. */
export function mockRefusal(): MockReply {
  return { __mockReply: { text: undefined, refusal: true } };
}

/**
 * A streamed reply that fails partway: the first `afterChars` characters of `value`'s JSON, then
 * an `error` part, as an overloaded provider sends mid-stream (WU-11 plan D1). A non-streamed call
 * gets the error before any output.
 */
export function mockStreamFailure<T>(
  schema: z.ZodType<T>,
  value: unknown,
  afterChars: number,
): MockReply {
  const { __mockReply: reply } = mockObject(schema, value);
  return { __mockReply: { ...reply, failAfter: afterChars } };
}

/** Arbitrary text, for malformed or schema-invalid model output. */
export function mockRaw(text: string): MockReply {
  return { __mockReply: { text, refusal: false } };
}

const MOCK_INPUT_TOKENS = 10;
const MOCK_OUTPUT_TOKENS = 20;

function usage(input: number, output: number) {
  return {
    inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: output, text: output, reasoning: undefined },
  };
}

function resultOf({ __mockReply: reply }: MockReply) {
  return {
    content: reply.text === undefined ? [] : [{ type: 'text' as const, text: reply.text }],
    finishReason: reply.refusal
      ? { unified: 'content-filter' as const, raw: 'refusal' }
      : { unified: 'stop' as const, raw: undefined },
    usage: usage(MOCK_INPUT_TOKENS, reply.text === undefined ? 0 : MOCK_OUTPUT_TOKENS),
    warnings: [],
  };
}

/** Characters per streamed text delta: small, so tests see many partials. */
export const MOCK_CHUNK_SIZE = 12;

class MockStreamError extends Error {
  constructor() {
    super('Mock stream failure');
    this.name = 'MockStreamError';
  }
}

function streamOf({ __mockReply: reply }: MockReply) {
  const text = reply.text ?? '';
  const sent = reply.failAfter === undefined ? text : text.slice(0, reply.failAfter);
  const parts: unknown[] = [{ type: 'stream-start', warnings: [] }];
  if (sent.length > 0) {
    parts.push({ type: 'text-start', id: 't0' });
    for (let i = 0; i < sent.length; i += MOCK_CHUNK_SIZE) {
      parts.push({ type: 'text-delta', id: 't0', delta: sent.slice(i, i + MOCK_CHUNK_SIZE) });
    }
  }
  if (reply.failAfter !== undefined) {
    parts.push({ type: 'error', error: new MockStreamError() });
  } else {
    if (sent.length > 0) parts.push({ type: 'text-end', id: 't0' });
    const { finishReason, usage } = resultOf({ __mockReply: reply });
    parts.push({ type: 'finish', finishReason, usage });
  }
  return {
    stream: new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    }),
  };
}

export function createMockLlmClient(
  responders: Partial<Record<LlmStage, MockResponder>>,
  deps: { log: (entry: LlmCallLog) => void; now: () => number },
): LlmClient {
  return {
    generateObject<T>(request: LlmObjectRequest<T>): Promise<T> {
      const responder = responders[request.stage];
      if (responder === undefined) {
        return Promise.reject(new MockNotConfiguredError(request.stage));
      }
      let attempt = 0;
      const model = new MockLanguageModelV4({
        modelId: `mock-${request.role}`,
        doGenerate: () => {
          attempt += 1;
          const reply = typeof responder === 'function' ? responder(request, attempt) : responder;
          return Promise.resolve(resultOf(reply) as never);
        },
      });
      return createAiSdkLlmClient({ modelFor: () => model, ...deps }).generateObject(request);
    },

    streamObject<T>(request: LlmObjectRequest<T>) {
      const responder = responders[request.stage];
      if (responder === undefined) {
        return Promise.reject(new MockNotConfiguredError(request.stage));
      }
      let attempt = 0;
      const model = new MockLanguageModelV4({
        modelId: `mock-${request.role}`,
        doStream: () => {
          attempt += 1;
          const reply = typeof responder === 'function' ? responder(request, attempt) : responder;
          return Promise.resolve(streamOf(reply) as never);
        },
      });
      return createAiSdkLlmClient({ modelFor: () => model, ...deps }).streamObject(request);
    },
  };
}
