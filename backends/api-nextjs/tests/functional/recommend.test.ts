// /v1/trip/recommend over real HTTP against the built server in replay mode (CLAUDE.md §6.3). The
// ready request is the integration replay one, so these calls replay the same cassettes.
import { RecommendResponse } from '@vp/domain-schema/wire';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CASSETTE_DIR, startApi, type RunningApi } from '../support/api-server.ts';
import { authHeaders } from '../support/invite.ts';
import { RECOMMEND_REQUESTS } from '../support/recommend-requests.ts';

const WEB_ORIGIN = 'http://localhost:3000';

const send = (baseUrl: string, body: unknown) =>
  fetch(`${baseUrl}/v1/trip/recommend`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: WEB_ORIGIN, ...authHeaders() },
    body: JSON.stringify(body),
  });

/** Every string in a value, joined: the prompt text of a recorded model request. */
function strings(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(strings).join('\n');
  if (typeof value === 'object' && value !== null)
    return Object.values(value).map(strings).join('\n');
  return '';
}

describe('POST /v1/trip/recommend over real HTTP', () => {
  let api: RunningApi;

  beforeAll(async () => {
    api = await startApi();
  });

  afterAll(async () => {
    await api?.stop();
  });

  it('AC-RECOMMEND-18: a ready profile gets schema-valid, critic-checked recommendations', async () => {
    const response = await send(api.baseUrl, RECOMMEND_REQUESTS.firstTry);
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
    const body = RecommendResponse.parse(await response.json());
    expect(body.recommendations.length).toBeGreaterThanOrEqual(1);
    expect(body.critique.pass).toBe(true);
  });

  it('AC-RECOMMEND-18: a profile that is not ready is a 422 VALIDATION_FAILED', async () => {
    const { profile, referenceDate } = RECOMMEND_REQUESTS.firstTry;
    const response = await send(api.baseUrl, {
      profile: { ...profile, people: [{ userType: 'child', age: 8 }] },
      referenceDate,
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('AC-GATE-01: no Authorization is a 401 UNAUTHORIZED over real HTTP', async () => {
    const response = await fetch(`${api.baseUrl}/v1/trip/recommend`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: WEB_ORIGIN },
      body: JSON.stringify(RECOMMEND_REQUESTS.firstTry),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
    expect(await response.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  it('AC-RECOMMEND-18: OPTIONS answers the preflight with CORS headers', async () => {
    const response = await fetch(`${api.baseUrl}/v1/trip/recommend`, {
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
});

describe('POST /v1/trip/recommend when the provider fails', () => {
  let api: RunningApi | undefined;
  let dir: string | undefined;

  afterAll(async () => {
    await api?.stop();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('AC-RECOMMEND-18: an upstream 500, twice, is a 502 LLM_UPSTREAM_ERROR', async () => {
    // The recorded first recommend call for the ready request, with its response swapped for a
    // provider error. The request, and so the key, is unchanged; nothing synthetic is committed.
    dir = await mkdtemp(join(tmpdir(), 'vp-recommend-502-'));
    let copied = 0;
    for (const file of await readdir(CASSETTE_DIR)) {
      const cassette = JSON.parse(await readFile(join(CASSETTE_DIR, file), 'utf8')) as {
        request: { body: unknown };
        response: unknown;
      };
      const text = strings(cassette.request.body);
      const firstRecommendCall =
        text.includes('You are a vacation planner.') &&
        text.includes('"region":"Hawaii"') &&
        text.includes('"age":40') &&
        !text.includes('previousRecommendations');
      if (!firstRecommendCall) continue;
      cassette.response = {
        status: 500,
        headers: { 'content-type': 'application/json' },
        body: { type: 'error', error: { type: 'api_error', message: 'Internal server error' } },
      };
      await writeFile(join(dir, file), JSON.stringify(cassette));
      copied += 1;
    }
    expect(copied, 'the recorded first recommend cassette').toBe(1);

    api = await startApi({ env: { LLM_CASSETTE_DIR: dir } });
    const response = await send(api.baseUrl, RECOMMEND_REQUESTS.firstTry);

    expect(response.status).toBe(502);
    expect(response.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
    expect(await response.json()).toMatchObject({ error: { code: 'LLM_UPSTREAM_ERROR' } });
  });
});
