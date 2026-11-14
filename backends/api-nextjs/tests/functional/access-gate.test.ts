// The gate's counters over real HTTP against the built server. Next may load each route in its own
// module instance, so this proves one counter store serves every trip endpoint (WU-22 review #3).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApi, type RunningApi } from '../support/api-server.ts';
import { authHeaders } from '../support/invite.ts';

describe('the access gate over real HTTP', () => {
  let api: RunningApi;

  beforeAll(async () => {
    api = await startApi({ env: { RATE_LIMIT_PER_HOUR: '1' } });
  });

  afterAll(async () => {
    await api?.stop();
  });

  const send = (path: string, body: unknown) =>
    fetch(`${api.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });

  it('AC-GATE-07: a counted request on /extract fills the hourly window for /recommend', async () => {
    // An invalid body is a 422, but the gate has counted it first: it runs before the body is read.
    expect((await send('/v1/trip/extract', {})).status).toBe(422);

    const response = await send('/v1/trip/recommend', {
      profile: {},
      referenceDate: '2030-01-01',
    });
    expect(response.status).toBe(429);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(await response.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
  });
});
