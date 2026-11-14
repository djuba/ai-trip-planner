// AC-CONTRACT-09: the conformance checks, run against a fake backend. This proves the suite itself
// fails on a single non-conformant field and passes on valid variations (plan D5-D7).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  checkHealthOpen,
  checkMissingCode,
  checkUnknownCode,
} from '../conformance/checks/access.ts';
import { checkPreflight, checkResponsesCarryCors } from '../conformance/checks/cors.ts';
import {
  checkMalformedJson,
  checkPayloadTooLarge,
  checkSchemaFailure,
} from '../conformance/checks/errors.ts';
import { checkMessageCap, checkProfileCaps } from '../conformance/checks/limits.ts';
import { checkHealth } from '../conformance/checks/health.ts';
import { checkPresentStream } from '../conformance/checks/present.ts';
import {
  confirmExtractRequest,
  EXTRACT_PATH,
  HEALTH_PATH,
  POST_ENDPOINTS,
  PRESENT_PATH,
  PROFILE,
  RECOMMEND_PATH,
} from '../conformance/checks/requests.ts';
import {
  checkExtractResponse,
  checkExtractRouting,
  checkRecommendNotReady,
  checkRecommendResponse,
} from '../conformance/checks/responses.ts';
import { inviteCode, loadConstants } from '../support/artifacts.ts';
import { postJson } from '../support/http.ts';
import { ConformanceError } from '../support/schemas.ts';
import {
  errorBody,
  startFakeBackend,
  type FakeBackend,
  type FakeHook,
  type FakeOptions,
  type FakeRequest,
  type FakeResponse,
} from './fake-backend.ts';

const ORIGIN = 'http://localhost:3000';

// The checks send this code and the fake accepts it, so the two agree.
beforeAll(() => {
  vi.stubEnv('CONTRACT_INVITE_CODE', 'self-test-invite-code');
  return () => vi.unstubAllEnvs();
});

type Check = (url: string) => Promise<void>;

/** Every check the suite runs, by name. */
const ALL_CHECKS: Record<string, Check> = {
  health: checkHealth,
  extractResponse: checkExtractResponse,
  extractRouting: checkExtractRouting,
  recommendResponse: checkRecommendResponse,
  recommendNotReady: checkRecommendNotReady,
  present: checkPresentStream,
  responsesCarryCors: (url) => checkResponsesCarryCors(url, ORIGIN),
  messageCap: checkMessageCap,
  healthOpen: checkHealthOpen,
  healthPreflight: (url) => checkPreflight(url, HEALTH_PATH, 'GET', ORIGIN),
  ...Object.fromEntries(
    POST_ENDPOINTS.flatMap((endpoint) => {
      const { path } = endpoint;
      return [
        [`malformed ${path}`, (url: string) => checkMalformedJson(url, path)] as const,
        [`schema ${path}`, (url: string) => checkSchemaFailure(url, path)] as const,
        [`413 ${path}`, (url: string) => checkPayloadTooLarge(url, path)] as const,
        [`preflight ${path}`, (url: string) => checkPreflight(url, path, 'POST', ORIGIN)] as const,
        [`missing code ${path}`, (url: string) => checkMissingCode(url, endpoint, ORIGIN)] as const,
        [`unknown code ${path}`, (url: string) => checkUnknownCode(url, endpoint, ORIGIN)] as const,
        [`profile caps ${path}`, (url: string) => checkProfileCaps(url, path)] as const,
      ];
    }),
  ),
};

let running: FakeBackend | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

async function fake(options: FakeOptions = {}): Promise<string> {
  running = await startFakeBackend({ origin: ORIGIN, ...options });
  return running.url;
}

/** Replaces one response, leaving every other request conformant. */
const replace =
  (match: (req: FakeRequest) => boolean, change: (def: FakeResponse) => FakeResponse): FakeHook =>
  (req, def) =>
    match(req) ? change(def) : def;

const errorResponse = (def: FakeResponse, status: number, code: string): FakeResponse => ({
  ...def,
  status,
  chunks: [errorBody(code)],
});

describe('AC-CONTRACT-09: baseline', () => {
  it('AC-CONTRACT-09: every check passes against the unmodified fake', async () => {
    const url = await fake();
    for (const [name, check] of Object.entries(ALL_CHECKS)) {
      await expect(check(url), name).resolves.toBeUndefined();
    }
  });
});

describe('AC-CONTRACT-09: a single non-conformant response fails the matching check', () => {
  it('AC-CONTRACT-09: wrong contractVersion fails health', async () => {
    const url = await fake({
      hook: replace(
        (r) => r.path === HEALTH_PATH,
        (d) => ({
          ...d,
          chunks: [JSON.stringify({ status: 'ok', contractVersion: '0.0.0' })],
        }),
      ),
    });
    await expect(checkHealth(url)).rejects.toThrow(ConformanceError);
  });

  it('AC-CONTRACT-09: a 422 with the wrong code fails the malformed-JSON check', async () => {
    const url = await fake({
      hook: replace(
        (r) =>
          r.path === EXTRACT_PATH && r.bodyText.startsWith('{"message":') && r.bodyText.length < 12,
        (d) => errorResponse(d, 422, 'INTERNAL_ERROR'),
      ),
    });
    await expect(checkMalformedJson(url, EXTRACT_PATH)).rejects.toThrow(ConformanceError);
  });

  it('AC-CONTRACT-09: an oversized body answered 422 fails the 413 check', async () => {
    const url = await fake({
      hook: replace(
        (r) => r.oversized,
        (d) => errorResponse(d, 422, 'VALIDATION_FAILED'),
      ),
    });
    await expect(checkPayloadTooLarge(url, EXTRACT_PATH)).rejects.toThrow(ConformanceError);
  });

  it('AC-CONTRACT-09: an ExtractResponse with an unknown status fails', async () => {
    const url = await fake({
      hook: replace(
        (r) => r.path === EXTRACT_PATH && !r.oversized,
        (d) => ({ ...d, chunks: [JSON.stringify({ status: 'maybe', profile: {} })] }),
      ),
    });
    await expect(checkExtractResponse(url)).rejects.toThrow(ConformanceError);
  });

  it('AC-CONTRACT-09: a RecommendResponse missing critique fails', async () => {
    const url = await fake({
      hook: replace(
        (r) => r.path === RECOMMEND_PATH && !r.oversized,
        (d) => {
          const rest = JSON.parse(d.chunks.join('')) as Record<string, unknown>;
          delete rest.critique;
          return { ...d, chunks: [JSON.stringify(rest)] };
        },
      ),
    });
    await expect(checkRecommendResponse(url)).rejects.toThrow(ConformanceError);
  });

  it('AC-CONTRACT-09: /present with SDK framing (0:"...") fails', async () => {
    const url = await fake({
      hook: replace(
        (r) => r.path === PRESENT_PATH && !r.oversized,
        (d) => ({ ...d, chunks: [`0:${JSON.stringify(d.chunks.join(''))}\n`] }),
      ),
    });
    await expect(checkPresentStream(url)).rejects.toThrow(/not raw JSON/);
  });

  it('AC-CONTRACT-09: /present with truncated JSON fails', async () => {
    const url = await fake({
      hook: replace(
        (r) => r.path === PRESENT_PATH && !r.oversized,
        (d) => ({ ...d, chunks: [d.chunks.join('').slice(0, 40)] }),
      ),
    });
    await expect(checkPresentStream(url)).rejects.toThrow(ConformanceError);
  });

  it('AC-CONTRACT-09: a missing Access-Control-Allow-Origin fails the CORS checks', async () => {
    const strip = (d: FakeResponse): FakeResponse => {
      const headers = { ...d.headers };
      delete headers['access-control-allow-origin'];
      return { ...d, headers };
    };
    const url = await fake({ hook: replace(() => true, strip) });
    await expect(checkResponsesCarryCors(url, ORIGIN)).rejects.toThrow(ConformanceError);
    await expect(checkPreflight(url, EXTRACT_PATH, 'POST', ORIGIN)).rejects.toThrow(
      ConformanceError,
    );
  });
});

describe('AC-GATE-12: the access checks fail a backend that gates wrongly', () => {
  const [extract] = POST_ENDPOINTS;
  if (!extract) throw new Error('no endpoints');
  const isTripPost = (r: FakeRequest) => r.method === 'POST' && r.path === EXTRACT_PATH;

  it('AC-GATE-12: a backend that does not gate fails checkMissingCode and checkUnknownCode', async () => {
    const url = await fake({ hook: replace(isTripPost, (d) => okFor(EXTRACT_PATH, d)) });
    await expect(checkMissingCode(url, extract, ORIGIN)).rejects.toThrow(/expected 401, got 200/);
    await expect(checkUnknownCode(url, extract, ORIGIN)).rejects.toThrow(/expected 401, got 200/);
  });

  it('AC-GATE-12: a backend that gates health fails checkHealthOpen', async () => {
    const url = await fake({
      hook: replace(
        (r) => r.path === HEALTH_PATH && !r.authorization,
        (d) => errorResponse(d, 401, 'UNAUTHORIZED'),
      ),
    });
    await expect(checkHealthOpen(url)).rejects.toThrow(/expected 200, got 401/);
  });

  it('AC-GATE-12: a preflight that omits authorization fails checkPreflight', async () => {
    const url = await fake({
      hook: replace(
        (r) => r.method === 'OPTIONS',
        (d) => ({
          ...d,
          headers: { ...d.headers, 'access-control-allow-headers': 'content-type' },
        }),
      ),
    });
    await expect(checkPreflight(url, EXTRACT_PATH, 'POST', ORIGIN)).rejects.toThrow(
      /should include authorization/,
    );
  });

  it('AC-GATE-12: a 401 without WWW-Authenticate fails checkMissingCode', async () => {
    const url = await fake({
      hook: replace(
        (r) => isTripPost(r) && !r.authorization,
        (d) => {
          const headers = { ...d.headers };
          delete headers['www-authenticate'];
          return { ...d, headers };
        },
      ),
    });
    await expect(checkMissingCode(url, extract, ORIGIN)).rejects.toThrow(/WWW-Authenticate/);
  });

  it('AC-GATE-12: a lower-case bearer scheme is accepted by the conformant fake', async () => {
    const url = await fake();
    const res = await postJson(url, EXTRACT_PATH, confirmExtractRequest(), ORIGIN, {
      authorization: `bearer ${inviteCode()}`,
    });
    expect(res.status).toBe(200);
  });
});

describe('AC-CONTRACT-09: valid variations pass', () => {
  it('AC-CONTRACT-09: a preflight answered 200 instead of 204 passes', async () => {
    const url = await fake({ preflightStatus: 200 });
    await checkPreflight(url, EXTRACT_PATH, 'POST', ORIGIN);
    await checkPreflight(url, HEALTH_PATH, 'GET', ORIGIN);
  });

  it('AC-CONTRACT-09: a 413 sent before the upload ends, then a socket close, passes', async () => {
    const url = await fake({ early413: true });
    for (const { path } of POST_ENDPOINTS) await checkPayloadTooLarge(url, path);
    await checkResponsesCarryCors(url, ORIGIN);
  });
});

describe('AC-CONTRACT-12: the routing check fails a backend that routes wrongly', () => {
  const answer = (kind: 'ready' | 'clarify') => (d: FakeResponse) => ({
    ...d,
    chunks: [routingBody(kind)],
  });

  it('AC-CONTRACT-12: the conformant fake passes checkExtractRouting', async () => {
    await expect(checkExtractRouting(await fake())).resolves.toBeUndefined();
  });

  it('AC-CONTRACT-12: a backend that always answers ready fails checkExtractRouting', async () => {
    const url = await fake({ hook: replace((r) => r.path === EXTRACT_PATH, answer('ready')) });
    await expect(checkExtractRouting(url)).rejects.toThrow(/expected status needs_clarification/);
  });

  it('AC-CONTRACT-12: a backend that always needs clarification fails checkExtractRouting', async () => {
    const url = await fake({ hook: replace((r) => r.path === EXTRACT_PATH, answer('clarify')) });
    await expect(checkExtractRouting(url)).rejects.toThrow(/expected status ready/);
  });
});

describe('AC-CONTRACT-13: the not-ready check fails a backend that recommends anyway', () => {
  it('AC-CONTRACT-13: the conformant fake passes checkRecommendNotReady', async () => {
    await expect(checkRecommendNotReady(await fake())).resolves.toBeUndefined();
  });

  it('AC-CONTRACT-13: a fake that answers 200 for a not-ready profile fails', async () => {
    const url = await fake({
      hook: replace(
        (r) => r.path === RECOMMEND_PATH,
        (d) => ({
          ...d,
          status: 200,
          chunks: [
            JSON.stringify({ recommendations: [], critique: { pass: true, unresolved: [] } }),
          ],
        }),
      ),
    });
    await expect(checkRecommendNotReady(url)).rejects.toThrow(/expected 422, got 200/);
  });

  it('AC-CONTRACT-13: a fake that answers 422 with the wrong code fails', async () => {
    const url = await fake({
      hook: replace(
        (r) => r.path === RECOMMEND_PATH,
        (d) => errorResponse(d, 422, 'INTERNAL_ERROR'),
      ),
    });
    await expect(checkRecommendNotReady(url)).rejects.toThrow(
      /expected error code VALIDATION_FAILED/,
    );
  });
});

describe('AC-LIMITS-11: the cap checks fail a backend that gets a cap wrong', () => {
  const { maxMessageLength, maxShortTextLength, maxPeople } = loadConstants();

  it('AC-LIMITS-11: a backend that ignores the message cap fails checkMessageCap', async () => {
    const url = await fake({
      hook: replace(
        (r) => r.path === EXTRACT_PATH && !r.oversized,
        (d) => okFor(EXTRACT_PATH, d),
      ),
    });
    await expect(checkMessageCap(url)).rejects.toThrow(ConformanceError);
  });

  it('AC-LIMITS-11: a backend that counts UTF-16 units fails checkMessageCap', async () => {
    const url = await fake({
      hook: replace(
        (r) => r.path === EXTRACT_PATH && messageOf(r).length > maxMessageLength,
        (d) => errorResponse(d, 422, 'VALIDATION_FAILED'),
      ),
    });
    await expect(checkMessageCap(url)).rejects.toThrow(ConformanceError);
  });

  const overCap: Record<string, (profile: ProfileProbe | undefined) => boolean> = {
    region: (p) => typeof p?.region === 'string' && [...p.region].length > maxShortTextLength,
    people: (p) => Array.isArray(p?.people) && p.people.length > maxPeople,
  };

  describe.each(POST_ENDPOINTS)('$path', ({ path }) => {
    it.each(Object.keys(overCap))(
      'AC-LIMITS-11: a backend that ignores the %s cap fails checkProfileCaps',
      async (field) => {
        const ignores = overCap[field];
        if (!ignores) throw new Error(`no probe for ${field}`);
        const url = await fake({
          hook: (req, def) =>
            req.path === path && ignores(profileOf(req)) ? okFor(path, def) : def,
        });
        // The at-cap probe must still pass, so the failure is the ignored cap, not a bad body.
        await expect(checkProfileCaps(url, path)).rejects.toThrow(/expected 422, got 200/);
      },
    );
  });
});

function messageOf(req: FakeRequest): string {
  try {
    const { message } = JSON.parse(req.bodyText) as { message?: unknown };
    return typeof message === 'string' ? message : '';
  } catch {
    return '';
  }
}

interface ProfileProbe {
  region?: unknown;
  people?: unknown;
}

function profileOf(req: FakeRequest): ProfileProbe | undefined {
  try {
    const body = JSON.parse(req.bodyText) as { currentProfile?: unknown; profile?: unknown };
    return (body.currentProfile ?? body.profile) as ProfileProbe | undefined;
  } catch {
    return undefined;
  }
}

/** A conformant 200 for `path`, as a backend that skipped a cap check would send it. */
function okFor(path: string, def: FakeResponse): FakeResponse {
  if (path === PRESENT_PATH) {
    return {
      ...def,
      status: 200,
      headers: { ...def.headers, 'content-type': 'text/plain; charset=utf-8' },
      chunks: [JSON.stringify({ headline: 'h', intro: 'i', cards: [] })],
    };
  }
  const body =
    path === RECOMMEND_PATH
      ? { recommendations: [], critique: { pass: true, unresolved: [] } }
      : { status: 'ready', profile: {} };
  return { ...def, status: 200, chunks: [JSON.stringify(body)] };
}

function routingBody(kind: 'ready' | 'clarify'): string {
  return kind === 'ready'
    ? JSON.stringify({ status: 'ready', profile: PROFILE })
    : JSON.stringify({
        status: 'needs_clarification',
        profile: {},
        violations: [
          { code: 'INSUFFICIENT_DETAIL', path: '', params: { populated: 0, required: 3 } },
        ],
        clarificationQuestion: 'Where would you like to go, and when?',
      });
}
