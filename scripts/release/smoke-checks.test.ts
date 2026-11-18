import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  corsPreflight,
  health,
  runSmoke,
  unauthenticated,
  webBundle,
  webPage,
  type FetchFn,
  type SmokeContext,
} from './smoke-checks.ts';

const ctx: SmokeContext = {
  apiBaseUrl: 'https://api.example.test',
  webBaseUrl: 'https://web.example.test',
  webOrigin: 'https://web.example.test',
};

type Reply = { status?: number; headers?: Record<string, string>; body?: string };
const reply = (r: Reply): Response =>
  new Response(r.status === 204 ? null : (r.body ?? ''), {
    status: r.status ?? 200,
    headers: r.headers ?? {},
  });

/** Fake fetch routed by "METHOD url"; unknown routes are a test bug. */
function fakeFetch(routes: Record<string, Reply | (() => Reply)>): FetchFn {
  return (url, init) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    const route = routes[key];
    if (route === undefined) throw new Error(`unrouted ${key}`);
    return Promise.resolve(reply(typeof route === 'function' ? route() : route));
  };
}

const HEALTH = 'GET https://api.example.test/v1/health';
const PREFLIGHT = 'OPTIONS https://api.example.test/v1/trip/extract';
const EXTRACT = 'POST https://api.example.test/v1/trip/extract';
const PAGE = 'GET https://web.example.test/';
const SCRIPT = 'GET https://web.example.test/_next/static/app.js';

const good: Record<string, Reply> = {
  [HEALTH]: { body: JSON.stringify({ status: 'ok', contractVersion: '1.0.0' }) },
  [PREFLIGHT]: {
    status: 204,
    headers: {
      'access-control-allow-origin': ctx.webOrigin,
      'access-control-allow-headers': 'Content-Type, Authorization',
    },
  },
  [EXTRACT]: { status: 401, headers: { 'www-authenticate': 'Bearer realm="x"' } },
  [PAGE]: {
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: '<script src="/_next/static/app.js"></script>',
  },
  [SCRIPT]: { body: `const u="${ctx.apiBaseUrl}";` },
};
const withRoute = (key: string, r: Reply | (() => Reply)) => fakeFetch({ ...good, [key]: r });

describe('release smoke checks', () => {
  it('AC-HOST-16: every check passes against a healthy deployment', async () => {
    const results = await runSmoke(ctx, fakeFetch(good), { sleep: () => Promise.resolve() });
    expect(results.map((r) => r.name)).toEqual([
      'health',
      'corsPreflight',
      'unauthenticated',
      'webPage',
      'webBundle',
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('AC-HOST-16: health fails on a wrong status, a non-JSON body and a missing contractVersion', async () => {
    expect((await health(ctx, withRoute(HEALTH, { status: 503 }))).ok).toBe(false);
    expect((await health(ctx, withRoute(HEALTH, { body: 'nope' }))).ok).toBe(false);
    expect((await health(ctx, withRoute(HEALTH, { body: '{"status":"ok"}' }))).ok).toBe(false);
    expect(
      (await health(ctx, withRoute(HEALTH, { body: '{"status":"ok","contractVersion":""}' }))).ok,
    ).toBe(false);
  });

  it('AC-HOST-16: corsPreflight fails on status, missing or wrong or wildcard origin, and no authorization header', async () => {
    const h = good[PREFLIGHT]!.headers!;
    const cases: Reply[] = [
      { status: 403, headers: h },
      { status: 204, headers: { 'access-control-allow-headers': 'authorization' } },
      {
        status: 204,
        headers: { ...h, 'access-control-allow-origin': 'https://other.example.test' },
      },
      { status: 204, headers: { ...h, 'access-control-allow-origin': '*' } },
      { status: 204, headers: { ...h, 'access-control-allow-headers': 'content-type' } },
      { status: 204, headers: { ...h, 'access-control-allow-headers': '*' } },
    ];
    for (const c of cases) {
      expect((await corsPreflight(ctx, withRoute(PREFLIGHT, c))).ok).toBe(false);
    }
  });

  it('AC-HOST-16: unauthenticated fails on a non-401 and on a missing or non-Bearer challenge', async () => {
    expect((await unauthenticated(ctx, withRoute(EXTRACT, { status: 200 }))).ok).toBe(false);
    expect((await unauthenticated(ctx, withRoute(EXTRACT, { status: 401 }))).ok).toBe(false);
    const basic = { status: 401, headers: { 'www-authenticate': 'Basic' } };
    expect((await unauthenticated(ctx, withRoute(EXTRACT, basic))).ok).toBe(false);
  });

  it('AC-HOST-16: webPage fails on a wrong status and on non-HTML content', async () => {
    expect((await webPage(ctx, withRoute(PAGE, { status: 500 }))).ok).toBe(false);
    const json = { headers: { 'content-type': 'application/json' } };
    expect((await webPage(ctx, withRoute(PAGE, json))).ok).toBe(false);
  });

  it('AC-HOST-16: webBundle fails when no script has the API URL, and a fetch throw is a failure, not a crash', async () => {
    expect((await webBundle(ctx, withRoute(SCRIPT, { body: 'nothing' }))).ok).toBe(false);
    const throwing: FetchFn = (url, init) =>
      url.endsWith('app.js') ? Promise.reject(new Error('boom')) : fakeFetch(good)(url, init);
    expect((await webBundle(ctx, throwing)).ok).toBe(false);
    expect((await webBundle(ctx, withRoute(PAGE, { status: 502 }))).ok).toBe(false);
  });

  it('AC-HOST-16: runSmoke runs every check after a failure', async () => {
    const results = await runSmoke(ctx, withRoute(HEALTH, { status: 500 }), {
      sleep: () => Promise.resolve(),
    });
    expect(results).toHaveLength(5);
    expect(results[0]?.ok).toBe(false);
    expect(results.slice(1).every((r) => r.ok)).toBe(true);
  });

  it('AC-HOST-16: runSmoke retries a flaky check then passes, and gives up after the attempts', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const flaky = withRoute(HEALTH, () => {
      calls += 1;
      return calls < 3 ? { status: 503 } : good[HEALTH]!;
    });
    const results = await runSmoke(ctx, flaky, {
      delayMs: 7,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });
    expect(results[0]?.ok).toBe(true);
    expect(calls).toBe(3);
    expect(sleeps).toEqual([7, 7]);

    calls = 0;
    const always = withRoute(HEALTH, () => {
      calls += 1;
      return { status: 503 };
    });
    const failed = await runSmoke(ctx, always, { attempts: 2, sleep: () => Promise.resolve() });
    expect(failed[0]?.ok).toBe(false);
    expect(calls).toBe(2);
  });

  it('AC-HOST-16: details never contain the URLs', async () => {
    const broken: FetchFn = () => Promise.reject(new Error(`cannot reach ${ctx.apiBaseUrl}`));
    const results = await runSmoke(ctx, broken, { sleep: () => Promise.resolve() });
    expect(results.every((r) => !r.ok)).toBe(true);
    for (const r of results) {
      expect(r.detail).not.toContain('example.test');
    }
    const wrong = await corsPreflight(
      ctx,
      withRoute(PREFLIGHT, {
        status: 204,
        headers: { 'access-control-allow-origin': 'https://web.example.test.evil' },
      }),
    );
    expect(wrong.detail).not.toContain('example.test');
  });

  it('AC-HOST-16: the smoke script and its checks import only node: modules or relative paths', () => {
    for (const file of ['../release-smoke.ts', 'smoke-checks.ts', '../image/web-bundle.ts']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      const specifiers = [
        ...source.matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+['"]([^'"]+)['"]/gm),
      ].map((m) => m[1] ?? '');
      const bare = [...source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)].map((m) => m[1] ?? '');
      for (const spec of [...specifiers, ...bare]) {
        expect(spec.startsWith('node:') || spec.startsWith('./') || spec.startsWith('../')).toBe(
          true,
        );
      }
    }
  });

  it('AC-HOST-16: a request that never answers fails its check instead of hanging', async () => {
    const hanging: FetchFn = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation timed out.', 'TimeoutError')),
        );
      });
    const results = await runSmoke(ctx, hanging, {
      attempts: 1,
      timeoutMs: 20,
      sleep: () => Promise.resolve(),
    });
    expect(results).toHaveLength(5);
    expect(results.every((result) => !result.ok)).toBe(true);
    expect(results[0]?.detail).toMatch(/request failed \((TimeoutError|AbortError)\)/);
  });
});
