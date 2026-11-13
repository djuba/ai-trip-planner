// The real route modules, called directly with real Request objects (CLAUDE.md §6.3).
import {
  CONTRACT_VERSION,
  HealthResponse,
  PresentationModel,
  RecommendResponse,
} from '@vp/domain-schema/wire';
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GET } from '../../src/app/v1/health/route.ts';
import { POST as extract } from '../../src/app/v1/trip/extract/route.ts';
import { POST as present } from '../../src/app/v1/trip/present/route.ts';
import { POST as recommend } from '../../src/app/v1/trip/recommend/route.ts';

const WEB_ORIGIN = 'https://web.example.test';
const REFERENCE_DATE = '2030-01-01';

const post = (path: string, body: unknown) =>
  new Request(`http://api.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const APP_DIR = fileURLToPath(new URL('../../src/app/', import.meta.url));

const routeFiles = readdirSync(APP_DIR, { recursive: true, encoding: 'utf8' })
  .map((file) => file.replaceAll('\\', '/'))
  .filter((file) => file.endsWith('/route.ts'));

describe('routes', () => {
  beforeAll(() => {
    vi.stubEnv('WEB_ORIGIN', WEB_ORIGIN);
    vi.stubEnv('LLM_MODE', 'mock');
    vi.stubEnv('MODEL_FAST', 'fast');
    vi.stubEnv('MODEL_REASONING', 'reasoning');
    vi.stubEnv('MODEL_CRITIC', 'critic');
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('GET /v1/health returns the contract health body with CORS', async () => {
    const response = await GET(new Request('http://api.test/v1/health'));
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
    // Compare the raw body: parse() strips unknown keys, so it would hide a stray field.
    const body: unknown = await response.json();
    expect(body).toEqual({ status: 'ok', contractVersion: CONTRACT_VERSION });
    expect(HealthResponse.safeParse(body).success).toBe(true);
  });

  it('POST /v1/trip/recommend stub returns a schema-valid body', async () => {
    const response = await recommend(
      post('/v1/trip/recommend', { profile: {}, referenceDate: REFERENCE_DATE }),
    );
    expect(response.status).toBe(200);
    expect(RecommendResponse.safeParse(await response.json()).success).toBe(true);
  });

  it('POST /v1/trip/present stub streams text/plain in several chunks that parse as PresentationModel', async () => {
    const response = await present(post('/v1/trip/present', { profile: {}, recommendations: [] }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let chunks = 0;
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks += 1;
      text += decoder.decode(value, { stream: true });
    }
    expect(chunks).toBeGreaterThan(1);
    expect(PresentationModel.safeParse(JSON.parse(text)).success).toBe(true);
  });

  it.each([
    ['extract', extract, { message: '', referenceDate: REFERENCE_DATE }],
    ['recommend', recommend, { profile: {} }],
    ['present', present, { profile: {} }],
  ])(
    'POST /v1/trip/%s rejects a schema-invalid body with 422 VALIDATION_FAILED',
    async (name, handler, body) => {
      const response = await handler(post(`/v1/trip/${name}`, body));
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    },
  );

  it('finds the route files it is meant to check', () => {
    expect(routeFiles).toContain('v1/health/route.ts');
    expect(routeFiles).toContain('v1/trip/present/route.ts');
  });

  it.each(routeFiles)('AC-API-10: %s exports a working preflight', async (file) => {
    const module = (await import(pathToFileURL(`${APP_DIR}${file}`).href)) as {
      OPTIONS?: () => Response;
    };
    expect(module.OPTIONS, `${file} must export OPTIONS = preflight`).toBeTypeOf('function');
    const response = module.OPTIONS?.();
    expect(response?.status).toBe(204);
    expect(response?.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
    expect(response?.headers.get('access-control-allow-methods')).toContain('POST');
  });
});
