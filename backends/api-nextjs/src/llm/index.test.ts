import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { anthropicMessage, jsonResponse } from '../../tests/support/anthropic-responses.ts';
import type { Config } from '../config.ts';
import type { LlmObjectRequest } from '../usecases/llm-client.ts';
import { CassetteMissError, createLlmClient, mockObject } from './index.ts';

const Answer = z.object({ answer: z.string() });

const request: LlmObjectRequest<{ answer: string }> = {
  stage: 'recommend',
  role: 'reasoning',
  schema: Answer,
  system: 'system',
  prompt: 'prompt',
  maxOutputTokens: 100,
  effort: 'medium',
};

const base: Config = {
  llmMode: 'replay',
  models: { fast: 'model-fast', reasoning: 'model-reasoning', critic: 'model-critic' },
  webOrigin: 'http://localhost:3000',
};

const quiet = { log: () => undefined, now: () => 0 };

function okNetwork() {
  return vi.fn<typeof fetch>(() =>
    Promise.resolve(
      jsonResponse(
        anthropicMessage({
          model: 'model-reasoning',
          text: JSON.stringify({ answer: 'hi' }),
          stopReason: 'end_turn',
        }),
      ),
    ),
  );
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'llm-index-'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe('createLlmClient', () => {
  it('AC-LLM-17: replay with no cassette rejects with CassetteMissError and never uses the network', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch');
    const { client } = createLlmClient({ ...base, llmMode: 'replay', cassetteDir: dir }, quiet);

    await expect(client.generateObject(request)).rejects.toBeInstanceOf(CassetteMissError);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it('AC-LLM-17: record calls the network and writes one cassette on flush', async () => {
    const network = okNetwork();
    const { client, flush } = createLlmClient(
      { ...base, llmMode: 'record', anthropicApiKey: 'sk-test', cassetteDir: dir },
      { ...quiet, network },
    );

    await expect(client.generateObject(request)).resolves.toEqual({ answer: 'hi' });
    await flush();

    expect(network).toHaveBeenCalledTimes(1);
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f]{64}\.json$/);
  });

  it('AC-LLM-17: live sends the API key and the configured model for the role', async () => {
    const network = okNetwork();
    const { client, flush } = createLlmClient(
      { ...base, llmMode: 'live', anthropicApiKey: 'sk-test' },
      { ...quiet, network },
    );

    await client.generateObject(request);
    await flush();

    const init = network.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get('x-api-key')).toBe('sk-test');
    expect((JSON.parse(init?.body as string) as { model: string }).model).toBe('model-reasoning');
  });

  it('AC-LLM-17: mock without responders throws at construction', () => {
    expect(() => createLlmClient({ ...base, llmMode: 'mock' }, quiet)).toThrow(
      'LLM_MODE=mock needs mockResponders',
    );
  });

  it('AC-LLM-17: mock with responders returns the configured value', async () => {
    const { client } = createLlmClient(
      { ...base, llmMode: 'mock' },
      { ...quiet, mockResponders: { recommend: mockObject(Answer, { answer: 'mocked' }) } },
    );

    await expect(client.generateObject(request)).resolves.toEqual({ answer: 'mocked' });
  });

  it.each(['record', 'replay'] as const)(
    'AC-LLM-17: %s without a cassette directory throws',
    (llmMode) => {
      expect(() =>
        createLlmClient(
          { ...base, llmMode, anthropicApiKey: 'sk-test' },
          { ...quiet, workspace: { cwd: '/nowhere', exists: () => false } },
        ),
      ).toThrow(/LLM_CASSETTE_DIR/);
    },
  );

  it('AC-LLM-17: the default clock and console log work without injected deps', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { client } = createLlmClient(
      { ...base, llmMode: 'mock' },
      { mockResponders: { recommend: mockObject(Answer, { answer: 'x' }) } },
    );

    await client.generateObject(request);

    expect(info).toHaveBeenCalledWith(expect.stringContaining('[llm] stage=recommend'));
  });

  it('AC-LLM-17: the default network reads the global fetch lazily', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(
        anthropicMessage({
          model: 'model-reasoning',
          text: JSON.stringify({ answer: 'hi' }),
          stopReason: 'end_turn',
        }),
      ),
    );
    const { client } = createLlmClient(
      { ...base, llmMode: 'live', anthropicApiKey: 'sk-test' },
      quiet,
    );

    await expect(client.generateObject(request)).resolves.toEqual({ answer: 'hi' });
    expect(globalFetch).toHaveBeenCalledTimes(1);
  });
});
