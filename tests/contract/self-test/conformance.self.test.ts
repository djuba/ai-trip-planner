// AC-CONTRACT-09: the conformance checks, run against a fake backend. This proves the suite itself
// fails on a single non-conformant field and passes on valid variations (plan D5-D7).
import { afterEach, describe, expect, it } from 'vitest';
import { checkPreflight, checkResponsesCarryCors } from '../conformance/checks/cors.ts';
import {
  checkMalformedJson,
  checkPayloadTooLarge,
  checkSchemaFailure,
} from '../conformance/checks/errors.ts';
import { checkHealth } from '../conformance/checks/health.ts';
import { checkPresentStream } from '../conformance/checks/present.ts';
import {
  EXTRACT_PATH,
  HEALTH_PATH,
  POST_ENDPOINTS,
  PRESENT_PATH,
  RECOMMEND_PATH,
} from '../conformance/checks/requests.ts';
import { checkExtractResponse, checkRecommendResponse } from '../conformance/checks/responses.ts';
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

type Check = (url: string) => Promise<void>;

/** Every check the suite runs, by name. */
const ALL_CHECKS: Record<string, Check> = {
  health: checkHealth,
  extractResponse: checkExtractResponse,
  recommendResponse: checkRecommendResponse,
  present: checkPresentStream,
  responsesCarryCors: (url) => checkResponsesCarryCors(url, ORIGIN),
  healthPreflight: (url) => checkPreflight(url, HEALTH_PATH, 'GET', ORIGIN),
  ...Object.fromEntries(
    POST_ENDPOINTS.flatMap(({ path }) => [
      [`malformed ${path}`, (url: string) => checkMalformedJson(url, path)] as const,
      [`schema ${path}`, (url: string) => checkSchemaFailure(url, path)] as const,
      [`413 ${path}`, (url: string) => checkPayloadTooLarge(url, path)] as const,
      [`preflight ${path}`, (url: string) => checkPreflight(url, path, 'POST', ORIGIN)] as const,
    ]),
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
