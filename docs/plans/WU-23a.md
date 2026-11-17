# WU-23a — Live-ready API: plan

**Status:** approved (2026-11-17) with the recommended answers and the changes below · **Depends on:** WU-21, WU-22 (both done on `main`) · **Author:** main agent (Opus), 2026-11-16

**Review tier:** `sonnet` for the plan review (done); **`opus` for the unit review** (Q2)

## Decisions at approval (they override the sections below where they differ)

**Answers.** Q1 scratch-branch proof before merge. Q2 `opus` for the unit review. Q3 the alert emails `alert_email` from the git-ignored `terraform.tfvars`. Q5 `jose` for ID-token verification (ID tokens stay in this unit, not deferred to WU-23b). Firestore through its REST API (D1), not the SDK.

**A1. Invite entries stay in Terraform; no Secret Manager in this unit.** (replaces D5, Q4 and the secret parts of D9)
- The WU-23 Secrets line predates WU-22's decision to hold only `label:hash` entries. Hashes can't be used as codes, so the entries aren't secrets; the API key, the one real secret, is WU-23c's. The entries stay in `invite_codes` and `revoked_invite_codes` in the git-ignored `terraform.tfvars`, as today. ADR 0005's addendum records why.
- `REVOKED_INVITE_CODES` stays as it is. D3's `;revoked` flag is dropped; the other per-entry options (`extract`, `recommend`, `present`, `hour`, `expires`), and commas, newlines, blank and `#` lines as separators, stay. AC-GATE-22 no longer mentions the flag; AC-GATE-08's amendment about `REVOKED_INVITE_CODES` is dropped.
- `variables.tf` validation widens to accept the options and still rejects the committed hashes; `infra-config.test.ts` pins it.
- Removed from §3: `infra/secrets.tf`, `invite_codes_version`; Secret Manager is not enabled. AC-GATE-14's amendment becomes: entries still come from Terraform variables, and no step reads a `CONTRACT_INVITE_CODE` secret. AC-GATE-29: the runtime account uses Firestore; the alert matches the four outcomes.
- Workflow for a new code is unchanged: `pnpm invite:new <label> [flags]`, add the entry to `invite_codes`, plan, apply, send the code.

**A2. Rollout (replaces D9).**
1. Before merge, apply from the branch what today's image accepts: the Firestore database and the runtime account's role, the ID-token role, the alert, `TRUSTED_SERVICE_ACCOUNTS` and `ID_TOKEN_AUDIENCE` env (ignored by today's image), with `usage_store = "memory"` and `extra_deploy_ref` set to a scratch branch.
2. A push to the scratch branch deploys the new image and runs the contract check with an ID token.
3. Apply with `usage_store` unset (Firestore); re-run the scratch deploy.
4. After merge: `main` deploys; remove `extra_deploy_ref`, apply, `terraform plan` clean; remove the `ci-contract` entry, apply, and delete the `CONTRACT_INVITE_CODE` secret.
I prepare the commands; you run them.

**Plan-review outcomes.**
1. (P1, two-phase secret apply) moot: no secret (A1).
2. (P1, old image and the new env) no change: `access-config.ts` treats an unset variable as an empty list, and A2 step 1 sets only variables today's image ignores.
3. (P1) `getGate()` choosing the store (T11's wiring) and CLAUDE.md §3/§6.7's `pnpm test:firestore` lines go in commit 5 with the store; CLAUDE.md §5 goes with commit 3 or 4. CLAUDE.md lands in one commit, so its final home is chosen at the walk-through.
4. (P1) tier: `opus` for the unit review (Q2).
5. (P2) T4 split: **Opus** writes `firestore-usage-store.ts` (request and response shapes, error mapping, retry, token source); **Sonnet** writes the shared suite, the fake and the emulator script.
6. (P2) T7 also reviews every `console.*` call in `src/`, and AC-LOG-01 adds a failure-path case (an upstream failure, 502).
7. (P2) CLAUDE.md §3's `test:contract:external` row is updated: on the hosted check the variable carries an ID token.
8. (P2) the fake Firestore is an injected `fetch` function, not an HTTP server.

WU-23 was split in three at the start of this session, at the user's choice: **WU-23a** (this unit) makes the API ready for live mode while the hosted service stays in replay; **WU-23b** hosts the web client and adds the manual live-release workflow; **WU-23c** sizes the limits and launches. The split, and where each WU-23 Note now lives, lands in `docs/work-breakdown.md` with this plan.

## 1. Goal & scope

**Goal:** everything the API needs before it can safely run live is built and proven on the hosted environment, which still runs in replay mode at no LLM cost. After this unit, WU-23c's switch to live is configuration only.

**In scope** (from WU-23's scope and the WU-22 and WU-21 Notes that now belong here):
- **Persistent usage counts:** a Firestore `UsageStore` behind the existing interface, so hosted live mode can start (WU-22 refuses it with the memory store). The hosted replay service uses it from this unit on, so every deploy's contract check exercises it.
- **Per-code limits:** each invite entry can carry its own quotas (or none), hourly window, expiry date and a revoked flag, set by `pnpm invite:new` flags and editable without reissuing the code. That makes the owner's code possible (no lifetime quota, an hourly window, still counted by the global daily window).
- **CI credential:** the post-deploy contract check authenticates with a short-lived **Google ID token** of the deploy identity, verified by the gate against an allowlist. The `CONTRACT_INVITE_CODE` Actions secret and its `ci-contract` entry are deleted afterwards.
- **Secret Manager for the invite entries:** Terraform creates the secret and grants the runtime account access; the entries are added by hand, so they leave Terraform state and `terraform.tfvars`.
- **Alerts:** a log-based alert on `revoked`, `expired`, `quota_exhausted` and `rate_limited` gate events.
- **Logging review:** production logs carry usage, latency, discard signals and labels, never message content, codes or hashes. A functional test proves it.
- Runbook (`infra/README.md`), ADR 0005 addendum, `access-gate.md` ACs, CLAUDE.md §3, §5, §6.7.

**Out of scope:**
- The web Dockerfile and web service, the manual live-release workflow behind a GitHub Environment, candidate-tag deploys, the live deploy identity question, the journeys `--image` mode: **WU-23b**.
- The cost arithmetic, final limit values, the Anthropic workspace and API key secret, `LLM_MODE=live`, `MODEL_CRITIC` on Haiku, `request_timeout_seconds`, the launch checklist, the README demo line: **WU-23c**. (The API key secret moves to WU-23c because who may read it depends on WU-23b's identity decision.)
- Any HTTP contract change. The 401 and 429 responses stay exactly as WU-22 defined them, so `contractVersion` stays 0.6.0.

## 2. Approach & key decisions

**D1. Firestore through its REST API, with optimistic preconditions.** (WU-22 Note; ADR 0005 §4)
- `FirestoreUsageStore` implements `take()` in two calls: `documents:batchGet` reads every counter's document, the shared decision logic (D2) decides, and on success one `documents:commit` writes all counters atomically, each with a precondition (`exists: false` for a new document, `updateTime` for an existing one). A precondition failure means another writer got there first: re-read and retry, at most 5 times, then throw. A refused request writes nothing (AC-GATE-17 holds).
- Within one instance, `take()` calls are serialized through a promise queue, so the instance never contends with itself; preconditions cover a second instance or a restart overlapping the old one.
- One document per counter in collection `usage`, ID = the counter key (`quota:<label>:<endpoint>`, `hour:<label>`, `global:day`), fields `count` and `windowStart`.
- Auth: on Cloud Run, an access token from the metadata server (cached until a minute before expiry, injected clock); the project ID from the metadata server too, or `GOOGLE_CLOUD_PROJECT`. With `FIRESTORE_EMULATOR_HOST` set, it talks to the emulator with the emulator's `Bearer owner`.
- A store failure **fails closed**: the gate throws, the request gets the existing 500 `INTERNAL_ERROR`, and the handler never runs.
- *Rejected:* `@google-cloud/firestore` (a gRPC and protobuf dependency tree in `pnpm audit --prod` and the image, for two REST calls); Firestore transactions (`beginTransaction`/`commit`: an extra round trip for what preconditions already give); Memorystore/Redis (not free); a Cloud Storage object with generation preconditions (one hot object for every counter).

**D2. One decision function for both stores.** `MemoryUsageStore`'s window logic moves into a pure `decide(counters, slots, now)` in `usage-store.ts`; both stores call it, so the semantics can't drift. A shared store test suite (`tests/support/usage-store-suite.ts`) runs against the memory store and a fake Firestore REST server in unit tests, and against the real Firestore emulator in `pnpm test:firestore` (D7). The emulator run is what proves the fake is faithful.

**D3. Per-code options in the entry, one list, one secret.** (WU-22 Note "Per-code limits")
- An entry is `label:hash` followed by optional `;key=value` options: `extract`, `recommend`, `present` (a positive integer, or `none` for no lifetime quota), `hour` (positive integer), `expires` (`YYYY-MM-DD`: valid through the end of that UTC day), and the bare flag `revoked`. Unset options take the service-wide values (`QUOTA_*`, `RATE_LIMIT_PER_HOUR`). The global daily window applies to every code and can't be overridden.
- Entries are separated by commas or newlines; blank lines and lines starting with `#` are ignored, so the secret can be edited by hand with comments.
- **`REVOKED_INVITE_CODES` goes away**: revoking is adding `;revoked` to the entry. A server that still sees `REVOKED_INVITE_CODES` set refuses to start (rather than silently un-revoking those codes). One list means one secret, and Secret Manager can't hold an empty secret version, which a separate revoked list would usually be.
- An expired code gets the same 401, logged with the new outcome `expired` and its label.
- `pnpm invite:new <label> [--extract n|none] [--recommend n|none] [--present n|none] [--no-quota] [--hour n] [--expires YYYY-MM-DD]` prints the code and the full entry. Changing an existing code's limits is editing its options; the counters are keyed by label, so they carry over.
- Owner's code (made in WU-23c): `pnpm invite:new owner --no-quota --hour 30`.

**D4. Google ID tokens for allowlisted service accounts.** (WU-22 Note "CI credential")
- The gate tells the two credentials apart by shape: a JWT has two dots, an invite code (base64url) has none. A Bearer JWT is verified with **`jose`** (`jwtVerify`, RS256 only), against Google's JWKS (`createRemoteJWKSet`, which caches keys and rate-limits refetches). It must have `iss` `https://accounts.google.com` (or `accounts.google.com`), `aud` equal to `ID_TOKEN_AUDIENCE`, an unexpired `exp`, `email_verified: true`, and an `email` listed in `TRUSTED_SERVICE_ACCOUNTS` (`label:email` entries).
- A trusted account has no lifetime quota and no hourly window; it is still counted by the global daily window (the WU-22 Note's design). Its label is logged like a code's.
- Any other JWT gets the same 401, logged as the new outcome `invalid_token` (without the token or the reason's detail beyond a short category).
- The verifier takes its key source and clock as dependencies, so unit tests sign tokens with a local key pair (`createLocalJWKSet`) and never fetch.
- `ID_TOKEN_AUDIENCE` is a fixed string (`ai-trip-planner-api`), not the service URL: the service can't reference its own URL in its Terraform without a cycle, and the audience only has to be unique to this API.
- Deploy workflow: a second `google-github-actions/auth` step with `token_format: id_token`, `id_token_include_email: true` and no credentials file mints the token; the contract step receives it as `CONTRACT_INVITE_CODE` (the runner already sends that variable as the Bearer value, so the runner doesn't change). The token lives an hour, and the check takes minutes. The federated principal needs `roles/iam.serviceAccountOpenIdTokenCreator` on the deploy account, its one new role.
- *Rejected:* `google-auth-library`'s `verifyIdToken` (a large dependency tree); hand-written JWT verification with WebCrypto (security code we'd own for no gain; `jose` has no dependencies); keeping a capped invite code in an Actions secret (a long-lived credential, which the WU-22 Note asks to remove before live).

**D5. Secret Manager, pinned versions.** (WU-23 scope "Secrets")
- Terraform creates one secret, `invite-codes`, with no version, and grants the runtime account `secretAccessor` on that secret only. The service reads it as `INVITE_CODES` at a **pinned version** (`var.invite_codes_version`). The server keeps reading an env var, so it knows nothing of Secret Manager.
- Pinned rather than `latest`: Cloud Run resolves `latest` when an instance starts, so with scale to zero a revocation would take effect at some later cold start. Pinning makes it explicit: add a version, set the variable, plan, apply, and the new revision serves it. The variable holds a number, not an entry, so nothing about holders is in Terraform state any more.
- `invite_codes` and `revoked_invite_codes` (Terraform variables) are removed, and with them the plan-time check against the committed hashes. The server still refuses those codes on Cloud Run (WU-22), which is the check that matters.

**D6. Alerts from the gate's log lines.** (WU-22 Note "Spend and alerts")
- One Cloud Monitoring alert policy with a log-match condition on `jsonPayload.event="gate"` and `outcome` in `revoked`, `expired`, `quota_exhausted`, `rate_limited`, extracting `code` and `outcome` as labels, at most one notification per 5 minutes. It emails one address (`var.alert_email`, in the git-ignored `terraform.tfvars`).
- "Unusual volume for one label" is covered by `rate_limited`: the per-code hourly window is the threshold for unusual. *Rejected:* a separate log-based metric with a per-label threshold, which duplicates the window and adds a custom metric.

**D7. The Firestore emulator in CI's `image` job.** `pnpm test:firestore` starts the Firestore emulator in Docker (a pinned `google-cloud-cli` emulators image), runs the shared store suite against it, including a concurrency case (two store instances, many concurrent takes, never over a limit), and stops it. Like `pnpm test:image` it needs Docker, so it stays out of `pnpm verify` and runs in the existing `image` job, which is already a required check. No new required check. The emulator tests live in `backends/api-nextjs/tests/firestore/`, which the unit and integration projects don't collect, so `pnpm verify` shows no skipped tests.

**D8. Logs: what may appear, proven by a test.** A functional test (api-nextjs, real server process, replay) sends a request whose message and invite code are unique sentinels through extract, recommend and present, captures the server's stdout and stderr, and asserts neither sentinel, nor the code's hash, appears, while the `[llm]` usage lines and gate lines do. The 500 path in `errors.ts` logs the error's name and stack only, not the whole object: `console.error(error)` prints every enumerable property, and some provider errors carry the request body.

**D9. Rollout without breaking the running image.** The new env (`USAGE_STORE=firestore`, the new entry format) would stop today's image from starting, and the new workflow's ID token needs the new image. So: a `usage_store` Terraform variable (default `firestore`), and a scratch-branch proof in the WU-21 way (Q1):
1. **Before the walk-through ends:** you create the secret's first version (in today's format: the `ci-contract` entry), then `terraform apply` from the branch with `usage_store = "memory"` and `extra_deploy_ref` set to a scratch branch. This adds Firestore, the secret, IAM and the alert; the service's env changes only in ways today's image accepts.
2. A push to the scratch branch deploys the new image and runs the contract check with an ID token.
3. Apply again with `usage_store` unset (Firestore), and re-run the scratch deploy: the check now runs against Firestore.
4. After merge: `main` deploys; remove `extra_deploy_ref`, apply, `terraform plan` is clean. Then remove the `ci-contract` entry (a new secret version) and delete the `CONTRACT_INVITE_CODE` secret.

I prepare every command; you run the applies, `gcloud secrets` and `gh secret` commands (as in WU-21 and WU-22).

## 3. File-by-file changes

| File | Change | Purpose |
|---|---|---|
| `backends/api-nextjs/src/http/usage-store.ts` | modify | extract `decide()`; memory store calls it |
| `backends/api-nextjs/src/http/firestore-usage-store.ts` (+ `.test.ts`) | create | D1 REST store, metadata token source, in-process queue |
| `backends/api-nextjs/src/http/access-config.ts` (+ test) | modify | D3 entry options, comments, newlines, `revoked`, `expires`; `REVOKED_INVITE_CODES` refused; `USAGE_STORE=firestore`; `TRUSTED_SERVICE_ACCOUNTS`, `ID_TOKEN_AUDIENCE` |
| `backends/api-nextjs/src/http/id-token.ts` (+ test) | create | D4 verifier on `jose` |
| `backends/api-nextjs/src/http/invite-code.ts` (+ test) | modify | match returns the entry (with options), not just the label |
| `backends/api-nextjs/src/http/gate.ts` (+ test) | modify | per-code limits, `expired`, ID-token path, `invalid_token`; `getGate()` picks the store |
| `backends/api-nextjs/src/http/errors.ts` (+ test) | modify | D8: log name and stack only |
| `backends/api-nextjs/package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` | modify | `jose` (exact pin, catalog) |
| `backends/api-nextjs/tests/support/usage-store-suite.ts`, `fake-firestore.ts` | create | D2 shared suite and fake REST server |
| `backends/api-nextjs/tests/support/id-token.ts` | create | sign test tokens with a local key pair |
| `backends/api-nextjs/tests/firestore/usage-store.emulator.test.ts` | create | D7 suite + concurrency against the emulator |
| `backends/api-nextjs/tests/integration/access-gate.test.ts` | modify | routes accept a valid ID token, refuse others; per-code limits through HTTP |
| `backends/api-nextjs/tests/functional/logging.test.ts` | create | D8 |
| `backends/api-nextjs/vitest.config.ts` (or root config) | modify | keep `tests/firestore/` out of unit/integration projects |
| `scripts/test-firestore.ts`, root `package.json` | create/modify | D7 `pnpm test:firestore` |
| `scripts/invite/plan-invite.ts` (+ test), `scripts/invite-code.ts` | modify | D3 flags; output names the secret |
| `.github/workflows/verify.yml` | modify | `image` job runs `pnpm test:firestore` |
| `.github/workflows/deploy.yml` | modify | D4 ID-token step; no `CONTRACT_INVITE_CODE` secret |
| `infra/main.tf` | modify | enable `firestore`, `secretmanager`, `monitoring` APIs |
| `infra/firestore.tf`, `infra/secrets.tf`, `infra/alerts.tf` | create | D1, D5, D6 |
| `infra/service.tf` | modify | `INVITE_CODES` from the secret; no revoked var; `USAGE_STORE`; `TRUSTED_SERVICE_ACCOUNTS`, `ID_TOKEN_AUDIENCE` |
| `infra/deploy-identity.tf` | modify | `serviceAccountOpenIdTokenCreator` for the federated principal on the deploy account |
| `infra/variables.tf`, `infra/terraform.tfvars.example` | modify | remove entry variables; add `invite_codes_version`, `usage_store`, `id_token_audience`, `alert_email` |
| `scripts/infra-config.test.ts` | modify | pins for the above (AC-GATE-14, -29) |
| `.env.example` | modify | new format, `USAGE_STORE` values, ID-token variables, no `REVOKED_INVITE_CODES` |
| `docs/features/access-gate.md` | modify | AC-GATE-20 to -29; amend -02, -06, -08, -13, -14 |
| `docs/features/production-logs.md` | create | AC-LOG-01, -02 |
| `docs/decisions/0005-hosting-and-access.md` | modify | addendum "Live readiness (WU-23a)" |
| `infra/README.md` | modify | runbook: issue, edit, revoke codes via the secret; Firestore; alerts; logs; CI credential |
| `CLAUDE.md` | modify | §3 `pnpm test:firestore`; §5 access-gate sentence (per-code options, ID tokens); §6.7 `image` row |
| `README.md` | modify | the `image` job row mentions the Firestore emulator check, if the row lists what it runs |
| `docs/work-breakdown.md` | modify | split (plan commit); status and notes (close commit) |

## 4. Acceptance criteria → tests

New and amended ACs go in `docs/features/access-gate.md` and a new `docs/features/production-logs.md`.

| AC | Statement (short) | Test file | Layer |
|---|---|---|---|
| AC-GATE-02 (amended) | revoked (`;revoked`) and expired codes get the same 401 | `gate.test.ts`, `tests/integration/access-gate.test.ts` | unit, integration |
| AC-GATE-06 (amended) | outcomes add `expired`, `invalid_token`; no token in any log | `gate.test.ts` | unit |
| AC-GATE-08 (amended) | hosted live accepts `firestore`, refuses `memory`; `REVOKED_INVITE_CODES` set refuses start | `access-config.test.ts` | unit |
| AC-GATE-14 (amended) | `INVITE_CODES` from the secret at a pinned version; no entry variable; no step reads a `CONTRACT_INVITE_CODE` secret; the contract step gets the ID token, and the ID-token step writes no credentials file | `scripts/infra-config.test.ts` | unit (text) |
| AC-GATE-20 | per-entry options override the service-wide limits; `none` means no lifetime quota; a bad option refuses start, naming the variable only | `access-config.test.ts`, `gate.test.ts` | unit |
| AC-GATE-21 | `expires`: allowed through that UTC day, then 401 logged `expired` | `gate.test.ts` | unit |
| AC-GATE-22 | commas or newlines separate entries; blank and `#` lines ignored | `access-config.test.ts` | unit |
| AC-GATE-23 | a valid Google ID token from a trusted account is allowed under its label, counted only by the global window | `id-token.test.ts`, `gate.test.ts`, `tests/integration/access-gate.test.ts` | unit, integration |
| AC-GATE-24 | wrong signature, `alg`, `iss`, `aud`, expired, unverified or unlisted email: 401 logged `invalid_token` | `id-token.test.ts` | unit |
| AC-GATE-25 | `TRUSTED_SERVICE_ACCOUNTS` needs `ID_TOKEN_AUDIENCE`; malformed entries and labels shared with codes refuse start | `access-config.test.ts` | unit |
| AC-GATE-26 | the Firestore store keeps AC-GATE-07/16/17/18 semantics, across store instances, and never exceeds a limit under concurrency | `usage-store-suite.ts` via `usage-store.test.ts`, `firestore-usage-store.test.ts` (fake), `tests/firestore/usage-store.emulator.test.ts` | unit, integration (emulator) |
| AC-GATE-27 | a store failure fails closed: 500, handler not run | `gate.test.ts`, `tests/integration/access-gate.test.ts` | unit, integration |
| AC-GATE-28 | `invite:new` flags produce an entry the gate accepts with those limits; bad flags refused | `scripts/invite/plan-invite.test.ts` | unit |
| AC-GATE-29 | Terraform: the runtime account reads only the `invite-codes` secret and uses Firestore; the alert matches the four outcomes | `scripts/infra-config.test.ts` | unit (text); `terraform validate` in CI |
| AC-LOG-01 | a full extract → recommend → present run logs no message text, code or hash, and does log usage and gate lines | `tests/functional/logging.test.ts` | functional |
| AC-LOG-02 | an unhandled error is logged as name and stack, not its properties | `errors.test.ts` | unit |

Hosted proof (not a gated test, recorded in Notes): the scratch deploy's contract check passes with the ID token, first on the memory store, then on Firestore (D9).

## 5. Task list

| Task | Owner | Files | Done when (proof) | Depends on |
|---|---|---|---|---|
| T1 ACs | **Opus**: they define the behaviour | `access-gate.md`, `production-logs.md` | every AC above written | — |
| T2 Entry options, expiry, revoked flag, store selection in config | **Opus**: security-critical parsing, shared by T3–T5 | `access-config.ts`, `invite-code.ts`, `gate.ts` (+ tests), `.env.example` | `pnpm --filter @vp/api-nextjs exec vitest run src/http` green | T1 |
| T3 ID-token verifier and gate path | **Opus**: authentication code | `id-token.ts` (+ test), `tests/support/id-token.ts`, `gate.ts`, `access-config.ts`, `package.json`, catalog, lockfile, integration `access-gate.test.ts` | unit + integration green; `pnpm why jose` shows one version | T2 |
| T4 Firestore store, `decide()`, shared suite, fake | **Sonnet**: fully specified by D1, D2 | `usage-store.ts`, `firestore-usage-store.ts` (+ tests), `tests/support/usage-store-suite.ts`, `fake-firestore.ts` | unit green; coverage ≥ 80 % on the new file | T1 (parallel with T2, different files) |
| T5 Emulator script and CI step | **Sonnet**: mechanical, on the `test-image.ts` pattern | `scripts/test-firestore.ts`, root `package.json`, `tests/firestore/*`, vitest config, `verify.yml` | script written; run in CI on the PR (no Docker locally, WU-20 Note) | T4 |
| T6 `invite:new` flags | **Sonnet**: small CLI to spec | `scripts/invite/plan-invite.ts` (+ test), `scripts/invite-code.ts` | `vitest run scripts/invite` green | T2 |
| T7 Logging | **Sonnet**: to spec D8 | `errors.ts` (+ test), `tests/functional/logging.test.ts` | functional test green | T1 (parallel) |
| T8 Terraform and deploy workflow | **Opus**: IAM and rollout order | `infra/*.tf`, `terraform.tfvars.example`, `deploy.yml` | `terraform fmt -check`, `validate` (in CI) | T2, T3 |
| T9 Infra pins | **Opus**: small, follows T8 | `scripts/infra-config.test.ts` | green | T8 |
| T10 Docs | **Opus** | ADR 0005, `infra/README.md`, CLAUDE.md, README | `docs-links` test green | T8 |
| T11 Wire-up and verify | **Opus** | `gate.ts` `getGate()` with the Firestore store | `pnpm verify` green | all |
| T12 Hosted proof (D9) | **you run**, Opus prepares | — | scratch deploy green twice; `terraform plan` clean after merge | T11, the walk-through |

Parallel: T2 ∥ T4 ∥ T7 after T1; T5 after T4; T6 after T2.

## 6. Risks & open questions

**Risks**
- **R1. Cloud Run and a JWT in `Authorization`.** On a public service, Cloud Run should pass the header through untouched, but it does special handling of Google-signed tokens for authenticated services. If it strips the signature, the ID-token check fails on the hosted URL only. The scratch deploy (D9) proves it before merge. Fallback: a capped invite code in the existing secret, with the deletion moved to WU-23c.
- **R2. Rollout order** (D9). Applying the new env before the new image runs would stop the service from starting. Mitigated by `usage_store` and the order above; the old revision keeps serving if a new one fails its startup probe.
- **R3. Firestore REST error codes.** A failed precondition may come back as 400 `FAILED_PRECONDITION` or 409 `ABORTED`. The store retries on both, and the emulator run pins the real behaviour.
- **R4. Alerting cost.** Cloud Monitoring has started charging for alert conditions. I'll check the current price before you apply; one log-match condition should be cents a month at most. If it isn't, the alert drops to a saved Logs Explorer query in the runbook.
- **R5. `jose` and Next's Edge build.** `instrumentation.ts` is compiled for Edge, so it must not import `id-token.ts`. The config module stays free of `jose`.

**Open questions** (my recommendation first)
- **Q1. Prove on a scratch branch before merge** (D9 steps 1–3, as WU-21 did), or merge and fix forward (as WU-22 did)? Recommend the scratch proof: R1 can only be seen on the hosted URL, and a failed `main` deploy blocks every later merge.
- **Q2. Review tier.** `sonnet` by the rule (no contract, rule-catalog or `LlmClient` change). This unit adds an authentication path (D4), so consider `opus` for the unit review only.
- **Q3. Alert email** in the git-ignored `terraform.tfvars` (`alert_email`). OK, or would you rather skip the alert until WU-23c?
- **Q4. `REVOKED_INVITE_CODES` removed** in favour of `;revoked` (D3). OK?
- **Q5. `jose`** as a new production dependency (D4). OK?

## 7. Expected commits

1. `docs(repo): add WU-23a plan` (plan, work-breakdown split, status)
2. `docs(repo): add WU-23a acceptance criteria` (T1)
3. `feat(api-nextjs): add per-code limits, expiry and revocation to invite entries` (T2, T6, `.env.example`)
4. `feat(api-nextjs): accept google id tokens from allowlisted service accounts` (T3, `jose`, lockfile)
5. `feat(api-nextjs): add a firestore usage store` (T4, T5, `verify.yml`)
6. `fix(api-nextjs): keep request content and codes out of logs` (T7)
7. `feat(infra): read invite codes from secret manager and count in firestore` (T8, T9, runbook, ADR addendum, CLAUDE.md, README)
8. `docs(repo): close WU-23a`

No split is required by §10 (no contract change). CLAUDE.md lands in one commit; its §3 and §6.7 lines describe commit 5's script, so it may move there at the walk-through.

## 8. Review tier

`sonnet` for the plan review and the unit review: the unit changes no contract, rule or `LlmClient` interface (CLAUDE.md §12, 4a). See Q2 for an `opus` unit review.
