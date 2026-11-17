# Access gate: acceptance criteria

Who may call the trip endpoints, and how much. The decision is [ADR 0005 §5](../decisions/0005-hosting-and-access.md) and its WU-22 and WU-23a addenda; the design is the [WU-22 plan](../plans/WU-22.md) (D1–D11) and the [WU-23a plan](../plans/WU-23a.md) (per-code options, ID tokens, the Firestore store). "A trip endpoint" means `POST /v1/trip/extract`, `/recommend` or `/present`.

## Terms

- **Invite code:** a random secret sent as `Authorization: Bearer <code>`. The scheme name is case-insensitive.
- **Entry:** `label:hash` in `INVITE_CODES` or `REVOKED_INVITE_CODES`, where `hash` is the lowercase hex SHA-256 of the code and `label` (`[a-z0-9-]{1,32}`) names its holder, optionally followed by `;key=value` options (AC-GATE-20). The server never holds a code, only its entry.
- **Trusted account:** a `label:email` entry in `TRUSTED_SERVICE_ACCOUNTS`. A Google ID token for that service account is accepted in place of a code (AC-GATE-23).
- **Committed codes:** the local dev code in `.env.example` and `TEST_INVITE_CODE` in the api-nextjs test support. Anyone with the repository knows them.
- **Limits:** the per-code lifetime quota per endpoint (`QUOTA_EXTRACT`, `QUOTA_RECOMMEND`, `QUOTA_PRESENT`), the per-code hourly window (`RATE_LIMIT_PER_HOUR`) and the daily window across all codes (`RATE_LIMIT_GLOBAL_PER_DAY`). The first four are service-wide values an entry's options can override; the daily window can't be.

## Refusing a request

- **AC-GATE-01:** Given a trip endpoint, when a request has no `Authorization` header, then the response is a 401 `ErrorResponse` with code `UNAUTHORIZED`, a `WWW-Authenticate` header naming `Bearer`, and `Access-Control-Allow-Origin` for the web origin. The body is not read.
- **AC-GATE-02:** Given a trip endpoint, when the header has another scheme, an empty code, an unknown code, a revoked code, an expired code (AC-GATE-21) or an ID token that fails verification (AC-GATE-24), then the response is the same 401 as AC-GATE-01. A valid code sent with the scheme in lower case (`bearer`) is accepted.
- **AC-GATE-03:** Given a valid code within its limits, when a trip request is sent, then it is handled exactly as without the gate: body size (413), body shape (422) and the handler's answer.
- **AC-GATE-04:** Given no `Authorization` header, then `GET /v1/health` answers 200, and every endpoint's CORS preflight answers 2xx with `authorization` among `Access-Control-Allow-Headers`.

## Matching and logging

- **AC-GATE-05:** Given configured entries, when a code is presented, then it is hashed and compared with every entry's hash in constant time, without stopping at a match; any configured code matches, and a code whose hash is in no list does not.
- **AC-GATE-06:** Given any gate decision, then exactly one JSON log line records it: `event: "gate"`, the `outcome` (`allowed`, `missing`, `unknown`, `revoked`, `expired`, `invalid_token`, `rate_limited`, `quota_exhausted`), the `path`, and the entry's or trusted account's `label` when there is one. No log line contains a code, a hash or a token.

## Limits

- **AC-GATE-07:** Given a code that has made `RATE_LIMIT_PER_HOUR` requests in its current hourly window, when it makes another, then the response is a 429 `RATE_LIMITED` with `Retry-After` (whole seconds until the window ends, rounded up, at least 1) and `Access-Control-Expose-Headers` including `retry-after`. When the window has ended, it is allowed again. Each code has its own window.
- **AC-GATE-16:** Given a code that has used its lifetime quota for one endpoint, when it calls that endpoint again, then the response is a 429 `QUOTA_EXHAUSTED` with no `Retry-After`, and that stays true after any amount of time. Its quotas for the other endpoints are unaffected.
- **AC-GATE-17:** Given a request that one limit refuses, then no counter is incremented: not the endpoint quota, not the hourly window, not the global window.
- **AC-GATE-18:** Given the global daily window is full, when any code makes a request, then the response is a 429 `RATE_LIMITED` with `Retry-After`, until the window ends.

## Configuration

- **AC-GATE-08:** Given `LLM_MODE` `live` or `record`, then the server refuses to start when `INVITE_CODES` is empty. Every server counts as hosted unless `LOCAL_DEV=true`; a hosted one also refuses to start when any committed code is configured (in every mode), when `LLM_MODE` is `live` with the in-memory usage store, or when `LLM_MODE` is `record`. `USAGE_STORE` accepts `memory` and `firestore`; hosted `live` starts with `firestore`. With `LOCAL_DEV=true`, `live` and `record` accept the committed codes and the memory store, and warn at startup about each, without quoting a value. `LOCAL_DEV` takes only `true` or `false`, and `true` is refused on Cloud Run (`K_SERVICE` set). Given any mode, a malformed entry or a duplicate label refuses start. Given `replay` or `mock` with no entries, the server starts, warns once, and answers every trip request with 401.
- **AC-GATE-09:** Given each limit variable, then it must be a positive integer, else the server refuses to start; when unset, it takes its default (`QUOTA_EXTRACT` 60, `QUOTA_RECOMMEND` 3, `QUOTA_PRESENT` 5, `RATE_LIMIT_PER_HOUR` 30, `RATE_LIMIT_GLOBAL_PER_DAY` 300). Error messages name variables, never values.

- **AC-GATE-19:** Given `ACCESS_GATE=off`, then every trip request reaches its handler with no code and no counting, in any `LLM_MODE` (live included, with no codes and the memory store), and the server warns at startup that it is open. Given `ACCESS_GATE=off` without `LOCAL_DEV=true`, the server refuses to start. `ACCESS_GATE` accepts only `on` and `off` (default `on`), and `infra/service.tf` sets neither it nor `LOCAL_DEV`.

## Coverage of routes and the contract

- **AC-GATE-10:** Given every `route.ts` under `src/app/`, then every exported handler except `GET /v1/health` and `OPTIONS` answers 401 without a code, so a new route can't skip the gate.
- **AC-GATE-11:** Given `spec/generated/openapi.yaml`, then the three trip POSTs declare the `inviteCode` bearer scheme and the 401 and 429 responses; `/v1/health` declares `security: []` and neither response. `ErrorCode` includes `UNAUTHORIZED`, `RATE_LIMITED` and `QUOTA_EXHAUSTED`, and `contractVersion` is 0.6.0.
- **AC-GATE-12:** Given the conformance self-test, then a fake that doesn't gate, one that gates health, and one whose preflight leaves out `authorization` each fail a check.

## Tooling and hosting

- **AC-GATE-13:** Given `pnpm test:contract --external` without `CONTRACT_INVITE_CODE`, then it fails with an error naming the variable. The variable holds whatever Bearer credential the backend accepts: an invite code, or on the post-deploy check a Google ID token. Given a run that starts its own server, then that server gets a fresh code for the run.
- **AC-GATE-14:** Given `infra/service.tf`, then the service takes its entries from Terraform variables and sets every limit. Given `.github/workflows/deploy.yml`, then no step references a `CONTRACT_INVITE_CODE` secret; the provider contract tests get the output of an ID-token step that writes no credentials file and exports no variables, and that step's audience equals the service's `ID_TOKEN_AUDIENCE`.
- **AC-GATE-15:** Given `pnpm invite:new <label>`, then it prints a new code and its entry, and the gate accepts that code for that entry. An invalid label is refused.

## Per-code options (WU-23a)

- **AC-GATE-20:** Given an entry with options (`;extract=`, `;recommend=`, `;present=` a positive integer or `none`; `;hour=` a positive integer; `;expires=` a `YYYY-MM-DD` date), then that code's limits are the options, falling back to the service-wide values for any not set; `none` means that endpoint has no lifetime quota for the code. The global daily window applies regardless. An unknown option, a repeated option or a malformed value refuses start, and the error names the variable and entry number, never a value.
- **AC-GATE-21:** Given an entry with `;expires=D`, then the code is allowed through the end of D in UTC; from the next instant it gets the 401 of AC-GATE-01, logged as `expired` with its label, and no counter is touched.
- **AC-GATE-22:** Given `INVITE_CODES` or `REVOKED_INVITE_CODES`, then entries may be separated by commas or newlines, and blank lines and lines starting with `#` are ignored.
- **AC-GATE-28:** Given `pnpm invite:new <label>` with `--extract`, `--recommend`, `--present` (a positive integer or `none`), `--no-quota` (all three `none`), `--hour` or `--expires`, then it prints an entry carrying those options, which the gate accepts with those limits. A malformed flag or value, a repeated flag, or `--no-quota` with a per-endpoint quota is refused.

## Service-account ID tokens (WU-23a)

- **AC-GATE-23:** Given a Bearer value that is a Google-signed RS256 ID token with `iss` `https://accounts.google.com` (or `accounts.google.com`), `aud` equal to `ID_TOKEN_AUDIENCE`, an unexpired `exp`, `email_verified` true and an `email` listed in `TRUSTED_SERVICE_ACCOUNTS`, then the request is allowed under that entry's label, counted only by the global daily window, and handled exactly as for a code (AC-GATE-03).
- **AC-GATE-24:** Given a Bearer JWT that has a bad signature, another `alg`, another issuer or audience, has expired, has an unverified or unlisted email, or is malformed, then the response is the 401 of AC-GATE-01, logged as `invalid_token`. Given `TRUSTED_SERVICE_ACCOUNTS` unset, then every JWT is refused this way.
- **AC-GATE-25:** Given `TRUSTED_SERVICE_ACCOUNTS` set without `ID_TOKEN_AUDIENCE`, a malformed `label:email` entry, or a label also used by an invite entry, then the server refuses to start.

## Persistent counts (WU-23a)

- **AC-GATE-26:** Given `USAGE_STORE=firestore`, then AC-GATE-07, -16, -17 and -18 hold with the counts in Firestore: they survive a new store instance (a restart), and concurrent requests from several store instances never let a counter exceed its limit.
- **AC-GATE-27:** Given a usage store that fails, then the request is answered with a 500 `INTERNAL_ERROR`, the handler doesn't run, and the log line names no code.
- **AC-GATE-29:** Given `infra/`, then the runtime service account has `roles/datastore.user` and nothing else, the service sets `USAGE_STORE` from a variable that defaults to `firestore`, and one alert policy matches gate log lines whose outcome is `revoked`, `expired`, `quota_exhausted` or `rate_limited`.
