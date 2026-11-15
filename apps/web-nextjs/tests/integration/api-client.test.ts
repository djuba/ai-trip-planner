import { http, HttpResponse, delay } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApiClient } from '../../src/lib/api/index.ts';
import {
  errorBody,
  extractRequest,
  healthResponse,
  presentRequest,
  readyResponse,
  recommendRequest,
  recommendResponse,
} from '../support/fixtures.ts';

const BASE = 'http://127.0.0.1:4999';
const CODE = 'invite-code-1';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function clientWith(code: string | undefined = CODE) {
  return createApiClient({ baseUrl: BASE, getInviteCode: () => code });
}

interface Seen {
  url: string;
  method: string;
  contentType: string | null;
  authorization: string | null;
  body: unknown;
}

async function capture(request: Request): Promise<Seen> {
  const text = await request.text();
  return {
    url: new URL(request.url).pathname,
    method: request.method,
    contentType: request.headers.get('content-type'),
    authorization: request.headers.get('authorization'),
    body: text === '' ? undefined : JSON.parse(text),
  };
}

describe('api client over HTTP: requests', () => {
  it('AC-WEB-02: health is a GET to /v1/health and never carries authorization', async () => {
    let seen: Seen | undefined;
    server.use(
      http.get(`${BASE}/v1/health`, async ({ request }) => {
        seen = await capture(request);
        return HttpResponse.json(healthResponse());
      }),
    );
    const result = await clientWith().health();
    expect(result).toEqual({ ok: true, data: healthResponse() });
    expect(seen).toMatchObject({ url: '/v1/health', method: 'GET', authorization: null });
  });

  it('AC-WEB-02/03: extract POSTs the JSON body with the bearer code', async () => {
    let seen: Seen | undefined;
    server.use(
      http.post(`${BASE}/v1/trip/extract`, async ({ request }) => {
        seen = await capture(request);
        return HttpResponse.json(readyResponse());
      }),
    );
    const body = extractRequest();
    const result = await clientWith().extract(body);
    expect(result).toEqual({ ok: true, data: readyResponse() });
    expect(seen).toEqual({
      url: '/v1/trip/extract',
      method: 'POST',
      contentType: 'application/json',
      authorization: `Bearer ${CODE}`,
      body,
    });
  });

  it('AC-WEB-02/03: recommend POSTs the JSON body with the bearer code', async () => {
    let seen: Seen | undefined;
    server.use(
      http.post(`${BASE}/v1/trip/recommend`, async ({ request }) => {
        seen = await capture(request);
        return HttpResponse.json(recommendResponse());
      }),
    );
    const body = recommendRequest();
    const result = await clientWith().recommend(body);
    expect(result).toEqual({ ok: true, data: recommendResponse() });
    expect(seen).toEqual({
      url: '/v1/trip/recommend',
      method: 'POST',
      contentType: 'application/json',
      authorization: `Bearer ${CODE}`,
      body,
    });
  });

  it('AC-WEB-02/03: present POSTs the JSON body with the bearer code', async () => {
    let seen: Seen | undefined;
    server.use(
      http.post(`${BASE}/v1/trip/present`, async ({ request }) => {
        seen = await capture(request);
        return new HttpResponse('{}', { headers: { 'content-type': 'text/plain' } });
      }),
    );
    const body = presentRequest();
    const result = await clientWith().present(body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      await new Response(result.data).text();
    }
    expect(seen).toEqual({
      url: '/v1/trip/present',
      method: 'POST',
      contentType: 'application/json',
      authorization: `Bearer ${CODE}`,
      body,
    });
  });

  it('AC-WEB-03: no authorization header is sent when there is no invite code', async () => {
    let seen: Seen | undefined;
    server.use(
      http.post(`${BASE}/v1/trip/extract`, async ({ request }) => {
        seen = await capture(request);
        return HttpResponse.json(readyResponse());
      }),
    );
    await createApiClient({ baseUrl: BASE, getInviteCode: () => undefined }).extract(
      extractRequest(),
    );
    expect(seen?.authorization).toBeNull();
  });
});

describe('api client over HTTP: errors', () => {
  it('AC-WEB-05: a 401 is unauthorized', async () => {
    server.use(
      http.post(`${BASE}/v1/trip/extract`, () =>
        HttpResponse.json(errorBody('UNAUTHORIZED', 'no'), {
          status: 401,
          headers: { 'www-authenticate': 'Bearer' },
        }),
      ),
    );
    expect(await clientWith().extract(extractRequest())).toEqual({
      ok: false,
      error: { kind: 'unauthorized' },
    });
  });

  it('AC-WEB-06: a 429 RATE_LIMITED carries Retry-After seconds', async () => {
    server.use(
      http.post(`${BASE}/v1/trip/recommend`, () =>
        HttpResponse.json(errorBody('RATE_LIMITED', 'slow down'), {
          status: 429,
          headers: { 'retry-after': '120' },
        }),
      ),
    );
    expect(await clientWith().recommend(recommendRequest())).toEqual({
      ok: false,
      error: { kind: 'rate_limited', retryAfterSeconds: 120 },
    });
  });

  it('AC-WEB-06: a 429 QUOTA_EXHAUSTED is quota_exhausted', async () => {
    server.use(
      http.post(`${BASE}/v1/trip/recommend`, () =>
        HttpResponse.json(errorBody('QUOTA_EXHAUSTED', 'spent'), { status: 429 }),
      ),
    );
    expect(await clientWith().recommend(recommendRequest())).toMatchObject({
      ok: false,
      error: { kind: 'quota_exhausted' },
    });
  });

  it('AC-WEB-09: a network error is network', async () => {
    server.use(http.get(`${BASE}/v1/health`, () => HttpResponse.error()));
    expect(await clientWith().health()).toEqual({ ok: false, error: { kind: 'network' } });
  });

  it('AC-WEB-09: aborting mid-request is aborted, not network', async () => {
    let started!: () => void;
    const reachedHandler = new Promise<void>((resolve) => (started = resolve));
    server.use(
      http.post(`${BASE}/v1/trip/extract`, async () => {
        started();
        await delay(5000);
        return HttpResponse.json(readyResponse());
      }),
    );
    const controller = new AbortController();
    const pending = clientWith().extract(extractRequest(), { signal: controller.signal });
    await reachedHandler;
    controller.abort();
    expect(await pending).toEqual({ ok: false, error: { kind: 'aborted' } });
  });
});

describe('api client over HTTP: present stream', () => {
  it('AC-WEB-10: a 200 returns a stream carrying everything the server streamed', async () => {
    const encoder = new TextEncoder();
    const chunks = ['{"headline":"Ma', 'ui in Feb', 'ruary"}'];
    server.use(
      http.post(
        `${BASE}/v1/trip/present`,
        () =>
          new HttpResponse(
            new ReadableStream<Uint8Array>({
              async start(controller) {
                for (const chunk of chunks) {
                  controller.enqueue(encoder.encode(chunk));
                  await delay(10);
                }
                controller.close();
              },
            }),
            { headers: { 'content-type': 'text/plain; charset=utf-8' } },
          ),
      ),
    );
    const result = await clientWith().present(presentRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const decoder = new TextDecoder();
    let text = '';
    let reads = 0;
    const reader = result.data.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      reads += 1;
      text += decoder.decode(value, { stream: true });
    }
    expect(text).toBe(chunks.join(''));
    expect(reads).toBeGreaterThanOrEqual(2);
  });

  it('AC-WEB-10: a 502 LLM_UPSTREAM_ERROR is upstream', async () => {
    server.use(
      http.post(`${BASE}/v1/trip/present`, () =>
        HttpResponse.json(errorBody('LLM_UPSTREAM_ERROR', 'down'), { status: 502 }),
      ),
    );
    expect(await clientWith().present(presentRequest())).toEqual({
      ok: false,
      error: { kind: 'upstream', refusal: false },
    });
  });
});
