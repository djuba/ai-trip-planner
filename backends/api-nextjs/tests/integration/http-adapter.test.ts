// The adapter with real Request objects: body parsing, error envelopes and CORS (CLAUDE.md §6.3).
import {
  ErrorResponse,
  ExtractRequest,
  ExtractResponse,
  MAX_REQUEST_BODY_BYTES,
} from '@vp/domain-schema/wire';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, postRoute, preflight, route } from '../../src/http/route.ts';
import { LlmError } from '../../src/usecases/errors.ts';

const WEB_ORIGIN = 'https://web.example.test';
const URL_EXTRACT = 'http://api.test/v1/trip/extract';
const valid = { message: 'A week in Lisbon', referenceDate: '2026-11-05' };

type Body = string | Uint8Array<ArrayBuffer> | ReadableStream<Uint8Array>;

const post = (body: Body, headers?: Record<string, string>) =>
  new Request(URL_EXTRACT, {
    method: 'POST',
    body,
    duplex: 'half',
    headers: { 'content-type': 'application/json', ...headers },
  });

const streamOf = (...chunks: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });

/** A JSON document of exactly `bytes` bytes that passes ExtractRequest. */
const validBodyOfSize = (bytes: number) => {
  const skeleton = JSON.stringify({ ...valid, message: '' });
  return JSON.stringify({ ...valid, message: 'x'.repeat(bytes - skeleton.length) });
};

const errorOf = async (response: Response) => ErrorResponse.parse(await response.json()).error;

describe('http adapter', () => {
  const echo = vi.fn((body: ExtractRequest) => Response.json({ received: body.message }));
  const handler = postRoute(ExtractRequest, echo);

  beforeEach(() => {
    echo.mockClear();
    vi.stubEnv('WEB_ORIGIN', WEB_ORIGIN);
    vi.stubEnv('LLM_MODE', 'mock');
    vi.stubEnv('MODEL_FAST', 'fast');
    vi.stubEnv('MODEL_REASONING', 'reasoning');
    vi.stubEnv('MODEL_CRITIC', 'critic');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('passes a valid body to the handler, parsed', async () => {
    const response = await handler(post(JSON.stringify(valid)));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: valid.message });
  });

  it('AC-API-02: valid JSON that fails the schema is a 422 and the handler is not called', async () => {
    const response = await handler(post(JSON.stringify({ message: '' })));
    expect(response.status).toBe(422);
    const error = await errorOf(response);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.message).toContain('referenceDate');
    expect(echo).not.toHaveBeenCalled();
  });

  it.each<[string, () => Request]>([
    ['malformed JSON', () => post('{ "message": ')],
    ['an empty body', () => new Request(URL_EXTRACT, { method: 'POST' })],
    ['invalid UTF-8', () => post(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]))],
    ['JSON that is not an object', () => post('[]')],
  ])('AC-API-03: %s is a 422 VALIDATION_FAILED', async (_name, request) => {
    const response = await handler(request());
    expect(response.status).toBe(422);
    expect((await errorOf(response)).code).toBe('VALIDATION_FAILED');
    expect(echo).not.toHaveBeenCalled();
  });

  it('AC-API-04: a body over the cap with a content-length is a 413, unread', async () => {
    let read = false;
    const source = new ReadableStream<Uint8Array>(
      {
        pull() {
          read = true;
        },
      },
      { highWaterMark: 0 },
    );
    const response = await handler(
      post(source, { 'content-length': String(MAX_REQUEST_BODY_BYTES + 1) }),
    );
    expect(response.status).toBe(413);
    expect((await errorOf(response)).code).toBe('PAYLOAD_TOO_LARGE');
    expect(read).toBe(false);
    expect(echo).not.toHaveBeenCalled();
  });

  it('AC-API-04: a chunked body over the cap is a 413, and reading stops at the cap', async () => {
    const chunk = new Uint8Array(64 * 1024);
    let delivered = 0;
    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        delivered += chunk.byteLength;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = await handler(post(endless));
    expect(response.status).toBe(413);
    expect((await errorOf(response)).code).toBe('PAYLOAD_TOO_LARGE');
    expect(cancelled).toBe(true);
    expect(delivered).toBeLessThan(MAX_REQUEST_BODY_BYTES + 3 * chunk.byteLength);
    expect(echo).not.toHaveBeenCalled();
  });

  it('AC-API-04: a body exactly at the cap is accepted, across chunks', async () => {
    const bytes = new TextEncoder().encode(validBodyOfSize(MAX_REQUEST_BODY_BYTES));
    expect(bytes.byteLength).toBe(MAX_REQUEST_BODY_BYTES);
    const middle = bytes.byteLength >> 1;
    const response = await handler(post(streamOf(bytes.slice(0, middle), bytes.slice(middle))));
    expect(response.status).toBe(200);
  });

  it('AC-API-04: an unparseable content-length does not reject a small body', async () => {
    const response = await handler(post(JSON.stringify(valid), { 'content-length': 'nonsense' }));
    expect(response.status).toBe(200);
  });

  it.each<[number, () => Response]>([
    [200, () => Response.json({})],
    [
      502,
      () => {
        throw new LlmError('LLM_REFUSAL', 'refused');
      },
    ],
    [
      500,
      () => {
        throw new Error('bug');
      },
    ],
  ])('AC-API-08: a %i from a handler carries the CORS origin', async (status, handle) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await route(handle)(new Request(URL_EXTRACT));
    expect(response.status).toBe(status);
    expect(response.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
  });

  it.each<[number, Body]>([
    [422, '{'],
    [413, new Uint8Array(MAX_REQUEST_BODY_BYTES + 1)],
  ])('AC-API-08: a %i from body parsing carries the CORS origin', async (status, body) => {
    const response = await handler(post(body));
    expect(response.status).toBe(status);
    expect(response.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
  });

  it('AC-API-09: the preflight allows a JSON POST from the web origin', () => {
    const response = preflight();
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
    expect(response.headers.get('access-control-allow-headers')).toContain('content-type');
  });

  it('AC-API-11: a response that breaks the contract becomes a 500, not the bad body', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const bad = { status: 'nonsense', secret: 'off-contract' } as unknown as ExtractResponse;
    const response = await route(() => jsonResponse(ExtractResponse, bad))(
      new Request(URL_EXTRACT),
    );
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).not.toContain('off-contract');
    expect(ErrorResponse.parse(JSON.parse(body)).error.code).toBe('INTERNAL_ERROR');
    expect(log).toHaveBeenCalledOnce();
  });

  it('AC-API-11: jsonResponse sends a valid body as JSON with the given status', async () => {
    const value = { status: 'ready', profile: {} } as const;
    const response = jsonResponse(ExtractResponse, value, 201);
    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual(value);
  });

  it('AC-API-12: a streaming response stays unbuffered, keeps its headers and gains CORS', async () => {
    const encoder = new TextEncoder();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const source = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode('{"title":'));
        await gate; // Opens only after the first chunk is read, so buffering would deadlock.
        controller.enqueue(encoder.encode('"Lisbon"}'));
        controller.close();
      },
    });
    const response = await route(
      () => new Response(source, { headers: { 'content-type': 'text/plain; charset=utf-8' } }),
    )(new Request(URL_EXTRACT));

    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);

    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toBe('{"title":');
    release();
    expect(decoder.decode((await reader.read()).value)).toBe('"Lisbon"}');
    expect((await reader.read()).done).toBe(true);
  });
});
