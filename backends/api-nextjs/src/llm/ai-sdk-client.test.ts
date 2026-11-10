import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { consoleLlmLog, createAiSdkLlmClient, type LlmCallLog } from './ai-sdk-client.ts';

const usage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: output, text: output, reasoning: undefined },
});

function textReply(text: string, warnings: unknown[] = []) {
  return {
    content: [{ type: 'text' as const, text }],
    finishReason: { unified: 'stop' as const, raw: undefined },
    usage: usage(12, 34),
    warnings,
  };
}

const request = {
  stage: 'clarify' as const,
  role: 'fast' as const,
  schema: z.object({ question: z.string() }),
  system: 'Ask one question.',
  prompt: 'Missing dates.',
  maxOutputTokens: 128,
  effort: 'low' as const,
};

function setup(...replies: Array<ReturnType<typeof textReply>>) {
  const model = new MockLanguageModelV4({
    modelId: 'mock-fast',
    doGenerate: () => {
      const reply = replies.shift();
      if (reply === undefined) throw new Error('no reply scripted');
      return Promise.resolve(reply as never);
    },
  });
  const logs: LlmCallLog[] = [];
  const times = [100, 140, 200, 275];
  const llm = createAiSdkLlmClient({
    modelFor: () => model,
    log: (entry) => logs.push(entry),
    now: () => times.shift() ?? 0,
  });
  return { llm, logs };
}

describe('AI SDK LlmClient logging', () => {
  it('AC-LLM-14: logs stage, role, model, tokens, latency from the injected clock and outcome', async () => {
    const { llm, logs } = setup(textReply('{"question":"When?"}'));

    await expect(llm.generateObject(request)).resolves.toEqual({ question: 'When?' });

    expect(logs).toEqual([
      {
        stage: 'clarify',
        role: 'fast',
        model: 'mock-fast',
        attempt: 1,
        outcome: 'ok',
        inputTokens: 12,
        outputTokens: 34,
        latencyMs: 40,
        warnings: [],
      },
    ]);
  });

  it('AC-LLM-14: a retried call logs each attempt, including the failure', async () => {
    const { llm, logs } = setup(textReply('{"q":1}'), textReply('{"question":"When?"}'));

    await llm.generateObject(request);

    expect(
      logs.map(({ attempt, outcome, latencyMs, error }) => ({
        attempt,
        outcome,
        latencyMs,
        error,
      })),
    ).toEqual([
      { attempt: 1, outcome: 'retry', latencyMs: 40, error: 'AI_NoObjectGeneratedError' },
      { attempt: 2, outcome: 'ok', latencyMs: 75, error: undefined },
    ]);
    // The rejected attempt was billed, so its tokens are logged too.
    expect(logs[0]).toMatchObject({ inputTokens: 12, outputTokens: 34 });
  });

  it('AC-LLM-08: output the SDK accepted but our own safeParse rejects is retried', async () => {
    const schema = z.object({ question: z.string() });
    const realSafeParse = schema.safeParse.bind(schema);
    // Fail only the adapter's own check: the SDK validates through Standard Schema, not safeParse.
    const safeParse = vi
      .spyOn(schema, 'safeParse')
      .mockImplementationOnce(() => realSafeParse({ question: 1 }));
    const { llm, logs } = setup(
      textReply('{"question":"When?"}'),
      textReply('{"question":"Where?"}'),
    );

    await expect(llm.generateObject({ ...request, schema })).resolves.toEqual({
      question: 'Where?',
    });
    expect(safeParse).toHaveBeenCalledTimes(2);
    expect(logs.map(({ outcome, error }) => [outcome, error])).toEqual([
      ['retry', 'OutputInvalidError'],
      ['ok', undefined],
    ]);
  });

  it('AC-LLM-14: SDK warnings are logged', async () => {
    const warning = { type: 'unsupported', feature: 'temperature' };
    const { llm, logs } = setup(textReply('{"question":"When?"}', [warning]));

    // The SDK would also print this deliberate warning to the console; keep the run quiet.
    globalThis.AI_SDK_LOG_WARNINGS = false;
    try {
      await llm.generateObject(request);
    } finally {
      delete globalThis.AI_SDK_LOG_WARNINGS;
    }

    expect(logs[0]?.warnings).toEqual([JSON.stringify(warning)]);
  });

  it('AC-LLM-14: the console log is one line with the fields and any warnings', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      consoleLlmLog({
        stage: 'extract',
        role: 'fast',
        model: 'claude-haiku-5-5',
        attempt: 1,
        outcome: 'ok',
        inputTokens: 1,
        outputTokens: undefined,
        latencyMs: 9,
        warnings: ['w1'],
      });
      expect(info).toHaveBeenCalledWith(
        '[llm] stage=extract role=fast model=claude-haiku-5-5 attempt=1 outcome=ok inputTokens=1 latencyMs=9 warnings=w1',
      );
    } finally {
      info.mockRestore();
    }
  });
});
