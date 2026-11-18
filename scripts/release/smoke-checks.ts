// Release smoke checks (WU-23b plan D6). Pure functions over an injected fetch. Node built-ins and
// relative imports only: the promote job runs this without `pnpm install`.
import { findInBundle } from '../image/web-bundle.ts';

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
export interface SmokeContext {
  apiBaseUrl: string;
  webBaseUrl: string;
  webOrigin: string;
}
export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}
export type Check = (ctx: SmokeContext, fetchFn: FetchFn) => Promise<CheckResult>;

// Details describe statuses and headers only, never URLs.
const pass = (name: string, detail = 'ok'): CheckResult => ({ name, ok: true, detail });
const fail = (name: string, detail: string): CheckResult => ({ name, ok: false, detail });
const guarded =
  (name: string, body: Check): Check =>
  async (ctx, fetchFn) => {
    try {
      return await body(ctx, fetchFn);
    } catch (error) {
      return fail(name, `request failed (${error instanceof Error ? error.name : 'error'})`);
    }
  };

export const health: Check = guarded('health', async (ctx, fetchFn) => {
  const res = await fetchFn(`${ctx.apiBaseUrl}/v1/health`);
  if (res.status !== 200) return fail('health', `status ${res.status}, expected 200`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return fail('health', 'body is not JSON');
  }
  const record = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  if (record['status'] === undefined) return fail('health', 'body has no status');
  const version = record['contractVersion'];
  if (typeof version !== 'string' || version === '') {
    return fail('health', 'body has no contractVersion');
  }
  return pass('health');
});

export const corsPreflight: Check = guarded('corsPreflight', async (ctx, fetchFn) => {
  const res = await fetchFn(`${ctx.apiBaseUrl}/v1/trip/extract`, {
    method: 'OPTIONS',
    headers: {
      Origin: ctx.webOrigin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization, content-type',
    },
  });
  if (res.status < 200 || res.status > 299)
    return fail('corsPreflight', `status ${res.status}, expected 2xx`);
  const origin = res.headers.get('access-control-allow-origin');
  if (origin !== ctx.webOrigin) {
    return fail(
      'corsPreflight',
      `Access-Control-Allow-Origin is ${origin === null ? 'missing' : 'not the web origin'}`,
    );
  }
  const allowed = (res.headers.get('access-control-allow-headers') ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase());
  if (!allowed.includes('authorization')) {
    return fail('corsPreflight', 'Access-Control-Allow-Headers does not list authorization');
  }
  return pass('corsPreflight');
});

export const unauthenticated: Check = guarded('unauthenticated', async (ctx, fetchFn) => {
  const res = await fetchFn(`${ctx.apiBaseUrl}/v1/trip/extract`, {
    method: 'POST',
    headers: { Origin: ctx.webOrigin, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (res.status !== 401) return fail('unauthenticated', `status ${res.status}, expected 401`);
  const challenge = res.headers.get('www-authenticate');
  if (challenge === null || !challenge.toLowerCase().startsWith('bearer')) {
    return fail('unauthenticated', 'WWW-Authenticate is missing or not Bearer');
  }
  return pass('unauthenticated');
});

export const webPage: Check = guarded('webPage', async (ctx, fetchFn) => {
  const res = await fetchFn(`${ctx.webBaseUrl}/`);
  if (res.status !== 200) return fail('webPage', `status ${res.status}, expected 200`);
  const type = res.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('text/html')) {
    return fail('webPage', `content-type is ${type === '' ? 'missing' : 'not text/html'}`);
  }
  return pass('webPage');
});

export const webBundle: Check = guarded('webBundle', async (ctx, fetchFn) => {
  const found = await findInBundle(ctx.webBaseUrl, ctx.apiBaseUrl, fetchFn);
  return found === null
    ? fail('webBundle', 'no script in the web page contains the API base URL')
    : pass('webBundle');
});

export const CHECKS: readonly Check[] = [
  health,
  corsPreflight,
  unauthenticated,
  webPage,
  webBundle,
];

export interface SmokeOptions {
  attempts?: number;
  delayMs?: number;
  /** Per request. A hang must become a failed check, so the rollback runs (WU-23b unit review #1). */
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Runs every check (never stopping at a failure), retrying each failing one up to `attempts` times. */
export async function runSmoke(
  ctx: SmokeContext,
  fetchFn: FetchFn,
  options: SmokeOptions = {},
): Promise<CheckResult[]> {
  const {
    attempts = 3,
    delayMs = 2000,
    timeoutMs = 10_000,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = options;
  // Every request gets its own deadline; an abort is a thrown error, which a check reports as failed.
  const timed: FetchFn = (url, init) =>
    fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const results: CheckResult[] = [];
  for (const check of CHECKS) {
    let result = await check(ctx, timed);
    for (let attempt = 1; !result.ok && attempt < attempts; attempt++) {
      await sleep(delayMs);
      result = await check(ctx, timed);
    }
    results.push(result);
  }
  return results;
}
