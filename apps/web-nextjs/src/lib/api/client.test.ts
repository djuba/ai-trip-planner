import { describe, expect, it, vi } from 'vitest';
import {
  errorBody,
  extractRequest,
  healthResponse,
  presentRequest,
  readyResponse,
  recommendRequest,
  recommendResponse,
} from '../../../tests/support/fixtures.ts';
import { createApiClient } from './client.ts';

const BASE = 'http://127.0.0.1:4000';

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function setup(respond: () => Response | Promise<Response>, code?: string) {
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(respond()));
  const client = createApiClient({
    baseUrl: `${BASE}/`,
    getInviteCode: () => code,
    fetch: fetchMock,
  });
  return { client, fetchMock };
}

function lastCall(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
  const [url, init] = fetchMock.mock.calls[0] ?? [];
  return { url: url as string, init: init ?? {}, headers: new Headers(init?.headers) };
}

describe('createApiClient requests', () => {
  it('AC-WEB-02: health is a GET to /v1/health without auth, even with a code', async () => {
    const { client, fetchMock } = setup(() => json(healthResponse()), 'abc');
    await client.health();
    const call = lastCall(fetchMock);
    expect(call.url).toBe(`${BASE}/v1/health`);
    expect(call.init.method).toBe('GET');
    expect(call.headers.has('authorization')).toBe(false);
  });

  it('AC-WEB-02/03: extract POSTs JSON to /v1/trip/extract with the bearer code', async () => {
    const { client, fetchMock } = setup(() => json(readyResponse()), 'my-code');
    const body = extractRequest();
    await client.extract(body);
    const call = lastCall(fetchMock);
    expect(call.url).toBe(`${BASE}/v1/trip/extract`);
    expect(call.init.method).toBe('POST');
    expect(call.headers.get('content-type')).toBe('application/json');
    expect(call.headers.get('authorization')).toBe('Bearer my-code');
    expect(JSON.parse(call.init.body as string)).toEqual(body);
  });

  it.each([undefined, '', '   '])(
    'AC-WEB-03: invite code %j sends no authorization',
    async (code) => {
      const { client, fetchMock } = setup(() => json(readyResponse()), code);
      await client.extract(extractRequest());
      expect(lastCall(fetchMock).headers.has('authorization')).toBe(false);
    },
  );

  it('AC-WEB-02: recommend and present use their paths', async () => {
    const rec = setup(() => json(recommendResponse()), 'c');
    await rec.client.recommend(recommendRequest());
    expect(lastCall(rec.fetchMock).url).toBe(`${BASE}/v1/trip/recommend`);

    const pres = setup(() => new Response('{}', { status: 200 }), 'c');
    await pres.client.present(presentRequest());
    const call = lastCall(pres.fetchMock);
    expect(call.url).toBe(`${BASE}/v1/trip/present`);
    expect(call.headers.get('authorization')).toBe('Bearer c');
  });

  it('AC-WEB-02: defaults to globalThis.fetch looked up at request time', async () => {
    const original = globalThis.fetch;
    const spy = vi.fn<typeof fetch>(() => Promise.resolve(json(healthResponse())));
    globalThis.fetch = spy;
    try {
      const client = createApiClient({ baseUrl: BASE, getInviteCode: () => undefined });
      const result = await client.health();
      expect(result.ok).toBe(true);
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = original;
    }
  });

  it('AC-WEB-02: passes the abort signal to fetch', async () => {
    const { client, fetchMock } = setup(() => json(healthResponse()));
    const controller = new AbortController();
    await client.health({ signal: controller.signal });
    expect(lastCall(fetchMock).init.signal).toBe(controller.signal);
  });
});

describe('createApiClient responses', () => {
  it('AC-WEB-04: a valid 2xx body is returned parsed', async () => {
    const health = await setup(() => json(healthResponse())).client.health();
    expect(health).toEqual({ ok: true, data: healthResponse() });
    const extract = await setup(() => json(readyResponse())).client.extract(extractRequest());
    expect(extract).toEqual({ ok: true, data: readyResponse() });
    const rec = await setup(() => json(recommendResponse())).client.recommend(recommendRequest());
    expect(rec).toEqual({ ok: true, data: recommendResponse() });
  });

  it('AC-WEB-04: a schema-invalid 2xx body is a contract error', async () => {
    const result = await setup(() => json({ status: 'maybe' })).client.extract(extractRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('contract');
    }
    const root = await setup(() => json(5)).client.health();
    expect(root).toMatchObject({ ok: false, error: { kind: 'contract' } });
  });

  it('AC-WEB-04: a non-JSON 2xx body is a contract error', async () => {
    const result = await setup(() => new Response('<html>', { status: 200 })).client.health();
    expect(result).toEqual({
      ok: false,
      error: { kind: 'contract', detail: 'response body is not JSON' },
    });
  });

  it('AC-WEB-05: 401 is unauthorized', async () => {
    const { client } = setup(() => json(errorBody('UNAUTHORIZED', 'no'), { status: 401 }));
    expect(await client.extract(extractRequest())).toEqual({
      ok: false,
      error: { kind: 'unauthorized' },
    });
  });

  it('AC-WEB-06: 429 reads Retry-After from the response headers', async () => {
    const { client } = setup(() =>
      json(errorBody('RATE_LIMITED', 'slow'), { status: 429, headers: { 'retry-after': '120' } }),
    );
    expect(await client.extract(extractRequest())).toEqual({
      ok: false,
      error: { kind: 'rate_limited', retryAfterSeconds: 120 },
    });
  });

  it('AC-WEB-07: 422 is invalid_request with the message', async () => {
    const { client } = setup(() => json(errorBody('VALIDATION_FAILED', 'bad'), { status: 422 }));
    expect(await client.recommend(recommendRequest())).toEqual({
      ok: false,
      error: { kind: 'invalid_request', message: 'bad' },
    });
  });

  it('AC-WEB-08: 502 LLM_REFUSAL is an upstream refusal', async () => {
    const { client } = setup(() => json(errorBody('LLM_REFUSAL', 'no'), { status: 502 }));
    expect(await client.extract(extractRequest())).toEqual({
      ok: false,
      error: { kind: 'upstream', refusal: true },
    });
  });

  it('AC-WEB-08: a 500 with a non-JSON body is a server error', async () => {
    const { client } = setup(() => new Response('oops', { status: 500 }));
    expect(await client.health()).toEqual({ ok: false, error: { kind: 'server', status: 500 } });
  });

  it('AC-WEB-10: present 200 returns the unread body stream', async () => {
    const { client } = setup(() => new Response('{"partial":', { status: 200 }), 'c');
    const result = await client.present(presentRequest());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBeInstanceOf(ReadableStream);
      expect(result.data.locked).toBe(false);
      expect(await new Response(result.data).text()).toBe('{"partial":');
    }
  });

  it('AC-WEB-10: present 200 with no body is a contract error', async () => {
    const { client } = setup(() => new Response(null, { status: 200 }), 'c');
    expect(await client.present(presentRequest())).toMatchObject({
      ok: false,
      error: { kind: 'contract' },
    });
  });

  it('AC-WEB-10: present maps error statuses', async () => {
    const { client } = setup(
      () => json(errorBody('LLM_UPSTREAM_ERROR', 'x'), { status: 502 }),
      'c',
    );
    expect(await client.present(presentRequest())).toEqual({
      ok: false,
      error: { kind: 'upstream', refusal: false },
    });
  });
});

describe('createApiClient failures', () => {
  it('AC-WEB-09: a rejected fetch is a network error', async () => {
    const { client } = setup(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await client.health()).toEqual({ ok: false, error: { kind: 'network' } });
  });

  it('AC-WEB-09: an abort before the response is aborted, not network', async () => {
    const controller = new AbortController();
    const { client } = setup(() => {
      controller.abort();
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    });
    expect(await client.health({ signal: controller.signal })).toEqual({
      ok: false,
      error: { kind: 'aborted' },
    });
  });

  it('AC-WEB-09: an AbortError without a signal is aborted', async () => {
    const { client } = setup(() => Promise.reject(new DOMException('x', 'AbortError')));
    expect(await client.health()).toEqual({ ok: false, error: { kind: 'aborted' } });
  });

  it('AC-WEB-09: an abort while reading an error body is aborted', async () => {
    const controller = new AbortController();
    const res = new Response('x', { status: 500 });
    vi.spyOn(res, 'text').mockImplementation(() => {
      controller.abort();
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    });
    const { client } = setup(() => res);
    expect(await client.health({ signal: controller.signal })).toEqual({
      ok: false,
      error: { kind: 'aborted' },
    });
  });

  it('AC-WEB-09: a failed error-body read otherwise still maps by status', async () => {
    const res = new Response('x', { status: 500 });
    vi.spyOn(res, 'text').mockRejectedValue(new TypeError('boom'));
    const { client } = setup(() => res);
    expect(await client.health()).toEqual({ ok: false, error: { kind: 'server', status: 500 } });
  });

  it('AC-WEB-09: an abort while reading a 2xx body is aborted', async () => {
    const controller = new AbortController();
    const res = new Response('{}', { status: 200 });
    vi.spyOn(res, 'json').mockImplementation(() => {
      controller.abort();
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    });
    const { client } = setup(() => res);
    expect(await client.health({ signal: controller.signal })).toEqual({
      ok: false,
      error: { kind: 'aborted' },
    });
  });
});
