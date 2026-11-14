# Access gate: acceptance criteria

Who may call the trip endpoints, and how much. The decision is [ADR 0005 §5](../decisions/0005-hosting-and-access.md) and its WU-22 addendum; the design is the [WU-22 plan](../plans/WU-22.md) (D1–D11). "A trip endpoint" means `POST /v1/trip/extract`, `/recommend` or `/present`.

## Terms

- **Invite code:** a random secret sent as `Authorization: Bearer <code>`. The scheme name is case-insensitive.
- **Entry:** `label:hash` in `INVITE_CODES` or `REVOKED_INVITE_CODES`, where `hash` is the lowercase hex SHA-256 of the code and `label` (`[a-z0-9-]{1,32}`) names its holder. The server never holds a code, only its entry.
- **Committed codes:** the local dev code in `.env.example` and `TEST_INVITE_CODE` in the api-nextjs test support. Anyone with the repository knows them.
- **Limits:** the per-code lifetime quota per endpoint (`QUOTA_EXTRACT`, `QUOTA_RECOMMEND`, `QUOTA_PRESENT`), the per-code hourly window (`RATE_LIMIT_PER_HOUR`) and the daily window across all codes (`RATE_LIMIT_GLOBAL_PER_DAY`).

## Refusing a request

- **AC-GATE-01:** Given a trip endpoint, when a request has no `Authorization` header, then the response is a 401 `ErrorResponse` with code `UNAUTHORIZED`, a `WWW-Authenticate` header naming `Bearer`, and `Access-Control-Allow-Origin` for the web origin. The body is not read.
- **AC-GATE-02:** Given a trip endpoint, when the header has another scheme, an empty code, an unknown code or a revoked code, then the response is the same 401 as AC-GATE-01. A valid code sent with the scheme in lower case (`bearer`) is accepted.
- **AC-GATE-03:** Given a valid code within its limits, when a trip request is sent, then it is handled exactly as without the gate: body size (413), body shape (422) and the handler's answer.
- **AC-GATE-04:** Given no `Authorization` header, then `GET /v1/health` answers 200, and every endpoint's CORS preflight answers 2xx with `authorization` among `Access-Control-Allow-Headers`.

## Matching and logging

- **AC-GATE-05:** Given configured entries, when a code is presented, then it is hashed and compared with every entry's hash in constant time, without stopping at a match; any configured code matches, and a code whose hash is in no list does not.
- **AC-GATE-06:** Given any gate decision, then exactly one JSON log line records it: `event: "gate"`, the `outcome` (`allowed`, `missing`, `unknown`, `revoked`, `rate_limited`, `quota_exhausted`), the `path`, and the entry's `label` when there is one. No log line contains a code or a hash.

## Limits

- **AC-GATE-07:** Given a code that has made `RATE_LIMIT_PER_HOUR` requests in its current hourly window, when it makes another, then the response is a 429 `RATE_LIMITED` with `Retry-After` (whole seconds until the window ends, rounded up, at least 1) and `Access-Control-Expose-Headers` including `retry-after`. When the window has ended, it is allowed again. Each code has its own window.
- **AC-GATE-16:** Given a code that has used its lifetime quota for one endpoint, when it calls that endpoint again, then the response is a 429 `QUOTA_EXHAUSTED` with no `Retry-After`, and that stays true after any amount of time. Its quotas for the other endpoints are unaffected.
- **AC-GATE-17:** Given a request that one limit refuses, then no counter is incremented: not the endpoint quota, not the hourly window, not the global window.
- **AC-GATE-18:** Given the global daily window is full, when any code makes a request, then the response is a 429 `RATE_LIMITED` with `Retry-After`, until the window ends.

## Configuration

- **AC-GATE-08:** Given `LLM_MODE` `live` or `record`, then the server refuses to start when `INVITE_CODES` is empty. Every server counts as hosted unless `LOCAL_DEV=true`; a hosted one also refuses to start when any committed code is configured (in every mode), when `LLM_MODE` is `live` with the in-memory usage store, or when `LLM_MODE` is `record`. With `LOCAL_DEV=true`, `live` and `record` accept the committed codes and the memory store, and warn at startup about each, without quoting a value. `LOCAL_DEV` takes only `true` or `false`, and `true` is refused on Cloud Run (`K_SERVICE` set). Given any mode, a malformed entry or a duplicate label refuses start. Given `replay` or `mock` with no entries, the server starts, warns once, and answers every trip request with 401.
- **AC-GATE-09:** Given each limit variable, then it must be a positive integer, else the server refuses to start; when unset, it takes its default (`QUOTA_EXTRACT` 60, `QUOTA_RECOMMEND` 3, `QUOTA_PRESENT` 5, `RATE_LIMIT_PER_HOUR` 30, `RATE_LIMIT_GLOBAL_PER_DAY` 300). Error messages name variables, never values.

- **AC-GATE-19:** Given `ACCESS_GATE=off`, then every trip request reaches its handler with no code and no counting, in any `LLM_MODE` (live included, with no codes and the memory store), and the server warns at startup that it is open. Given `ACCESS_GATE=off` without `LOCAL_DEV=true`, the server refuses to start. `ACCESS_GATE` accepts only `on` and `off` (default `on`), and `infra/service.tf` sets neither it nor `LOCAL_DEV`.

## Coverage of routes and the contract

- **AC-GATE-10:** Given every `route.ts` under `src/app/`, then every exported handler except `GET /v1/health` and `OPTIONS` answers 401 without a code, so a new route can't skip the gate.
- **AC-GATE-11:** Given `spec/generated/openapi.yaml`, then the three trip POSTs declare the `inviteCode` bearer scheme and the 401 and 429 responses; `/v1/health` declares `security: []` and neither response. `ErrorCode` includes `UNAUTHORIZED`, `RATE_LIMITED` and `QUOTA_EXHAUSTED`, and `contractVersion` is 0.6.0.
- **AC-GATE-12:** Given the conformance self-test, then a fake that doesn't gate, one that gates health, and one whose preflight leaves out `authorization` each fail a check.

## Tooling and hosting

- **AC-GATE-13:** Given `pnpm test:contract --external` without `CONTRACT_INVITE_CODE`, then it fails with an error naming the variable. Given a run that starts its own server, then that server gets a fresh code for the run.
- **AC-GATE-14:** Given `infra/service.tf`, then the service takes its entries from Terraform variables and sets every limit. Given `.github/workflows/deploy.yml`, then exactly one step references the `CONTRACT_INVITE_CODE` secret: the provider contract tests.
- **AC-GATE-15:** Given `pnpm invite:new <label>`, then it prints a new code and its entry, and the gate accepts that code for that entry. An invalid label is refused.
