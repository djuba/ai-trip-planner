import { loadConstants } from '../../support/artifacts.ts';
import { get, mediaType } from '../../support/http.ts';
import { assertSchema, ConformanceError } from '../../support/schemas.ts';
import { HEALTH_PATH } from './requests.ts';

export function parseJson(text: string, context: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ConformanceError(`${context}: body is not JSON: ${text.slice(0, 200)}`);
  }
}

export async function checkHealth(baseUrl: string): Promise<void> {
  const res = await get(baseUrl, HEALTH_PATH);
  const context = `GET ${HEALTH_PATH}`;
  if (res.status !== 200) {
    throw new ConformanceError(`${context}: expected 200, got ${res.status}`);
  }
  const type = mediaType(res.header('content-type'));
  if (type !== 'application/json') {
    throw new ConformanceError(`${context}: expected application/json, got ${type}`);
  }
  const body = parseJson(res.text, context);
  assertSchema('HealthResponse', body, context);
  const expected = loadConstants().contractVersion;
  const actual = (body as { contractVersion: string }).contractVersion;
  if (actual !== expected) {
    throw new ConformanceError(
      `${context}: contractVersion is ${actual}, expected ${expected} (generated/constants.json)`,
    );
  }
}
