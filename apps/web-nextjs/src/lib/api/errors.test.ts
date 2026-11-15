import { describe, expect, it } from 'vitest';
import { errorBody } from '../../../tests/support/fixtures.ts';
import { errorFromResponse } from './errors.ts';

const body = (code: string, message = 'm') => JSON.stringify(errorBody(code, message));
const none = new Headers();

describe('errorFromResponse', () => {
  it('AC-WEB-05: 401 is unauthorized whatever the body', () => {
    expect(errorFromResponse(401, none, body('UNAUTHORIZED'))).toEqual({ kind: 'unauthorized' });
    expect(errorFromResponse(401, none, 'not json')).toEqual({ kind: 'unauthorized' });
  });

  it('AC-WEB-06: 429 RATE_LIMITED carries Retry-After seconds', () => {
    const headers = new Headers({ 'retry-after': '120' });
    expect(errorFromResponse(429, headers, body('RATE_LIMITED'))).toEqual({
      kind: 'rate_limited',
      retryAfterSeconds: 120,
    });
  });

  it('AC-WEB-06: a missing Retry-After is null', () => {
    expect(errorFromResponse(429, none, body('RATE_LIMITED'))).toEqual({
      kind: 'rate_limited',
      retryAfterSeconds: null,
    });
  });

  it.each(['-5', '1.5', 'soon', '', 'Wed, 21 Oct 2026 07:28:00 GMT'])(
    'AC-WEB-06: Retry-After %j is not a non-negative integer, so null',
    (value) => {
      const headers = new Headers({ 'retry-after': value });
      expect(errorFromResponse(429, headers, body('RATE_LIMITED'))).toEqual({
        kind: 'rate_limited',
        retryAfterSeconds: null,
      });
    },
  );

  it('AC-WEB-06: Retry-After 0 is valid', () => {
    const headers = new Headers({ 'retry-after': '0' });
    expect(errorFromResponse(429, headers, body('RATE_LIMITED'))).toEqual({
      kind: 'rate_limited',
      retryAfterSeconds: 0,
    });
  });

  it('AC-WEB-06: 429 QUOTA_EXHAUSTED is quota_exhausted', () => {
    expect(errorFromResponse(429, none, body('QUOTA_EXHAUSTED'))).toEqual({
      kind: 'quota_exhausted',
    });
  });

  it('AC-WEB-06: 429 with an unknown or missing code is rate_limited', () => {
    const headers = new Headers({ 'retry-after': '7' });
    expect(errorFromResponse(429, headers, '{"error":{"code":"WHAT","message":"x"}}')).toEqual({
      kind: 'rate_limited',
      retryAfterSeconds: 7,
    });
    expect(errorFromResponse(429, headers, '')).toEqual({
      kind: 'rate_limited',
      retryAfterSeconds: 7,
    });
  });

  it('AC-WEB-07: 413 is message_too_long by status alone', () => {
    expect(errorFromResponse(413, none, body('PAYLOAD_TOO_LARGE'))).toEqual({
      kind: 'message_too_long',
    });
    expect(errorFromResponse(413, none, '<html>')).toEqual({ kind: 'message_too_long' });
  });

  it('AC-WEB-07: 422 is invalid_request with the body message', () => {
    expect(errorFromResponse(422, none, body('VALIDATION_FAILED', 'bad field'))).toEqual({
      kind: 'invalid_request',
      message: 'bad field',
    });
  });

  it('AC-WEB-08: 502 LLM_REFUSAL is a refusal, other 502 codes are not', () => {
    expect(errorFromResponse(502, none, body('LLM_REFUSAL'))).toEqual({
      kind: 'upstream',
      refusal: true,
    });
    expect(errorFromResponse(502, none, body('LLM_UPSTREAM_ERROR'))).toEqual({
      kind: 'upstream',
      refusal: false,
    });
  });

  it('AC-WEB-08: 500, unexpected statuses and non-ErrorResponse bodies are server errors', () => {
    expect(errorFromResponse(500, none, body('INTERNAL_ERROR'))).toEqual({
      kind: 'server',
      status: 500,
    });
    expect(errorFromResponse(404, none, '')).toEqual({ kind: 'server', status: 404 });
    expect(errorFromResponse(422, none, '{"nope":true}')).toEqual({ kind: 'server', status: 422 });
    expect(errorFromResponse(502, none, 'Bad Gateway')).toEqual({ kind: 'server', status: 502 });
  });
});
