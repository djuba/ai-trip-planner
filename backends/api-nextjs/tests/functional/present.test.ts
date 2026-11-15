// /v1/trip/present over real HTTP against the built server in replay mode (CLAUDE.md §6.3; WU-11
// plan D5). The happy request replays the same cassette as the integration and contract tests. The
// mid-stream failure uses a hand-built cassette in its own directory, since a provider error can't
// be recorded live.
import { PresentationModel } from '@vp/domain-schema/wire';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BACKEND_DIR, startApi, type RunningApi } from '../support/api-server.ts';
import { authHeaders } from '../support/invite.ts';
import { PRESENT_REQUESTS, writeFailingPresentCassette } from '../support/present-requests.ts';

const WEB_ORIGIN = 'http://localhost:3000';

const send = (baseUrl: string, body: unknown, headers: Record<string, string> = authHeaders()) =>
  fetch(`${baseUrl}/v1/trip/present`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: WEB_ORIGIN, ...headers },
    body: JSON.stringify(body),
  });

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

describe('POST /v1/trip/present over real HTTP', () => {
  let api: RunningApi;

  beforeAll(async () => {
    api = await startApi();
  });

  afterAll(async () => {
    await api?.stop();
  });

  it('AC-PRESENT-01/02: streams raw JSON in several chunks, ending as a valid PresentationModel', async () => {
    const response = await send(api.baseUrl, PRESENT_REQUESTS.contract);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
    const chunks = await readChunks(response);
    expect(chunks.length).toBeGreaterThan(1);
    const model = PresentationModel.parse(JSON.parse(chunks.join('')));
    expect(model.cards.map((c) => c.recommendationId)).toEqual(['rec-1']);
    expect(model.cards[0]?.claims).toEqual(PRESENT_REQUESTS.contract.recommendations[0]?.claims);
  });

  it('AC-PRESENT-12: a body that breaks the contract is a 422; no invite code is a 401', async () => {
    const invalid = await send(api.baseUrl, { profile: {}, recommendations: 'none' });
    expect(invalid.status).toBe(422);
    const unauthorized = await send(api.baseUrl, PRESENT_REQUESTS.contract, {});
    expect(unauthorized.status).toBe(401);
  });

  it('AC-PRESENT-13: no recommendations streams a code-written presentation', async () => {
    const response = await send(api.baseUrl, { ...PRESENT_REQUESTS.contract, recommendations: [] });
    expect(response.status).toBe(200);
    expect(PresentationModel.parse(await response.json()).cards).toEqual([]);
  });
});

describe('POST /v1/trip/present: a provider failure after the stream started', () => {
  let api: RunningApi;
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vp-present-fail-'));
    const routes: unknown = JSON.parse(
      await readFile(join(BACKEND_DIR, 'data', 'routes.json'), 'utf8'),
    );
    await writeFailingPresentCassette(dir, PRESENT_REQUESTS.contract, routes);
    api = await startApi({ env: { LLM_CASSETTE_DIR: dir } });
  });

  afterAll(async () => {
    await api?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it('AC-PRESENT-08: the client gets a 200, then a transport error, never a clean end', async () => {
    const response = await send(api.baseUrl, PRESENT_REQUESTS.contract);
    expect(response.status).toBe(200);
    const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();
    if (reader === undefined) throw new Error('no body');
    let received = '';
    const outcome = await (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return 'clean end';
        received += value;
      }
    })().catch((error: unknown) => error);

    // Chunks still queued when the stream errors are dropped, so with an instant replay the client
    // may get none; with a live model, earlier chunks have long gone out. Either way: no clean end.
    expect(() => {
      JSON.parse(received);
    }).toThrow();
    expect(outcome).not.toBe('clean end');
    expect(outcome).toBeInstanceOf(Error);
  });
});
