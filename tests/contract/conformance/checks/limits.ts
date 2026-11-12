// AC-LIMITS-11: the input caps, checked over HTTP at exactly the cap and at cap + 1. Lengths count
// Unicode code points, so the probe text is an astral character (two UTF-16 units each).
import { loadConstants } from '../../support/artifacts.ts';
import { mediaType, postJson } from '../../support/http.ts';
import { assertSchema, ConformanceError } from '../../support/schemas.ts';
import { assertError } from './errors.ts';
import { parseJson } from './health.ts';
import { checkPresentStream } from './present.ts';
import {
  EXTRACT_PATH,
  PRESENT_PATH,
  PROFILE,
  RECOMMEND_PATH,
  extractRequest,
  presentRequest,
  recommendRequest,
} from './requests.ts';

const ASTRAL = '\u{1F334}';

/** The request schema must accept an at-cap body and reject the cap + 1 one. */
function assertRequest(schema: string, body: unknown, accepted: boolean, context: string): void {
  let ok = true;
  try {
    assertSchema(schema, body, context);
  } catch {
    ok = false;
  }
  if (ok !== accepted) {
    throw new ConformanceError(
      `${context}: test input drifted; the request schema should ${accepted ? 'accept' : 'reject'} it`,
    );
  }
}

async function expectOk(
  baseUrl: string,
  path: string,
  body: unknown,
  responseSchema: string,
  context: string,
): Promise<void> {
  if (path === PRESENT_PATH) return checkPresentStream(baseUrl, body);
  const res = await postJson(baseUrl, path, body);
  if (res.status !== 200) {
    throw new ConformanceError(
      `${context}: expected 200, got ${res.status}: ${res.text.slice(0, 300)}`,
    );
  }
  const type = mediaType(res.header('content-type'));
  if (type !== 'application/json') {
    throw new ConformanceError(`${context}: expected application/json, got ${type}`);
  }
  assertSchema(responseSchema, parseJson(res.text, context), context);
}

async function checkPair(
  baseUrl: string,
  path: string,
  requestSchema: string,
  responseSchema: string,
  build: (over: boolean) => unknown,
  label: string,
): Promise<void> {
  const atCap = build(false);
  const overCap = build(true);
  assertRequest(requestSchema, atCap, true, `${label} at the cap`);
  assertRequest(requestSchema, overCap, false, `${label} at cap + 1`);
  await expectOk(baseUrl, path, atCap, responseSchema, `POST ${path} with ${label} at the cap`);
  const res = await postJson(baseUrl, path, overCap);
  assertError(res, 422, 'VALIDATION_FAILED', `POST ${path} with ${label} at cap + 1`);
}

export async function checkMessageCap(baseUrl: string): Promise<void> {
  const { maxMessageLength } = loadConstants();
  await checkPair(
    baseUrl,
    EXTRACT_PATH,
    'ExtractRequest',
    'ExtractResponse',
    (over) => ({
      ...extractRequest(),
      message: ASTRAL.repeat(maxMessageLength + (over ? 1 : 0)),
    }),
    'message',
  );
}

const ENDPOINTS: Record<string, { schema: string; response: string }> = {
  [EXTRACT_PATH]: { schema: 'ExtractRequest', response: 'ExtractResponse' },
  [RECOMMEND_PATH]: { schema: 'RecommendRequest', response: 'RecommendResponse' },
  [PRESENT_PATH]: { schema: 'PresentRequest', response: 'PresentationModel' },
};

function withProfile(path: string, profile: unknown): unknown {
  if (path === EXTRACT_PATH) return { ...extractRequest(), currentProfile: profile };
  if (path === RECOMMEND_PATH) return { ...recommendRequest(), profile };
  if (path === PRESENT_PATH) return { ...presentRequest(), profile };
  throw new Error(`no request builder for ${path}`);
}

export async function checkProfileCaps(baseUrl: string, path: string): Promise<void> {
  const { maxShortTextLength, maxPeople } = loadConstants();
  const endpoint = ENDPOINTS[path];
  if (!endpoint) throw new Error(`no limits check for ${path}`);
  const adults = (count: number) => Array.from({ length: count }, () => ({ userType: 'adult' }));
  const cases: [string, (over: boolean) => unknown][] = [
    [
      'region',
      (over) => ({ ...PROFILE, region: ASTRAL.repeat(maxShortTextLength + (over ? 1 : 0)) }),
    ],
    ['people', (over) => ({ ...PROFILE, people: adults(maxPeople + (over ? 1 : 0)) })],
  ];
  for (const [label, profile] of cases) {
    await checkPair(
      baseUrl,
      path,
      endpoint.schema,
      endpoint.response,
      (over) => withProfile(path, profile(over)),
      label,
    );
  }
}
