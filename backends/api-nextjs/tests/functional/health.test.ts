import { CONTRACT_VERSION, HealthResponse } from '@vp/domain-schema/wire';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApi, type RunningApi } from '../support/api-server.ts';

const WEB_ORIGIN = 'https://web.functional.test:8443';

describe('GET /v1/health over real HTTP', () => {
  let api: RunningApi;

  beforeAll(async () => {
    api = await startApi({ env: { WEB_ORIGIN } });
  });

  afterAll(async () => {
    await api?.stop();
  });

  it('AC-API-01: returns 200 with the contract health body', async () => {
    const response = await fetch(`${api.baseUrl}/v1/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(HealthResponse.parse(await response.json())).toEqual({
      status: 'ok',
      backend: 'nextjs',
      contractVersion: CONTRACT_VERSION,
    });
  });

  it('AC-API-19: reflects the WEB_ORIGIN set at runtime, not at build time', async () => {
    const response = await fetch(`${api.baseUrl}/v1/health`);
    expect(response.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
  });

  it('AC-API-09: answers a preflight through the real server', async () => {
    const response = await fetch(`${api.baseUrl}/v1/health`, {
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
    expect(response.headers.get('access-control-allow-headers')).toContain('content-type');
  });
});
