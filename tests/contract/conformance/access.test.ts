import { describe, it } from 'vitest';
import { targetUrl, webOrigin } from '../support/artifacts.ts';
import { checkHealthOpen, checkMissingCode, checkUnknownCode } from './checks/access.ts';
import { POST_ENDPOINTS } from './checks/requests.ts';

describe('access gate', () => {
  it.each(POST_ENDPOINTS)(
    'AC-GATE-01: $path without Authorization is 401 UNAUTHORIZED with WWW-Authenticate and CORS',
    (endpoint) => checkMissingCode(targetUrl(), endpoint, webOrigin()),
  );

  it.each(POST_ENDPOINTS)('AC-GATE-02: $path with an unknown code is the same 401', (endpoint) =>
    checkUnknownCode(targetUrl(), endpoint, webOrigin()),
  );

  it('AC-GATE-04: GET /v1/health needs no Authorization', () => checkHealthOpen(targetUrl()));
});
