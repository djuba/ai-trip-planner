import { loadConstants } from '../../support/artifacts.ts';
import { mediaType, postOversized, postText, type HttpResult } from '../../support/http.ts';
import { assertSchema, ConformanceError } from '../../support/schemas.ts';
import { parseJson } from './health.ts';

export function assertError(res: HttpResult, status: number, code: string, context: string): void {
  if (res.status !== status) {
    throw new ConformanceError(`${context}: expected ${status}, got ${res.status}`);
  }
  const type = mediaType(res.header('content-type'));
  if (type !== 'application/json') {
    throw new ConformanceError(`${context}: error body should be application/json, got ${type}`);
  }
  const body = parseJson(res.text, context);
  assertSchema('ErrorResponse', body, context);
  const actual = (body as { error: { code: string } }).error.code;
  if (actual !== code) {
    throw new ConformanceError(`${context}: expected error code ${code}, got ${actual}`);
  }
}

/** Malformed JSON must be a 422 contract failure (CLAUDE.md §5). */
export async function checkMalformedJson(baseUrl: string, path: string): Promise<void> {
  const res = await postText(baseUrl, path, '{"message":');
  assertError(res, 422, 'VALIDATION_FAILED', `POST ${path} with malformed JSON`);
}

/** Valid JSON that fails the request schema must be a 422 too. */
export async function checkSchemaFailure(baseUrl: string, path: string): Promise<void> {
  for (const [label, body] of [
    ['an empty object', '{}'],
    ['wrong field types', '{"message":42,"profile":"x","referenceDate":false,"recommendations":1}'],
  ] as const) {
    const res = await postText(baseUrl, path, body);
    assertError(res, 422, 'VALIDATION_FAILED', `POST ${path} with ${label}`);
  }
}

/** A body one byte over the cap must be 413, even if the server answers early (plan D6). */
export async function checkPayloadTooLarge(baseUrl: string, path: string): Promise<void> {
  const size = loadConstants().maxRequestBodyBytes + 1;
  const res = await postOversized(baseUrl, path, size);
  assertError(res, 413, 'PAYLOAD_TOO_LARGE', `POST ${path} with ${size} bytes`);
}
