import { postJson } from '../../support/http.ts';
import { assertSchema, ConformanceError } from '../../support/schemas.ts';
import { parseJson } from './health.ts';
import {
  EXTRACT_PATH,
  RECOMMEND_PATH,
  confirmExtractRequest,
  extractRequest,
  recommendRequest,
  vagueExtractRequest,
} from './requests.ts';

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

async function extractBody(baseUrl: string, request: unknown, context: string): Promise<unknown> {
  const res = await postJson(baseUrl, EXTRACT_PATH, request);
  if (res.status !== 200) {
    throw new ConformanceError(
      `${context}: expected 200, got ${res.status}: ${res.text.slice(0, 300)}`,
    );
  }
  const body = parseJson(res.text, context);
  assertSchema('ExtractResponse', body, context);
  return body;
}

/** AC-CONTRACT-12: a vague message needs clarification; a complete profile is ready. */
export async function checkExtractRouting(baseUrl: string): Promise<void> {
  const vagueContext = `POST ${EXTRACT_PATH} with a vague message`;
  const vague = (await extractBody(baseUrl, vagueExtractRequest(), vagueContext)) as {
    status?: unknown;
    violations?: { code?: unknown }[];
  };
  if (vague.status !== 'needs_clarification') {
    throw new ConformanceError(
      `${vagueContext}: expected status needs_clarification, got ${JSON.stringify(vague.status)}`,
    );
  }
  if (!vague.violations?.some((v) => v.code === 'INSUFFICIENT_DETAIL')) {
    throw new ConformanceError(
      `${vagueContext}: expected an INSUFFICIENT_DETAIL violation, got ${JSON.stringify(vague.violations)}`,
    );
  }
  const confirmContext = `POST ${EXTRACT_PATH} confirming a complete profile`;
  const confirmed = (await extractBody(baseUrl, confirmExtractRequest(), confirmContext)) as {
    status?: unknown;
  };
  if (confirmed.status !== 'ready') {
    throw new ConformanceError(
      `${confirmContext}: expected status ready, got ${JSON.stringify(confirmed.status)}`,
    );
  }
}
