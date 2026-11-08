import { describe, it } from 'vitest';
import { targetUrl, webOrigin } from '../support/artifacts.ts';
import { checkPreflight, checkResponsesCarryCors } from './checks/cors.ts';
import { HEALTH_PATH, POST_ENDPOINTS } from './checks/requests.ts';

describe('preflight', () => {
  it(`AC-CONTRACT-07: ${HEALTH_PATH} allows GET and content-type for the web origin`, () =>
    checkPreflight(targetUrl(), HEALTH_PATH, 'GET', webOrigin()));

  it.each(POST_ENDPOINTS)(
    'AC-CONTRACT-07: $path allows POST and content-type for the web origin',
    ({ path }) => checkPreflight(targetUrl(), path, 'POST', webOrigin()),
  );
});

it('AC-CONTRACT-07: 200, 422 and 413 responses carry Access-Control-Allow-Origin', () =>
  checkResponsesCarryCors(targetUrl(), webOrigin()));
