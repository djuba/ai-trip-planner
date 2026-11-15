# Web client: acceptance criteria

How `apps/web-nextjs` talks to the backend. It reaches the API over HTTP only, at the base URL in `NEXT_PUBLIC_API_BASE_URL` (CLAUDE.md §5, §9), through one typed client in `src/lib/api/`. The design is in [the WU-12 plan](../plans/WU-12.md) (D3–D6). The conversation and invite-code prompt that use this client are WU-13; consuming the `/present` stream is WU-14.

## The client

```ts
createApiClient({ baseUrl, getInviteCode, fetch? }): {
  health(init?):              Promise<ApiResult<HealthResponse>>
  extract(body, init?):       Promise<ApiResult<ExtractResponse>>
  recommend(body, init?):     Promise<ApiResult<RecommendResponse>>
  present(body, init?):       Promise<ApiResult<ReadableStream<Uint8Array>>>
}
// init: { signal?: AbortSignal }
type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError }
```

| Response | `ApiError` |
|---|---|
| 401 (any body) | `{ kind: 'unauthorized' }` |
| 429 `RATE_LIMITED` | `{ kind: 'rate_limited', retryAfterSeconds }`: whole seconds from `Retry-After`, or `null` when it is missing or not a non-negative integer |
| 429 `QUOTA_EXHAUSTED` | `{ kind: 'quota_exhausted' }` |
| 413 | `{ kind: 'message_too_long' }` |
| 422 | `{ kind: 'invalid_request', message }`, `message` from the error body (for logs, never for branching) |
| 502 `LLM_REFUSAL` | `{ kind: 'upstream', refusal: true }` |
| 502 any other code | `{ kind: 'upstream', refusal: false }` |
| any other status, or an error body that isn't an `ErrorResponse` (except 401 and 413, which map by status alone) | `{ kind: 'server', status }` |
| `fetch` rejects | `{ kind: 'network' }` |
| the request's signal aborts | `{ kind: 'aborted' }` |
| a JSON 2xx body that fails its wire schema, or isn't JSON | `{ kind: 'contract', detail }` |

A 429 with an unknown or missing code maps to `rate_limited` with whatever `Retry-After` gives. The client branches on status and `error.code`, never on `message` (CLAUDE.md §4.5).

## Acceptance criteria

- **AC-WEB-01:** Given `NEXT_PUBLIC_API_BASE_URL`, when the base URL is read, then it is that value with any trailing `/` removed. Given it is missing or blank, then reading it throws a `ConfigError` naming the variable. It is read when called, never at module load, so a build never depends on it.
- **AC-WEB-02:** Given a client, when it calls an endpoint, then the request goes to `<base>/v1/health` (GET) or `<base>/v1/trip/{extract,recommend,present}` (POST) with the body as JSON and `content-type: application/json`.
- **AC-WEB-03:** Given `getInviteCode()` returns a code, when a trip endpoint is called, then the request has `authorization: Bearer <code>`. Given it returns `undefined` or a blank string, then the header is absent. `GET /v1/health` never sends it.
- **AC-WEB-04:** Given a 2xx JSON response, then it is `safeParse`d against its wire schema (`HealthResponse`, `ExtractResponse`, `RecommendResponse`); a body that fails, or isn't JSON, is a `contract` error, never an unchecked cast.
- **AC-WEB-05:** Given a 401, then the result is `unauthorized`.
- **AC-WEB-06:** Given a 429 `RATE_LIMITED` with `Retry-After: 120`, then the result is `rate_limited` with `retryAfterSeconds: 120`; with no or an invalid `Retry-After`, `null`. Given a 429 `QUOTA_EXHAUSTED`, then the result is `quota_exhausted`.
- **AC-WEB-07:** Given a 413, then the result is `message_too_long`. Given a 422, then `invalid_request` with the body's message.
- **AC-WEB-08:** Given a 502 `LLM_REFUSAL`, then `upstream` with `refusal: true`; a 502 `LLM_UPSTREAM_ERROR`, `refusal: false`. Given a 500, an unexpected status, or an error body that isn't an `ErrorResponse`, then `server` with the status.
- **AC-WEB-09:** Given `fetch` rejects, then the result is `network`. Given the caller's `AbortSignal` aborts, then the result is `aborted`.
- **AC-WEB-10:** Given `POST /present` answers 200, then the result is the response body stream, unread; given any error status, then the mapped error, as above.
- **AC-WEB-11:** Given the Pact consumer tests, when they run, then they write `contracts/pacts/web-nextjs-vacation-api.json` (consumer `web-nextjs`, provider `vacation-api`) with the interactions in the WU-12 plan D6, made by the real client; and `pnpm test:contract` verifies it against api-nextjs.
- **AC-WEB-12:** Given the shell page, when it loads, then it shows the app's heading and an API status: "Checking the API…" while `GET /v1/health` is pending, "API connected · contract x.y.z" when it succeeds, and "API unavailable" on any error. Each state has no axe violations.
