import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readdir } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CassetteMissError,
  cassetteKey,
  createCassetteFetch,
  type Cassette,
} from './cassette-fetch.ts';

const URL_MESSAGES = 'https://api.anthropic.com/v1/messages';
const BODY = JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 64, messages: [] });
const init = (body = BODY): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': 'sk-ant-SENTINEL' },
  body,
});

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vp-cassettes-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function readCassette(key: string): Promise<Cassette> {
  return JSON.parse(await readFile(join(dir, `${key}.json`), 'utf8')) as Cassette;
}

async function writeCassette(cassette: Cassette, key = cassetteKey(BODY)): Promise<void> {
  await writeFile(join(dir, `${key}.json`), JSON.stringify(cassette));
}

async function readAll(response: Response): Promise<string[]> {
  const chunks: string[] = [];
  const decoder = new TextDecoder();
  const reader = response.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return chunks;
    chunks.push(decoder.decode(value));
  }
}

/** Rejects if `promise` hasn't settled in time, so a buffering bug fails instead of hanging. */
function within<T>(promise: Promise<T>, what: string, ms = 2_000): Promise<T> {
  return Promise.race([
    promise,
    delay(ms).then(() => {
      throw new Error(`timed out waiting for ${what}`);
    }),
  ]);
}

const EVENT_1 = 'event: message_start\ndata: {"type":"message_start"}';
const EVENT_2 = 'event: content_block_delta\ndata: {"type":"content_block_delta"}';
const EVENT_3 = 'event: message_stop\ndata: {"type":"message_stop"}';

describe('cassette fetch: streaming', () => {
  it('AC-LLM-04: record hands back a stream before the upstream body ends, then writes it on flush', async () => {
    // The upstream holds its last event until the consumer has read the first. A recorder that
    // awaits the body before returning can never see the end, so it times out here.
    let releaseLast!: () => void;
    const lastHeld = new Promise<void>((resolve) => {
      releaseLast = resolve;
    });
    const encoder = new TextEncoder();
    const network: typeof fetch = () =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            async start(controller) {
              controller.enqueue(encoder.encode(`${EVENT_1}\n\n${EVENT_2}\n\n`));
              await lastHeld;
              controller.enqueue(encoder.encode(`${EVENT_3}\n\n`));
              controller.close();
            },
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } },
        ),
      );
    const recorder = createCassetteFetch({ mode: 'record', dir, network });

    const response = await within(recorder.fetch(URL_MESSAGES, init()), 'the recorded response');
    const reader = response.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    const first = await within(reader.read(), 'the first chunk');
    expect(new TextDecoder().decode(first.value)).toContain('message_start');

    releaseLast();
    for (;;) if ((await reader.read()).done) break;
    await within(recorder.flush(), 'flush');

    const cassette = await readCassette(cassetteKey(BODY));
    expect(cassette.response).toEqual({
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
      sse: [EVENT_1, EVENT_2, EVENT_3],
    });
  });

  it('AC-LLM-05: replaying an SSE cassette yields one chunk per event', async () => {
    await writeCassette({
      request: { method: 'POST', url: URL_MESSAGES, body: JSON.parse(BODY) },
      response: {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        sse: [EVENT_1, EVENT_2, EVENT_3],
      },
    });
    const replay = createCassetteFetch({ mode: 'replay', dir });

    const response = await replay.fetch(URL_MESSAGES, init());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(await readAll(response)).toEqual([`${EVENT_1}\n\n`, `${EVENT_2}\n\n`, `${EVENT_3}\n\n`]);
  });

  it('AC-LLM-05: replaying a JSON cassette yields its status, allowlisted headers and body', async () => {
    const body = { id: 'msg_1', content: [{ type: 'text', text: '{}' }] };
    await writeCassette({
      request: { method: 'POST', url: URL_MESSAGES, body: JSON.parse(BODY) },
      response: {
        status: 200,
        headers: { 'content-type': 'application/json', 'request-id': 'req_1' },
        body,
      },
    });
    const replay = createCassetteFetch({ mode: 'replay', dir });

    const response = await replay.fetch(URL_MESSAGES, init());

    expect(response.status).toBe(200);
    expect(response.headers.get('request-id')).toBe('req_1');
    expect(await response.json()).toEqual(body);
  });
});

const jsonNetwork =
  (text: string, status = 200, headers: Record<string, string> = {}): typeof fetch =>
  () =>
    Promise.resolve(
      new Response(text, { status, headers: { 'content-type': 'application/json', ...headers } }),
    );

describe('cassette fetch: keys', () => {
  it('AC-LLM-01: the same body gives the same 64-hex key and any change gives a different one', () => {
    const key = cassetteKey(BODY);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(cassetteKey(BODY)).toBe(key);
    expect(cassetteKey(`${BODY} `)).not.toBe(key);
    expect(cassetteKey(BODY.replace('64', '65'))).not.toBe(key);
  });

  it('AC-LLM-01: request headers and user agent do not change the file, which is named <key>.json', async () => {
    const recorder = createCassetteFetch({ mode: 'record', dir, network: jsonNetwork('{}') });
    await recorder.fetch(URL_MESSAGES, init());
    await recorder.fetch(URL_MESSAGES, {
      ...init(),
      headers: { 'user-agent': 'ai-sdk/other', 'x-extra': '1' },
    });
    await recorder.flush();

    expect(await readdir(dir)).toEqual([`${cassetteKey(BODY)}.json`]);
  });
});

describe('cassette fetch: recording', () => {
  it('AC-LLM-02: writes no request headers, only allowlisted response headers, and no secrets', async () => {
    const network = jsonNetwork('{"id":"msg_1"}', 200, {
      'anthropic-organization-id': 'org-secret',
      'anthropic-workspace-id': 'wrkspc-secret',
      'request-id': 'req_9',
      'anthropic-ratelimit-requests-remaining': '99',
    });
    const recorder = createCassetteFetch({ mode: 'record', dir, network });

    await recorder.fetch(URL_MESSAGES, init());
    await recorder.flush();

    const key = cassetteKey(BODY);
    const cassette = await readCassette(key);
    expect(cassette.request).toEqual({
      method: 'POST',
      url: URL_MESSAGES,
      body: JSON.parse(BODY) as unknown,
    });
    expect(cassette.request).not.toHaveProperty('headers');
    expect(cassette.response.headers).toEqual({
      'content-type': 'application/json',
      'request-id': 'req_9',
    });
    const raw = await readFile(join(dir, `${key}.json`), 'utf8');
    expect(raw).not.toContain('sk-ant-SENTINEL');
    expect(raw).not.toContain('anthropic-organization-id');
    expect(raw).not.toContain('anthropic-workspace-id');
  });

  it('AC-LLM-04: a non-2xx upstream response is returned unchanged and nothing is written', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const recorder = createCassetteFetch({
      mode: 'record',
      dir,
      network: jsonNetwork('{"error":"overloaded"}', 529),
    });

    const response = await recorder.fetch(URL_MESSAGES, init());
    await recorder.flush();

    expect(response.status).toBe(529);
    expect(await response.json()).toEqual({ error: 'overloaded' });
    expect(await readdir(dir)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('529'));
    warn.mockRestore();
  });

  it('AC-LLM-04: two 2xx exchanges with the same body leave one file holding the last response', async () => {
    let n = 0;
    const network: typeof fetch = () => Promise.resolve(Response.json({ n: ++n }, { status: 200 }));
    const recorder = createCassetteFetch({ mode: 'record', dir, network });

    await recorder.fetch(URL_MESSAGES, init());
    await recorder.flush();
    await recorder.fetch(URL_MESSAGES, init());
    await recorder.flush();

    expect(await readdir(dir)).toHaveLength(1);
    const cassette = await readCassette(cassetteKey(BODY));
    expect(cassette.response).toMatchObject({ body: { n: 2 } });
  });

  it('AC-LLM-04: a non-string request body throws a TypeError', async () => {
    const recorder = createCassetteFetch({ mode: 'record', dir, network: jsonNetwork('{}') });
    const replay = createCassetteFetch({ mode: 'replay', dir });

    await expect(recorder.fetch(URL_MESSAGES, { method: 'POST' })).rejects.toBeInstanceOf(
      TypeError,
    );
    await expect(
      replay.fetch(URL_MESSAGES, { method: 'POST', body: new Uint8Array([1]) }),
    ).rejects.toBeInstanceOf(TypeError);
  });
});

describe('cassette fetch: replay misses', () => {
  it('AC-LLM-03: a miss rejects with the key, the model and the re-record hint, never touching the network', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const replay = createCassetteFetch({ mode: 'replay', dir });

    const error = await replay.fetch(URL_MESSAGES, init()).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(CassetteMissError);
    const message = (error as CassetteMissError).message;
    expect(message).toContain(cassetteKey(BODY));
    expect(message).toContain('claude-haiku-5-5');
    expect(message).toContain('re-record with `LLM_MODE=record`');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('AC-LLM-03: a malformed cassette file rejects with a re-record hint', async () => {
    await writeFile(join(dir, `${cassetteKey(BODY)}.json`), '{"nope":true}');
    const replay = createCassetteFetch({ mode: 'replay', dir });

    await expect(replay.fetch(URL_MESSAGES, init())).rejects.toThrow(/re-record/);
  });
});
