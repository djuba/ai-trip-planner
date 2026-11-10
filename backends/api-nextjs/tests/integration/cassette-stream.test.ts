// A real Anthropic SSE body (captured live in the WU-03 spike, ADR 0001 Q7) served slowly by a fake
// upstream, recorded through the cassette fetch, then replayed through the real `streamText` and
// provider. Proves streams survive record → replay as separate chunks, with no live call (plan D12).
import { createAnthropic, type AnthropicLanguageModelOptions } from '@ai-sdk/anthropic';
import { streamText, Output } from 'ai';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createCassetteFetch, splitSseEvents } from '../../src/llm/cassette-fetch.ts';

const SSE = await readFile(
  new URL('../support/fixtures/anthropic-stream.sse', import.meta.url),
  'utf8',
);

// The schema the spike streamed with; the captured body is valid against it.
const Presentation = z.object({
  headline: z.string(),
  cards: z.array(
    z.object({
      destination: z.string(),
      blurb: z.string(),
      verification: z.enum(['unverified', 'fixture']),
    }),
  ),
});

/** Sends one SSE event at a time, a tick apart, like a live response. */
const slowUpstream: typeof fetch = () => {
  const encoder = new TextEncoder();
  const events = splitSseEvents(SSE);
  return Promise.resolve(
    new Response(
      new ReadableStream<Uint8Array>({
        async start(controller) {
          for (const event of events) {
            controller.enqueue(encoder.encode(`${event}\n\n`));
            await delay(1);
          }
          controller.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } },
    ),
  );
};

async function present(fetchImpl: typeof fetch) {
  const anthropic = createAnthropic({ apiKey: 'test-key', fetch: fetchImpl });
  const result = streamText({
    model: anthropic('claude-haiku-5-5'),
    system: 'Write the presentation.',
    prompt: 'Two beach destinations from MSP for a family of four.',
    output: Output.object({ schema: Presentation }),
    maxOutputTokens: 800,
    maxRetries: 0,
    providerOptions: {
      anthropic: {
        structuredOutputMode: 'outputFormat',
        effort: 'low',
      } satisfies AnthropicLanguageModelOptions,
    },
  });
  const partials: unknown[] = [];
  for await (const partial of result.partialOutputStream) partials.push(partial);
  return { partials, output: await result.output };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vp-cassettes-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('streamed cassettes', () => {
  it('AC-LLM-12: a stream recorded through the cassette fetch replays as many partial outputs', async () => {
    const recorder = createCassetteFetch({ mode: 'record', dir, network: slowUpstream });
    const live = await present(recorder.fetch);
    await recorder.flush();
    expect(await readdir(dir)).toHaveLength(1);

    const replayed = await present(createCassetteFetch({ mode: 'replay', dir }).fetch);

    expect(replayed.partials.length).toBeGreaterThan(1);
    expect(replayed.partials.length).toBe(live.partials.length);
    expect(Presentation.safeParse(replayed.output).success).toBe(true);
    expect(replayed.output).toEqual(live.output);
  });
});
