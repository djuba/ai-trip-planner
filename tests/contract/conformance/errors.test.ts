import { describe, it } from 'vitest';
import { targetUrl } from '../support/artifacts.ts';
import { checkMalformedJson, checkPayloadTooLarge, checkSchemaFailure } from './checks/errors.ts';
import { POST_ENDPOINTS } from './checks/requests.ts';

describe.each(POST_ENDPOINTS)('$path', ({ path }) => {
  it('AC-CONTRACT-02: malformed JSON is 422 VALIDATION_FAILED', () =>
    checkMalformedJson(targetUrl(), path));

  it('AC-CONTRACT-03: valid JSON failing the request schema is 422 VALIDATION_FAILED', () =>
    checkSchemaFailure(targetUrl(), path));

  it('AC-CONTRACT-04: a body over maxRequestBodyBytes is 413 PAYLOAD_TOO_LARGE', () =>
    checkPayloadTooLarge(targetUrl(), path));
});
