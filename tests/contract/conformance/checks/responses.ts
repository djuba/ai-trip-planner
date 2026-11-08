import { postJson } from '../../support/http.ts';
import { assertSchema, ConformanceError } from '../../support/schemas.ts';
import { parseJson } from './health.ts';
import { EXTRACT_PATH, RECOMMEND_PATH, extractRequest, recommendRequest } from './requests.ts';

async function checkOk(
  baseUrl: string,
  path: string,
  request: unknown,
  schema: string,
): Promise<void> {
  const res = await postJson(baseUrl, path, request);
  const context = `POST ${path}`;
  if (res.status !== 200) {
    throw new ConformanceError(
      `${context}: expected 200, got ${res.status}: ${res.text.slice(0, 300)}`,
    );
  }
  assertSchema(schema, parseJson(res.text, context), context);
}

export const checkExtractResponse = (baseUrl: string) =>
  checkOk(baseUrl, EXTRACT_PATH, extractRequest(), 'ExtractResponse');

export const checkRecommendResponse = (baseUrl: string) =>
  checkOk(baseUrl, RECOMMEND_PATH, recommendRequest(), 'RecommendResponse');
