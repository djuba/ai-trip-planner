// Maps anything a handler throws to the error envelope (CLAUDE.md §5).
import { ErrorResponse, type ErrorCode } from '@vp/domain-schema/wire';
import { LlmError } from '../usecases/errors.ts';
import { QuotaExhaustedError, RateLimitedError, UnauthorizedError } from './gate.ts';

/** The request body broke the contract, so the client gets a 422 explaining why. */
export class RequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestValidationError';
  }
}

/** The request body is over the shared size cap: a 413. */
export class PayloadTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayloadTooLargeError';
  }
}

function envelope(
  status: number,
  code: ErrorCode,
  message: string,
  headers?: Record<string, string>,
): Response {
  return Response.json(ErrorResponse.parse({ error: { code, message } }), { status, headers });
}

export function toErrorResponse(error: unknown): Response {
  if (error instanceof UnauthorizedError) {
    // RFC 6750 requires the challenge on a 401.
    return envelope(401, 'UNAUTHORIZED', error.message, { 'www-authenticate': 'Bearer' });
  }
  if (error instanceof RateLimitedError) {
    return envelope(429, 'RATE_LIMITED', error.message, {
      'retry-after': String(error.retryAfterSeconds),
    });
  }
  if (error instanceof QuotaExhaustedError) {
    return envelope(429, 'QUOTA_EXHAUSTED', error.message);
  }
  if (error instanceof PayloadTooLargeError) {
    return envelope(413, 'PAYLOAD_TOO_LARGE', error.message);
  }
  if (error instanceof RequestValidationError) {
    return envelope(422, 'VALIDATION_FAILED', error.message);
  }
  if (error instanceof LlmError) {
    return envelope(502, error.code, error.message);
  }
  // A bug: the details go to the log, never to the client.
  console.error('Unhandled error in route handler', error);
  return envelope(500, 'INTERNAL_ERROR', 'Internal server error');
}
