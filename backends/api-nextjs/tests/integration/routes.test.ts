// The real route modules, called directly with real Request objects (CLAUDE.md §6.3).
import { CONTRACT_VERSION, HealthResponse } from '@vp/domain-schema/wire';
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GET } from '../../src/app/v1/health/route.ts';

const WEB_ORIGIN = 'https://web.example.test';
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
    expect(HealthResponse.parse(await response.json())).toEqual({
      status: 'ok',
      backend: 'nextjs',
      contractVersion: CONTRACT_VERSION,
    });
  });

  it('finds the route files it is meant to check', () => {
    expect(routeFiles).toContain('v1/health/route.ts');
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
