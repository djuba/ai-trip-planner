import { ExtractResponse, PresentationModel, RecommendResponse } from '@vp/domain-schema/wire';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApi, type RunningApi } from '../support/api-server.ts';

const REFERENCE_DATE = '2030-01-01';

describe('trip stub routes over real HTTP', () => {
  let api: RunningApi;

  beforeAll(async () => {
    api = await startApi({ env: {} });
  });

  afterAll(async () => {
    await api?.stop();
  });

  const send = (path: string, body: unknown) =>
    fetch(`${api.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('POST /v1/trip/extract returns a schema-valid body', async () => {
    const response = await send('/v1/trip/extract', {
      message: 'beach week',
      referenceDate: REFERENCE_DATE,
    });
    expect(response.status).toBe(200);
    expect(ExtractResponse.safeParse(await response.json()).success).toBe(true);
  });

  it('POST /v1/trip/recommend returns a schema-valid body', async () => {
    const response = await send('/v1/trip/recommend', {
      profile: {},
      referenceDate: REFERENCE_DATE,
    });
    expect(response.status).toBe(200);
    expect(RecommendResponse.safeParse(await response.json()).success).toBe(true);
  });

  it('POST /v1/trip/present streams text that parses as PresentationModel', async () => {
    const response = await send('/v1/trip/present', { profile: {}, recommendations: [] });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(PresentationModel.safeParse(JSON.parse(await response.text())).success).toBe(true);
  });
});
