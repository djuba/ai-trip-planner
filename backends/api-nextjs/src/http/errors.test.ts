import { ErrorResponse } from '@vp/domain-schema/wire';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LlmError } from '../usecases/errors.ts';
import { PayloadTooLargeError, RequestValidationError, toErrorResponse } from './errors.ts';

const read = async (response: Response) => ErrorResponse.parse(await response.json());

describe('toErrorResponse', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps RequestValidationError to 422 VALIDATION_FAILED', async () => {
    const response = toErrorResponse(new RequestValidationError('message: required'));
    expect(response.status).toBe(422);
    expect((await read(response)).error).toEqual({
      code: 'VALIDATION_FAILED',
      message: 'message: required',
    });
  });

  it('maps PayloadTooLargeError to 413 PAYLOAD_TOO_LARGE', async () => {
    const response = toErrorResponse(new PayloadTooLargeError('too big'));
    expect(response.status).toBe(413);
    expect((await read(response)).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('AC-API-05: an LLM refusal is a 502 LLM_REFUSAL', async () => {
    const response = toErrorResponse(new LlmError('LLM_REFUSAL', 'The model refused'));
    expect(response.status).toBe(502);
    expect((await read(response)).error.code).toBe('LLM_REFUSAL');
  });

  it('AC-API-06: an upstream failure is a 502 LLM_UPSTREAM_ERROR', async () => {
    const response = toErrorResponse(new LlmError('LLM_UPSTREAM_ERROR', 'Provider failed'));
    expect(response.status).toBe(502);
    expect((await read(response)).error.code).toBe('LLM_UPSTREAM_ERROR');
  });

  it.each([
    ['an Error', new Error('db password is hunter2')],
    ['a string', 'db password is hunter2'],
    ['undefined', undefined],
  ])('AC-API-07: %s is a 500 with no detail in the body, and is logged', async (_name, thrown) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = toErrorResponse(thrown);
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).not.toContain('hunter2');
    expect(ErrorResponse.parse(JSON.parse(body)).error.code).toBe('INTERNAL_ERROR');
    expect(log).toHaveBeenCalledWith(expect.any(String), thrown);
  });
});
