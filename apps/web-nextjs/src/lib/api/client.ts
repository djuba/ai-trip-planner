import {
  ExtractResponse,
  HealthResponse,
  RecommendResponse,
  type ExtractRequest,
  type PresentRequest,
  type RecommendRequest,
} from '@vp/domain-schema/wire';
import type { z } from 'zod';
import { errorFromResponse, type ApiResult } from './errors.ts';

export interface ApiClientOptions {
  baseUrl: string;
  getInviteCode: () => string | undefined;
  /** Defaults to `globalThis.fetch`, looked up at request time. */
  fetch?: typeof globalThis.fetch;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface ApiClient {
  health(init?: RequestOptions): Promise<ApiResult<HealthResponse>>;
  extract(body: ExtractRequest, init?: RequestOptions): Promise<ApiResult<ExtractResponse>>;
  recommend(body: RecommendRequest, init?: RequestOptions): Promise<ApiResult<RecommendResponse>>;
  present(
    body: PresentRequest,
    init?: RequestOptions,
  ): Promise<ApiResult<ReadableStream<Uint8Array>>>;
}

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (error instanceof DOMException && error.name === 'AbortError');
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const base = options.baseUrl.replace(/\/+$/, '');

  async function send(
    path: string,
    gated: boolean,
    body: unknown,
    init: RequestOptions | undefined,
  ): Promise<ApiResult<Response>> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (gated) {
      const code = options.getInviteCode()?.trim();
      if (code) headers['authorization'] = `Bearer ${code}`;
    }
    const doFetch = options.fetch ?? globalThis.fetch;
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(init?.signal ? { signal: init.signal } : {}),
      });
    } catch (error) {
      return { ok: false, error: { kind: isAbort(error, init?.signal) ? 'aborted' : 'network' } };
    }
    if (res.ok) return { ok: true, data: res };
    let text = '';
    try {
      text = await res.text();
    } catch (error) {
      if (isAbort(error, init?.signal)) return { ok: false, error: { kind: 'aborted' } };
    }
    return { ok: false, error: errorFromResponse(res.status, res.headers, text) };
  }

  async function sendJson<S extends z.ZodType>(
    schema: S,
    path: string,
    gated: boolean,
    body: unknown,
    init: RequestOptions | undefined,
  ): Promise<ApiResult<z.output<S>>> {
    const sent = await send(path, gated, body, init);
    if (!sent.ok) return sent;
    let json: unknown;
    try {
      json = await sent.data.json();
    } catch (error) {
      if (isAbort(error, init?.signal)) return { ok: false, error: { kind: 'aborted' } };
      return { ok: false, error: { kind: 'contract', detail: 'response body is not JSON' } };
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const where = first && first.path.length > 0 ? first.path.join('.') : '(root)';
      return {
        ok: false,
        error: { kind: 'contract', detail: `${where}: ${first?.message ?? 'invalid'}` },
      };
    }
    return { ok: true, data: parsed.data };
  }

  return {
    health: (init) => sendJson(HealthResponse, '/v1/health', false, undefined, init),
    extract: (body, init) => sendJson(ExtractResponse, '/v1/trip/extract', true, body, init),
    recommend: (body, init) => sendJson(RecommendResponse, '/v1/trip/recommend', true, body, init),
    async present(body, init) {
      const sent = await send('/v1/trip/present', true, body, init);
      if (!sent.ok) return sent;
      if (sent.data.body === null) {
        return { ok: false, error: { kind: 'contract', detail: 'response has no body' } };
      }
      return { ok: true, data: sent.data.body };
    },
  };
}
