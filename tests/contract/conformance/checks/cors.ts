import { loadConstants } from '../../support/artifacts.ts';
import {
  get,
  headerTokens,
  postOversized,
  postText,
  preflight,
  type HttpResult,
} from '../../support/http.ts';
import { ConformanceError } from '../../support/schemas.ts';
import { EXTRACT_PATH, HEALTH_PATH } from './requests.ts';

function assertAllowOrigin(res: HttpResult, origin: string, context: string): void {
  const actual = res.header('access-control-allow-origin');
  if (actual !== origin) {
    throw new ConformanceError(
      `${context}: Access-Control-Allow-Origin should be ${origin}, got ${actual ?? 'nothing'}`,
    );
  }
}

/** Preflight must be 2xx and allow the method and content-type for the web origin (plan D5). */
export async function checkPreflight(
  baseUrl: string,
  path: string,
  method: 'GET' | 'POST',
  origin: string,
): Promise<void> {
  const context = `OPTIONS ${path} (preflight for ${method})`;
  const res = await preflight(baseUrl, path, method, origin);
  if (res.status < 200 || res.status > 299) {
    throw new ConformanceError(`${context}: expected a 2xx status, got ${res.status}`);
  }
  assertAllowOrigin(res, origin, context);
  const methods = headerTokens(res.header('access-control-allow-methods'));
  if (!methods.includes('*') && !methods.includes(method.toLowerCase())) {
    throw new ConformanceError(
      `${context}: Access-Control-Allow-Methods should include ${method}, got ${methods.join(',')}`,
    );
  }
  const headers = headerTokens(res.header('access-control-allow-headers'));
  if (!headers.includes('*') && !headers.includes('content-type')) {
    throw new ConformanceError(
      `${context}: Access-Control-Allow-Headers should include content-type, got ${headers.join(',')}`,
    );
  }
}

/** Real responses (200, 422, 413) must carry the allow-origin header too. */
export async function checkResponsesCarryCors(baseUrl: string, origin: string): Promise<void> {
  assertAllowOrigin(await get(baseUrl, HEALTH_PATH, origin), origin, `GET ${HEALTH_PATH} (200)`);

  const bad = await postText(baseUrl, EXTRACT_PATH, '{"message":', origin);
  if (bad.status !== 422) {
    throw new ConformanceError(`POST ${EXTRACT_PATH} (malformed): expected 422, got ${bad.status}`);
  }
  assertAllowOrigin(bad, origin, `POST ${EXTRACT_PATH} (422)`);

  const big = await postOversized(
    baseUrl,
    EXTRACT_PATH,
    loadConstants().maxRequestBodyBytes + 1,
    origin,
  );
  if (big.status !== 413) {
    throw new ConformanceError(`POST ${EXTRACT_PATH} (oversized): expected 413, got ${big.status}`);
  }
  assertAllowOrigin(big, origin, `POST ${EXTRACT_PATH} (413)`);
}
