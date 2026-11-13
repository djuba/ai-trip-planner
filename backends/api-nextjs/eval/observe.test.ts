import { ClarificationOutput } from '@vp/domain-schema/wire';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createMockLlmClient, mockObject, mockRaw, type MockResponder } from '../src/llm/index.ts';
import type { LlmObjectRequest } from '../src/usecases/llm-client.ts';
import { observeLlm } from './observe.ts';
import type { Attempt } from './types.ts';

const NonBlank = z.object({ question: z.string().refine((q) => q.trim() !== '') });

const request = (accept?: z.ZodType): LlmObjectRequest<ClarificationOutput> => ({
  stage: 'clarify',
  role: 'fast',
  schema: ClarificationOutput,
  ...(accept ? { accept } : {}),
  system: 'system',
  prompt: 'prompt',
  maxOutputTokens: 64,
  effort: 'low',
});

function observed(responder: MockResponder) {
  const attempts: Attempt[] = [];
  const inner = createMockLlmClient({ clarify: responder }, { log: () => {}, now: () => 0 });
  return { client: observeLlm(inner, (a) => attempts.push(a)), attempts };
}

const reply = (question: string) => mockObject(ClarificationOutput, { question });

describe('observeLlm', () => {
  it('AC-EVAL-05: invalid then valid output records both attempts, and the call succeeds', async () => {
    const { client, attempts } = observed((_req, attempt) => reply(attempt === 1 ? '  ' : 'When?'));
    await expect(client.generateObject(request(NonBlank))).resolves.toEqual({
      question: 'When?',
    });
    expect(attempts).toEqual([
      { stage: 'clarify', output: { question: '  ' }, accepted: false },
      { stage: 'clarify', output: { question: 'When?' }, accepted: true },
    ]);
  });

  it('AC-EVAL-05: invalid output twice fails with LLM_UPSTREAM_ERROR, as without the observer', async () => {
    const { client, attempts } = observed(reply(' '));
    await expect(client.generateObject(request(NonBlank))).rejects.toMatchObject({
      code: 'LLM_UPSTREAM_ERROR',
    });
    expect(attempts.map((a) => a.accepted)).toEqual([false, false]);
  });

  it('AC-EVAL-05: a call with no accept check is recorded and never rejected', async () => {
    const { client, attempts } = observed(reply(''));
    await expect(client.generateObject(request())).resolves.toEqual({ question: '' });
    expect(attempts).toEqual([{ stage: 'clarify', output: { question: '' }, accepted: true }]);
  });

  it('records nothing for output the schema itself rejects; the adapter still retries it', async () => {
    const { client, attempts } = observed((_req, attempt) =>
      attempt === 1 ? mockRaw('not json') : reply('Where to?'),
    );
    await expect(client.generateObject(request(NonBlank))).resolves.toEqual({
      question: 'Where to?',
    });
    expect(attempts).toHaveLength(1);
  });
});
