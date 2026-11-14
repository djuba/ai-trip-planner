// The access gate through the real route modules and the adapter (WU-22). Limits and the clock are
// injected through `route(handler, { gate })`; the unit tests of src/http/* are separate.
import { ErrorResponse } from '@vp/domain-schema/wire';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { POST as extract } from '../../src/app/v1/trip/extract/route.ts';
import { POST as present } from '../../src/app/v1/trip/present/route.ts';
import { POST as recommend } from '../../src/app/v1/trip/recommend/route.ts';
import { TEST_INVITE_CODE_HASH, type AccessConfig } from '../../src/http/access-config.ts';
import { createGate } from '../../src/http/gate.ts';
import { hashInviteCode } from '../../src/http/invite-code.ts';
import { route } from '../../src/http/route.ts';
import { MemoryUsageStore } from '../../src/http/usage-store.ts';
import { TEST_INVITE_CODE, TEST_INVITE_LABEL, authHeaders } from '../support/invite.ts';
import { stubInviteEnv } from '../support/stub-invite-env.ts';

const WEB_ORIGIN = 'https://web.example.test';
const REFERENCE_DATE = '2030-01-01';
const REVOKED_CODE = 'revoked-invite-code';

const SRC_DIR = fileURLToPath(new URL('../../src/', import.meta.url));
const APP_DIR = `${SRC_DIR}app/`;

const list = (dir: string) =>
  readdirSync(dir, { recursive: true, encoding: 'utf8' }).map((file) => file.replaceAll('\\', '/'));
const routeFiles = list(APP_DIR).filter((file) => file.endsWith('/route.ts'));

const TRIP = [
  ['extract', extract, { message: 'A week in Lisbon', referenceDate: REFERENCE_DATE }],
  ['recommend', recommend, { profile: {}, referenceDate: REFERENCE_DATE }],
  ['present', present, { profile: {}, recommendations: [] }],
] as const;

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://api.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: WEB_ORIGIN, ...headers },
    body: JSON.stringify(body),
  });

const codeOf = async (response: Response) => ErrorResponse.parse(await response.json()).error.code;

type LimitOverrides = {
  quota?: Partial<AccessConfig['limits']['quota']>;
  perHour?: number;
  globalPerDay?: number;
};

describe('access gate', () => {
  beforeAll(() => {
    stubInviteEnv({
      REVOKED_INVITE_CODES: `revoked:${hashInviteCode(REVOKED_CODE)}`,
      WEB_ORIGIN,
      LLM_MODE: 'mock',
      MODEL_FAST: 'fast',
      MODEL_REASONING: 'reasoning',
      MODEL_CRITIC: 'critic',
    });
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  describe.each(TRIP)('POST /v1/trip/%s', (name, handler, body) => {
    const path = `/v1/trip/${name}`;

    it('AC-GATE-01: no Authorization is a 401 UNAUTHORIZED, with the body unread', async () => {
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
        new Request(`http://api.test${path}`, {
          method: 'POST',
          body: source,
          duplex: 'half',
          headers: { 'content-type': 'application/json', origin: WEB_ORIGIN },
        }),
      );
      expect(response.status).toBe(401);
      expect(await codeOf(response)).toBe('UNAUTHORIZED');
      expect(response.headers.get('www-authenticate')).toBe('Bearer');
      expect(response.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
      expect(response.headers.get('access-control-expose-headers')).toContain('retry-after');
      expect(read).toBe(false);
    });

    it.each([
      ['another scheme', 'Basic x'],
      ['an empty code', 'Bearer '],
      ['an unknown code', 'Bearer not-a-configured-code'],
      ['a revoked code', `Bearer ${REVOKED_CODE}`],
    ])('AC-GATE-02: %s is the same 401', async (_label, authorization) => {
      const response = await handler(post(path, body, { authorization }));
      expect(response.status).toBe(401);
      expect(await codeOf(response)).toBe('UNAUTHORIZED');
      expect(response.headers.get('www-authenticate')).toBe('Bearer');
    });

    it('AC-GATE-02: a valid code with the scheme in lower case is accepted', async () => {
      const response = await handler(
        post(path, body, { authorization: `bearer ${TEST_INVITE_CODE}` }),
      );
      expect(response.status).not.toBe(401);
    });
  });

  describe('AC-GATE-10: every route handler is gated', () => {
    it('finds the route files it is meant to check', () => {
      expect(routeFiles).toContain('v1/health/route.ts');
      expect(routeFiles).toContain('v1/trip/extract/route.ts');
    });

    it.each(routeFiles)('AC-GATE-10: %s', async (file) => {
      const module = (await import(pathToFileURL(`${APP_DIR}${file}`).href)) as Record<
        string,
        ((request: Request) => Promise<Response>) | undefined
      >;
      const url = `http://api.test/${file.replace(/\/route\.ts$/, '')}`;
      const isHealth = file === 'v1/health/route.ts';
      let checked = 0;
      // OPTIONS is the open preflight (AC-GATE-04). A route without HEAD gets it from GET.
      for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']) {
        const handler = module[method];
        if (typeof handler !== 'function') continue;
        const response = await handler(new Request(url, { method }));
        expect(response.status, `${method} ${url}`).toBe(isHealth && method === 'GET' ? 200 : 401);
        checked += 1;
      }
      expect(checked, `${file} exports a handler`).toBeGreaterThan(0);
    });

    it('AC-GATE-10: only the health route calls openRoute', () => {
      const callers = list(SRC_DIR)
        .filter((file) => /\.tsx?$/.test(file))
        .filter((file) => readFileSync(`${SRC_DIR}${file}`, 'utf8').includes('openRoute('))
        .sort();
      // http/route.ts defines it.
      expect(callers).toEqual(['app/v1/health/route.ts', 'http/route.ts']);
    });
  });

  describe('limits through an injected gate', () => {
    const PATH_EXTRACT = '/v1/trip/extract';
    const OTHER_CODE = 'other-invite-code';

    function setup(limits: LimitOverrides) {
      let clock = 1_000_000;
      const config: Pick<AccessConfig, 'codes' | 'revoked' | 'limits'> = {
        codes: [
          { label: TEST_INVITE_LABEL, hash: TEST_INVITE_CODE_HASH },
          { label: 'other', hash: hashInviteCode(OTHER_CODE) },
        ],
        revoked: [],
        limits: {
          quota: { extract: 1000, recommend: 1000, present: 1000, ...limits.quota },
          perHour: limits.perHour ?? 1000,
          globalPerDay: limits.globalPerDay ?? 1000,
        },
      };
      const gate = createGate({
        config,
        store: new MemoryUsageStore(),
        now: () => clock,
        log: () => undefined,
      });
      const handler = route(() => Response.json({ ok: true }), { gate: () => gate });
      return {
        send: (path: string, code = TEST_INVITE_CODE) => handler(post(path, {}, authHeaders(code))),
        advance: (ms: number) => {
          clock += ms;
        },
      };
    }

    it('AC-GATE-07: the hourly limit is a 429 RATE_LIMITED with Retry-After, and the window ends', async () => {
      const { send, advance } = setup({ perHour: 2 });
      expect((await send(PATH_EXTRACT)).status).toBe(200);
      advance(10_500);
      expect((await send(PATH_EXTRACT)).status).toBe(200);
      advance(1_000);
      const limited = await send(PATH_EXTRACT);
      expect(limited.status).toBe(429);
      expect(await codeOf(limited)).toBe('RATE_LIMITED');
      const retry = limited.headers.get('retry-after');
      expect(retry).toMatch(/^[1-9][0-9]*$/);
      // The window opened at the first request, 11.5 s ago: 3588.5 s are left, rounded up.
      expect(Number(retry)).toBe(3589);
      expect(limited.headers.get('access-control-expose-headers')).toContain('retry-after');
      expect(limited.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);

      // Another code has its own window.
      expect((await send(PATH_EXTRACT, OTHER_CODE)).status).toBe(200);

      advance(Number(retry) * 1000);
      expect((await send(PATH_EXTRACT)).status).toBe(200);
    });

    it('AC-GATE-16: a spent quota is a 429 QUOTA_EXHAUSTED with no Retry-After, for that endpoint only', async () => {
      const { send, advance } = setup({ quota: { extract: 1 } });
      expect((await send(PATH_EXTRACT)).status).toBe(200);
      const spent = await send(PATH_EXTRACT);
      expect(spent.status).toBe(429);
      expect(await codeOf(spent)).toBe('QUOTA_EXHAUSTED');
      expect(spent.headers.get('retry-after')).toBeNull();
      expect(spent.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);

      expect((await send('/v1/trip/recommend')).status).toBe(200);

      advance(48 * 60 * 60 * 1000);
      expect((await send(PATH_EXTRACT)).status).toBe(429);
    });

    it('AC-GATE-18: a full global daily window refuses every code with Retry-After', async () => {
      const { send, advance } = setup({ globalPerDay: 2 });
      expect((await send(PATH_EXTRACT)).status).toBe(200);
      expect((await send(PATH_EXTRACT, OTHER_CODE)).status).toBe(200);
      for (const code of [TEST_INVITE_CODE, OTHER_CODE]) {
        const limited = await send(PATH_EXTRACT, code);
        expect(limited.status).toBe(429);
        expect(await codeOf(limited)).toBe('RATE_LIMITED');
        expect(limited.headers.get('retry-after')).toMatch(/^[1-9][0-9]*$/);
      }
      advance(24 * 60 * 60 * 1000);
      expect((await send(PATH_EXTRACT)).status).toBe(200);
    });
  });
});
