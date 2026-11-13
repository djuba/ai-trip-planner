// /v1/trip/extract over real HTTP against the built server in replay mode (CLAUDE.md §6.3). The
// requests are the integration replay ones, so these calls replay the same cassettes.
import { ExtractResponse } from '@vp/domain-schema/wire';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CASSETTE_DIR, startApi, type RunningApi } from '../support/api-server.ts';
import { EXTRACT_REQUESTS } from '../support/extract-requests.ts';

const WEB_ORIGIN = 'http://localhost:3000';

const send = (baseUrl: string, body: unknown) =>
  fetch(`${baseUrl}/v1/trip/extract`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: WEB_ORIGIN },
    body: JSON.stringify(body),
  });

describe('POST /v1/trip/extract over real HTTP', () => {
  let api: RunningApi;

  beforeAll(async () => {
    api = await startApi();
  });

  afterAll(async () => {
    await api?.stop();
  });

  it('AC-EXTRACT-15: a vague request is a schema-valid needs_clarification', async () => {
    const response = await send(api.baseUrl, EXTRACT_REQUESTS.vague);
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
    expect(ExtractResponse.parse(await response.json())).toMatchObject({
      status: 'needs_clarification',
    });
  });

  it('AC-EXTRACT-15: a complete request is a schema-valid ready', async () => {
    const response = await send(api.baseUrl, EXTRACT_REQUESTS.complete);
    expect(response.status).toBe(200);
    expect(ExtractResponse.parse(await response.json())).toMatchObject({ status: 'ready' });
  });

  it('AC-EXTRACT-15: OPTIONS answers the preflight with CORS headers', async () => {
    const response = await fetch(`${api.baseUrl}/v1/trip/extract`, {
      method: 'OPTIONS',
      headers: {
        origin: WEB_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('AC-EXTRACT-15: a schema-invalid body is a 422 VALIDATION_FAILED', async () => {
    const response = await send(api.baseUrl, { message: '', referenceDate: '2030-01-15' });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });
});

describe('POST /v1/trip/extract when the provider fails', () => {
  let api: RunningApi | undefined;
  let dir: string | undefined;

  afterAll(async () => {
    await api?.stop();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('AC-EXTRACT-15: an upstream 500, twice, is a 502 LLM_UPSTREAM_ERROR', async () => {
    // The recorded extraction call for the vague request, with its response swapped for a provider
    // error. The request, and so the key, is unchanged; nothing synthetic is committed.
    dir = await mkdtemp(join(tmpdir(), 'vp-extract-502-'));
    let copied = 0;
    for (const file of await readdir(CASSETTE_DIR)) {
      const cassette = JSON.parse(await readFile(join(CASSETTE_DIR, file), 'utf8')) as {
        request: { body: unknown };
        response: unknown;
      };
      const body = JSON.stringify(cassette.request.body);
      if (!body.includes('Somewhere warm, maybe.') || !body.includes('currentProfile')) continue;
      cassette.response = {
        status: 500,
        headers: { 'content-type': 'application/json' },
        body: { type: 'error', error: { type: 'api_error', message: 'Internal server error' } },
      };
      await writeFile(join(dir, file), JSON.stringify(cassette));
      copied += 1;
    }
    expect(copied, 'the recorded vague extraction cassette').toBe(1);

    api = await startApi({ env: { LLM_CASSETTE_DIR: dir } });
    const response = await send(api.baseUrl, EXTRACT_REQUESTS.vague);

    expect(response.status).toBe(502);
    expect(response.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
    expect(await response.json()).toMatchObject({ error: { code: 'LLM_UPSTREAM_ERROR' } });
  });
});
