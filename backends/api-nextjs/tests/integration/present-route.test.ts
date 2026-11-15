// The real /present handler with real Request objects and a mock LlmClient (CLAUDE.md §6.3; WU-11
// plan D5, D9): stream headers and chunking, the JSON 502 before the stream, the errored stream
// after it, 422 shape errors, CORS and the flush.
import { PresentationCopy, PresentationModel, type PresentRequest } from '@vp/domain-schema/wire';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPresentPost } from '../../src/http/present.ts';
import { getRouteData } from '../../src/http/route-data.ts';
import { preflight } from '../../src/http/route.ts';
import {
  createMockLlmClient,
  mockObject,
  mockRaw,
  mockRefusal,
  mockStreamFailure,
  type LlmRuntime,
  type MockResponder,
} from '../../src/llm/index.ts';
import type { PresentDiscard } from '../../src/usecases/present/stream-writer.ts';
import { authHeaders } from '../support/invite.ts';
import { stubInviteEnv } from '../support/stub-invite-env.ts';

const WEB_ORIGIN = 'https://web.example.test';

const REQUEST: PresentRequest = {
  profile: { departure: { city: 'Minneapolis' }, experiences: ['beach'] },
  recommendations: [
    {
      id: 'rec-1',
      destination: 'Maui, Hawaii',
      summary: 'Warm beaches.',
      matchedExperiences: ['beach'],
      claims: [{ kind: 'price', statement: 'Prices vary.', verification: 'unverified' }],
    },
  ],
};

const COPY = mockObject(PresentationCopy, {
  headline: 'Sun and surf in Maui for the two of you',
  intro: 'A warm week of beaches and calm water, close to great snorkeling.',
  cards: [{ title: 'Maui', blurb: 'Golden beaches and turtles.', highlights: ['Molokini'] }],
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://api.test/v1/trip/present', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: WEB_ORIGIN,
      ...authHeaders(),
      ...headers,
    },
    body: JSON.stringify(body),
  });

function handler(responder?: MockResponder) {
  let calls = 0;
  let flushes = 0;
  const discarded: PresentDiscard[] = [];
  const runtime: LlmRuntime = {
    client: createMockLlmClient(
      responder === undefined
        ? {}
        : {
            present: (request, attempt) => {
              calls += 1;
              return typeof responder === 'function' ? responder(request, attempt) : responder;
            },
          },
      { log: () => undefined, now: () => 0 },
    ),
    flush: () => {
      flushes += 1;
      return Promise.resolve();
    },
  };
  const POST = createPresentPost({
    llm: () => runtime,
    routes: getRouteData,
    logDiscarded: (entry) => discarded.push(entry),
  });
  return { POST, calls: () => calls, flushes: () => flushes, discarded };
}

async function readChunks(response: Response): Promise<string[]> {
  const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();
  if (reader === undefined) throw new Error('no body');
  const chunks: string[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return chunks;
    chunks.push(value);
  }
}

describe('POST /v1/trip/present handler', () => {
  beforeAll(() => {
    stubInviteEnv();
    vi.stubEnv('WEB_ORIGIN', WEB_ORIGIN);
    vi.stubEnv('LLM_MODE', 'mock');
    vi.stubEnv('MODEL_FAST', 'fast');
    vi.stubEnv('MODEL_REASONING', 'reasoning');
    vi.stubEnv('MODEL_CRITIC', 'critic');
  });

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.mocked(console.error).mockRestore();
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('AC-PRESENT-01/02: 200 text/plain with CORS, many chunks, ending as a valid model', async () => {
    const { POST, flushes } = handler(COPY);
    const response = await POST(post(REQUEST));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
    const chunks = await readChunks(response);
    expect(chunks.length).toBeGreaterThan(3);
    const model = PresentationModel.parse(JSON.parse(chunks.join('')));
    expect(model.cards[0]).toMatchObject({
      recommendationId: 'rec-1',
      claims: REQUEST.recommendations[0]?.claims,
    });
    // Flushed once the stream ended, not before the response was returned.
    expect(flushes()).toBe(1);
  });

  it('AC-PRESENT-07: a refusal before any copy is a JSON 502 LLM_REFUSAL with CORS', async () => {
    const { POST, calls, flushes } = handler(mockRefusal());
    const response = await POST(post(REQUEST));
    expect(response.status).toBe(502);
    expect(response.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
    expect(await response.json()).toMatchObject({ error: { code: 'LLM_REFUSAL' } });
    expect(calls()).toBe(1);
    expect(flushes()).toBe(1);
  });

  it('AC-PRESENT-07: a stream with no output is retried once, then a JSON 502', async () => {
    const { POST, calls } = handler(mockRaw(''));
    const response = await POST(post(REQUEST));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: 'LLM_UPSTREAM_ERROR' } });
    expect(calls()).toBe(2);
  });

  it('AC-PRESENT-08: a failure after the stream started errors the response stream', async () => {
    const { POST, calls, flushes } = handler(mockStreamFailure(PresentationCopy, copyValue(), 80));
    const response = await POST(post(REQUEST));
    expect(response.status).toBe(200);
    await expect(readChunks(response)).rejects.toMatchObject({ midStream: true });
    expect(calls()).toBe(1);
    expect(flushes()).toBe(1);
    // One summary line, never the raw error (it can carry the model's output).
    expect(vi.mocked(console.error).mock.calls).toEqual([
      [
        expect.stringMatching(
          /^\[present\] the stream failed after it started: code=LLM_UPSTREAM_ERROR cause=\w+$/,
        ),
      ],
    ]);
  });

  it('AC-PRESENT-08: a client that goes away cancels quietly, flushing once', async () => {
    const { POST, flushes } = handler(COPY);
    const response = await POST(post(REQUEST));
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error('no body');
    await reader.read();
    await reader.cancel();
    // The cancel reaches the source through the encoder pipe, after this promise settles.
    await vi.waitFor(() => {
      expect(flushes()).toBe(1);
    });
    expect(console.error).not.toHaveBeenCalled();
  });

  it('AC-PRESENT-12: a body that breaks the contract is a 422 with no model call', async () => {
    const { POST, calls } = handler(COPY);
    const response = await POST(post({ profile: {}, recommendations: 'none' }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    expect(calls()).toBe(0);
  });

  it('AC-PRESENT-12: the access gate applies: no invite code is a 401', async () => {
    const { POST, calls } = handler(COPY);
    const response = await POST(post(REQUEST, { authorization: '' }));
    expect(response.status).toBe(401);
    expect(calls()).toBe(0);
  });

  it('AC-PRESENT-12: the preflight is answered with CORS', () => {
    const response = preflight();
    expect(response.status).toBeLessThan(300);
    expect(response.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
  });

  it('AC-PRESENT-13: no recommendations is a valid model with no model call', async () => {
    const { POST, calls } = handler(COPY);
    const response = await POST(post({ ...REQUEST, recommendations: [] }));
    expect(response.status).toBe(200);
    const model = PresentationModel.parse(JSON.parse((await readChunks(response)).join('')));
    expect(model.cards).toEqual([]);
    expect(calls()).toBe(0);
  });
});

function copyValue() {
  return {
    headline: 'Sun and surf in Maui for the two of you',
    intro: 'A warm week of beaches and calm water, close to great snorkeling.',
    cards: [{ title: 'Maui', blurb: 'Golden beaches and turtles.', highlights: ['Molokini'] }],
  };
}
