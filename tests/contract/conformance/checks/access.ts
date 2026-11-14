// The access gate (WU-22, docs/features/access-gate.md): trip endpoints need an invite code,
// health and preflights do not. Black-box: only status, headers and bodies are judged.
import { randomBytes } from 'node:crypto';
import { get, postJson, type HttpResult } from '../../support/http.ts';
import { assertSchema, ConformanceError } from '../../support/schemas.ts';
import { assertError } from './errors.ts';
import { parseJson } from './health.ts';
import {
  confirmExtractRequest,
  HEALTH_PATH,
  presentRequest,
  recommendRequest,
  type PostEndpoint,
} from './requests.ts';

function validBody(endpoint: PostEndpoint): unknown {
  switch (endpoint.schema) {
    case 'ExtractRequest':
      return confirmExtractRequest();
    case 'RecommendRequest':
      return recommendRequest();
    case 'PresentRequest':
      return presentRequest();
    default:
      throw new Error(`no request builder for ${endpoint.schema}`);
  }
}

function assertUnauthorized(res: HttpResult, origin: string, context: string): void {
  assertError(res, 401, 'UNAUTHORIZED', context);
  const challenge = res.header('www-authenticate');
  const scheme = challenge
    ?.trim()
    .split(/[\s,]+/)[0]
    ?.toLowerCase();
  if (scheme !== 'bearer') {
    throw new ConformanceError(
      `${context}: WWW-Authenticate should start with Bearer, got ${challenge ?? 'nothing'}`,
    );
  }
  const allowOrigin = res.header('access-control-allow-origin');
  if (allowOrigin !== origin) {
    throw new ConformanceError(
      `${context}: Access-Control-Allow-Origin should be ${origin}, got ${allowOrigin ?? 'nothing'}`,
    );
  }
}

/** AC-GATE-01: a schema-valid request with no Authorization header is refused with 401. */
export async function checkMissingCode(
  baseUrl: string,
  endpoint: PostEndpoint,
  origin: string,
): Promise<void> {
  const res = await postJson(baseUrl, endpoint.path, validBody(endpoint), origin, {
    authorization: null,
  });
  assertUnauthorized(res, origin, `POST ${endpoint.path} without Authorization`);
}

/** AC-GATE-02: a code the backend has never issued is refused the same way. */
export async function checkUnknownCode(
  baseUrl: string,
  endpoint: PostEndpoint,
  origin: string,
): Promise<void> {
  const code = randomBytes(32).toString('base64url');
  const res = await postJson(baseUrl, endpoint.path, validBody(endpoint), origin, {
    authorization: `Bearer ${code}`,
  });
  assertUnauthorized(res, origin, `POST ${endpoint.path} with an unknown code`);
}

/** AC-GATE-04: health stays open, so monitors and the deploy check need no code. */
export async function checkHealthOpen(baseUrl: string): Promise<void> {
  const context = `GET ${HEALTH_PATH} without Authorization`;
  const res = await get(baseUrl, HEALTH_PATH, undefined, { authorization: null });
  if (res.status !== 200) {
    throw new ConformanceError(`${context}: expected 200, got ${res.status}`);
  }
  assertSchema('HealthResponse', parseJson(res.text, context), context);
}
