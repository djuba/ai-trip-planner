# Provider contract suite

The provider contract tests decide whether a backend conforms to the HTTP contract (CLAUDE.md §5, §6.5). They live in `tests/contract/` and are black-box: they read only `spec/generated/*.json` and pact files, talk to the backend over HTTP, and import no workspace code. So they judge the contract rather than the implementation, and can check any running backend, including a deployed one.

Run it with `pnpm test:contract`, which builds and starts api-nextjs, or with `pnpm test:contract:external`, which tests the backend at `API_BASE_URL`. The runner stops the server it started on exit, on Ctrl-C and on `SIGTERM`. The signal path has no automated test, because Windows can't deliver a console Ctrl-C from a test, so a forced kill of the runner (`taskkill /F`) can leave `next start` holding its port.

The rule fixtures go through `/extract` in api-nextjs's own integration tests (WU-09), not in this suite. See [ADR 0003](../decisions/0003-spec-first-one-implementation.md).

## What the checks require

The checks require only what the contract specifies, never how api-nextjs happens to answer:
- **Preflight:** any 2xx status. `Access-Control-Allow-Origin` equals `WEB_ORIGIN`. `Access-Control-Allow-Methods` contains the requested method, and `Access-Control-Allow-Headers` contains `content-type`, each compared as case-insensitive comma-separated tokens; `*` is accepted for both.
- **Content types** are compared by media type only (`application/json`, `text/plain`); parameters such as `charset` are ignored.
- **413:** oversized bodies are sent with an explicit `content-length`. A server may answer before the upload finishes and then close the connection; only a connection that fails before any response counts as a failure. A server that resets the connection the instant it finishes writing can lose its own 413 in transit (seen on Windows), so close gracefully after answering.
- **No exact-cap case here:** a valid body of exactly `maxRequestBodyBytes` would reach the LLM once the endpoints are real, so it is proven at api-nextjs's integration layer instead (AC-API-04).

## Acceptance criteria

**AC-CONTRACT-01.** Given a backend, when the suite calls `GET /v1/health`, then it gets a 200 JSON body valid against `HealthResponse`, whose `contractVersion` equals `contractVersion` in `generated/constants.json`.

**AC-CONTRACT-02.** Given each POST endpoint, when the body is malformed JSON, then the response is a 422 JSON `ErrorResponse` with code `VALIDATION_FAILED`.

**AC-CONTRACT-03.** Given each POST endpoint, when the body is valid JSON that fails the endpoint's request schema, then the response is a 422 `VALIDATION_FAILED`.

**AC-CONTRACT-04.** Given each POST endpoint, when the body is `maxRequestBodyBytes + 1` bytes, then the response is a 413 `ErrorResponse` with code `PAYLOAD_TOO_LARGE`, even if the server answers before the upload finishes.

**AC-CONTRACT-05.** Given valid requests to `/v1/trip/extract` and `/v1/trip/recommend`, then each response is a 200 whose body is valid against `ExtractResponse` or `RecommendResponse`.

**AC-CONTRACT-06.** Given a valid request to `/v1/trip/present`, then the response is a 200 with media type `text/plain`, and the complete body parses as JSON valid against `PresentationModel`. Framed streams (such as AI SDK data-stream lines) fail.

**AC-CONTRACT-07.** Given each endpoint, when a browser-style preflight arrives from `WEB_ORIGIN`, then it is answered as described under "What the checks require". 200, 413 and 422 responses to requests from `WEB_ORIGIN` carry `Access-Control-Allow-Origin: <WEB_ORIGIN>`.

**AC-CONTRACT-08.** Given the wiring pact in `tests/contract/support/`, then the Pact verifier verifies it against the backend. Given no pact files in `contracts/pacts/`, then consumer verification is skipped with a reason; given some, every one verifies.

**AC-CONTRACT-09.** Given a fake backend that answers correctly, then every check passes. When one response is changed to break the contract in one field, then the matching check fails. A 200 preflight and a 413 sent before the upload finishes still pass.

**AC-CONTRACT-10.** Given a file in `tests/contract/`, when it imports `@vp/*` or a path into `apps/`, `backends/` or `packages/`, then lint fails.

**AC-CONTRACT-11.** Given `pnpm test:contract`, then the runner starts its own api-nextjs and ignores an exported `API_BASE_URL`, saying so. Given `--external`, then it targets `API_BASE_URL` and starts nothing; without `API_BASE_URL` it fails with an error.

**AC-CONTRACT-12.** Given a vague request (`Somewhere warm`, no `currentProfile`), when it is sent to `/extract`, then the answer is 200, a valid `ExtractResponse` with status `needs_clarification` and an `INSUFFICIENT_DETAIL` violation. Given a complete `currentProfile` and a confirming message, then the answer is 200, valid, with status `ready`. A fake that always answers `ready`, or always `needs_clarification`, fails the check.
