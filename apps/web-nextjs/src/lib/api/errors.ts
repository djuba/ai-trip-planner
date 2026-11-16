import { ErrorResponse } from '@vp/domain-schema/wire';

export type ApiError =
  | { kind: 'unauthorized' }
  | { kind: 'rate_limited'; retryAfterSeconds: number | null }
  | { kind: 'quota_exhausted' }
  | { kind: 'message_too_long' }
  | { kind: 'invalid_request'; message: string }
  | { kind: 'upstream'; refusal: boolean }
  | { kind: 'server'; status: number }
  | { kind: 'network' }
  /** A 2xx stream that broke before its end (CLAUDE.md §5; WU-14 plan D2). */
  | { kind: 'interrupted' }
  | { kind: 'aborted' }
  | { kind: 'contract'; detail: string };

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

function parseErrorBody(bodyText: string): ErrorResponse | null {
  let json: unknown;
  try {
    json = JSON.parse(bodyText);
  } catch {
    return null;
  }
  const parsed = ErrorResponse.safeParse(json);
  return parsed.success ? parsed.data : null;
}

function retryAfterSeconds(headers: Headers): number | null {
  const raw = headers.get('retry-after')?.trim();
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  return Number.parseInt(raw, 10);
}

/** Maps a non-2xx response to an `ApiError`. Branches on status and `error.code`, never on message. */
export function errorFromResponse(status: number, headers: Headers, bodyText: string): ApiError {
  if (status === 401) return { kind: 'unauthorized' };
  if (status === 413) return { kind: 'message_too_long' };
  const body = parseErrorBody(bodyText);
  if (status === 429) {
    if (body?.error.code === 'QUOTA_EXHAUSTED') return { kind: 'quota_exhausted' };
    return { kind: 'rate_limited', retryAfterSeconds: retryAfterSeconds(headers) };
  }
  if (body !== null) {
    if (status === 422) return { kind: 'invalid_request', message: body.error.message };
    if (status === 502) return { kind: 'upstream', refusal: body.error.code === 'LLM_REFUSAL' };
  }
  return { kind: 'server', status };
}
