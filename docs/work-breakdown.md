# Work Breakdown

The implementation plan, as units of work (WUs). `CLAUDE.md` holds the rules; this file holds the plan and its progress.

## How to use this file

- **Do one WU per session** where possible. Start a session by naming the WU (e.g. "start WU-04").
- **Do not start a WU until everything in its Depends-on is `done` on `main`**, i.e. its PR is merged.
- **Each WU runs on its own branch** (`wu/WU-xx-<slug>`) and ends with a pull request that the user merges as a merge commit with semi-linear history (CLAUDE.md §10).
- **Every WU ends with `pnpm verify` green** (from WU-02 onward) and its Definition of done met.
- **When a WU finishes**, set its status to `done`, put its PR link under Commits, and record anything learned under Notes, in a closing `docs(repo): close WU-xx` commit on the WU branch.
- **Each WU follows the `/start-wu` workflow** (CLAUDE.md §12); its plan lives in `docs/plans/WU-xx.md`.
- **Scope changes go here first.** If a WU turns out too big, split it (`WU-09a`, `WU-09b`) rather than letting it sprawl. If a decision changes a rule, update `CLAUDE.md` in the same commit.
- **Status values:** `todo` · `in-progress` · `done` · `blocked (reason)`

## Overview

| ID | Unit | Depends on | Status |
|---|---|---|---|
| WU-01 | Workspace scaffold | — | done |
| WU-02 | Quality gates & test harness | WU-01 | done |
| WU-03 | AI SDK structured-output spike | WU-01 | done |
| WU-04 | Contract wire schemas & generation | WU-02, WU-03 | done |
| WU-05 | Invariant rules & fixtures | WU-04 | todo |
| WU-06 | `api-nextjs` skeleton | WU-04 | todo |
| WU-07 | Contract suite (provider side) | WU-05, WU-06 | todo |
| WU-08 | `LlmClient` with record / replay / mock | WU-03, WU-06 | todo |
| WU-09 | Extract stage + `/v1/trip/extract` | WU-05, WU-07, WU-08 | todo |
| WU-10 | Recommend + critic + `/v1/trip/recommend` | WU-09 | todo |
| WU-11 | Present stream + `/v1/trip/present` | WU-10 | todo |
| WU-12 | Web shell, API client, Pact consumer | WU-04, WU-07 | todo |
| WU-13 | Conversation & clarification UI | WU-09, WU-12 | todo |
| WU-14 | Streamed presentation cards + a11y | WU-11, WU-13 | todo |
| WU-15 | Journeys + integrated gate | WU-14 | todo |
| WU-16 | Portfolio README & architecture docs | WU-15 | todo |

```
WU-01 ─┬─ WU-02 ─┐
       └─ WU-03 ─┴─ WU-04 ─┬─ WU-05 ─┐
                           ├─ WU-06 ─┴─ WU-07 ─┬─ WU-09 ─ WU-10 ─ WU-11 ─┐
                           │   WU-03,06 ─ WU-08 ┘                         │
                           └──────────── WU-12 (needs WU-07) ─ WU-13 ─────┴─ WU-14 ─ WU-15 ─ WU-16
```

---

## WU-01 — Workspace scaffold
**Status:** done · **Depends on:** — · **Commits:** 5461ed4, 038756f

**Goal:** an empty monorepo that installs and typechecks on Windows and POSIX.

**Scope**
- `pnpm-workspace.yaml`, root `package.json` (`engines`, `packageManager`), `.nvmrc`
- `tsconfig.base.json` (strict settings per CLAUDE.md §3), per-package `tsconfig.json`
- Empty packages with correct names and `"type": "module"`: `apps/web-nextjs`, `backends/api-nextjs`, `packages/domain-schema`, `tests/contract`, `journeys`
- `backends/api-fastapi` and `backends/api-go`: README + `.gitkeep` only
- ESLint (flat config) + Prettier at the root; the `no-restricted-imports` rule blocking `@vp/domain-schema/rules` in `apps/`
- `.gitattributes` (`* text=auto eol=lf`), `.gitignore`, `.env.example`, `.editorconfig`
- README stub

**Out of scope:** Next.js app code, test tooling, hooks.

**Definition of done**
- `pnpm install`, `pnpm typecheck` and `pnpm lint` pass with no errors.
- `pnpm why zod` shows a single version (once zod is added).
- A deliberate import of `@vp/domain-schema/rules` from `apps/` fails lint.

**Notes:**
- TypeScript is pinned at **6.0.3**, not 7.x. TS 7 is the native compiler, and `typescript-eslint@8.72.1` peers on `typescript <6.1.0`. Revisit once typescript-eslint supports TS 7.
- TS 6 defaults `types` to `[]`, so each package must opt in, e.g. `"types": ["node"]`.
- Shared tool versions live in the pnpm `catalog:` in `pnpm-workspace.yaml`. WU-04 should add `zod` there to meet the single-version rule. `pnpm why zod` is still deferred until zod exists.
- Import boundaries (`apps/` → no rules or backends; `journeys/` → no workspace imports) live in `eslint.config.js`. `scripts/lint-boundary-probe.mjs` asserts them on every `pnpm lint`. WU-02 may move the probe into Vitest.
- Prettier ignores `*.md` and `.claude/` to keep hand-authored doc tables compact.
- Node 24.22.1 (LTS "Krypton") and pnpm 12.15.0.
- The dev machine has no `python` on PATH. Use node for one-off scripts.

---

## WU-02 — Quality gates & test harness
**Status:** done · **Depends on:** WU-01 · **Commits:** [PR #5](https://github.com/djuba/vacation-planner-polyglot/pull/5)

**Goal:** every gate in CLAUDE.md §6.7 exists and runs, even with almost no tests yet.

**Scope**
- lefthook: `commit-msg` (commitlint with the enforced scope list), `pre-commit` (lint-staged + gitleaks), `pre-push` (`pnpm verify`)
- Vitest projects `unit` / `integration` / `functional` with the file patterns from §6.3; v8 coverage with the thresholds from §6.4
- Playwright config for web functional tests and `journeys/`, with `@axe-core/playwright` installed
- Root scripts: `test:unit`, `test:integration`, `test:functional`, `test:contract`, `test:journeys`, `verify`, `verify:integrated`, `verify:full` (stubs where the target doesn't exist yet, each printing what it skipped)
- One trivial test per Vitest project, to prove the wiring

**Definition of done**
- A non-conventional commit message is rejected; a conventional one with a valid scope is accepted.
- A file containing a fake secret is blocked by gitleaks.
- `pnpm verify` runs end to end and passes.

**Notes:**
- Hooks use lefthook's native staged-file handling, not `lint-staged` (plan Q2). `pre-commit` runs in sequence (eslint → prettier → gitleaks), because the two fixers re-stage the same files. `scripts/test/functional/git-hooks.test.ts` reads `lefthook.yml` via `lefthook dump`, so hook edits are tested.
- **gitleaks is a native-binary prerequisite** (8.30.1; `winget install Gitleaks.Gitleaks`). `scripts/gitleaks.mjs` fails rather than skips when it is missing. CI installs it pinned with a SHA-256 check; bump the version and checksum together in `.github/workflows/verify.yml`.
- pnpm 12 fails install on ignored build scripts, so new dependencies with postinstall scripts need an explicit `allowBuilds` entry in `pnpm-workspace.yaml` (lefthook is `false`; `prepare` installs the hooks).
- Gate stubs (`gen:check`, `test:contract`, `verify:integrated`, `verify:full`) call `scripts/skip.mjs`, which names the WU that makes each one real. Notes on WU-04/06/07/12/15 say what to replace.
- The script is named `audit:prod`, because `pnpm audit` always runs pnpm's built-in command.
- Usage: main/Opus 88 req, 95k out; wu-implementer/Sonnet 4 req, 2k out; wu-reviewer/Sonnet 6 req, 4k out.

---

## WU-03 — AI SDK structured-output spike
**Status:** done · **Depends on:** WU-01 · **Commits:** [PR #3](https://github.com/djuba/vacation-planner-polyglot/pull/3)

**Goal:** remove the biggest technical unknown before building on it. Throwaway code, permanent decision record.

**Questions to answer** (CLAUDE.md §8.2)
1. With the pinned `ai` + `@ai-sdk/anthropic` versions, which API produces structured output (`generateObject`/`streamObject` or `generateText`/`streamText` with `output`)?
2. Does it work on `claude-sonnet-5-5` without a forced `tool_choice` (i.e. native structured output)? Same question for `claude-haiku-5-5`.
3. Does a required-but-nullable schema (§4.4) come back correctly? Are any Zod constructs rejected?
4. How is `effort` passed via provider options? Confirm no sampling params are sent by default.
5. What do a `refusal` and a schema-invalid response look like to our code?
6. Can the provider take a custom `fetch` (needed for record/replay in WU-08)?
7. Does the partial-object stream format work with `useObject` from a plain `text/plain` response?

**Scope:** a script in `spikes/structured-output/` (excluded from `verify`); a handful of live calls (a few cents).

**Definition of done**
- `docs/decisions/0001-structured-output.md` answers all seven questions, with the exact package versions tested.
- Any changes to CLAUDE.md §4.4, §7 or §8 that the findings require are made in the same commit.
- `spikes/` is deleted or clearly marked non-production.

**Notes:**
- All seven answers, the versions tested and the decisions are in [ADR 0001](decisions/0001-structured-output.md). CLAUDE.md §4.4, §7 and §8.2 now state the confirmed rules, and the affected units (WU-04/05/06/08/09/10/11/12/14) carry per-unit notes.
- Versions to pin from WU-04 on: `ai 7.0.154`, `@ai-sdk/anthropic 4.0.89`, `@ai-sdk/react 4.0.158`, `zod 4.6.7`, `react`/`react-dom 19.3.1`.
- The spike is kept at `spikes/structured-output/` (non-production, own lockfile: `pnpm install --ignore-workspace`). A full re-run costs well under $0.10.
- Lessons for recorders: live Anthropic responses carry `anthropic-organization-id` / `anthropic-workspace-id`, so allowlist response headers; and never await a streaming body before returning the response.
- Open item: flexible `month` 1–12 has to become a rule (`DATE_VALID` or a new code), decided in WU-04/05.

---

## WU-04 — Contract wire schemas & generation
**Status:** done · **Depends on:** WU-02, WU-03 · **Commits:** [PR #6](https://github.com/djuba/vacation-planner-polyglot/pull/6)

**Goal:** the language-neutral contract exists as Zod plus committed JSON Schema/OpenAPI artifacts.

**Scope**
- `src/wire/`: `TripProfile`, `ExtractionSchema`, `Traveler`, `DateRange`, `Experience`, `RuleViolation`, request/response envelopes for all four endpoints, `PresentationModel`, `RecommendationSet`, error envelope
- `MIN_POPULATED_FIELDS` and `contractVersion` constants
- `gen` script → `generated/*.schema.json`, `generated/openapi.yaml`, `generated/constants.json`
- Drift check wired into `pnpm verify`
- `exports` map (`./wire`, `./rules`)
- Fixture-builder helper that `safeParse`s every fixture (§6.1)

**Required tests**
- *Unit:* valid and invalid samples per schema
- *Unit:* generated JSON Schema accepts and rejects the same samples as Zod (round-trip parity)

**Definition of done**
- `generated/` is committed, and changing a schema without running `gen` fails `pnpm verify`.
- Wire schemas contain no refinements or transforms (lint rule or test enforces it).

**Notes:**
- Pin the ADR 0001 versions in the pnpm `catalog:`: `ai 7.0.154`, `@ai-sdk/anthropic 4.0.89`, `@ai-sdk/react 4.0.158`, `zod 4.6.7`. See [ADR 0001](decisions/0001-structured-output.md), "Versions tested".
- `ExtractionSchema` follows the CLAUDE.md §4.4 construct rule: no tuple, record, `.optional()`, `.default()`, numeric/length/pattern constraints or string formats. Wire schemas may keep constraints.
- **Decided (with WU-05):** the flexible `month` range (1–12) can't be a constraint on the extraction side, so it became part of `DATE_VALID`, along with `year` 2000–2100 and `durationNights ≥ 1`. See [the WU-04 plan](plans/WU-04.md), A1.
- From WU-02: replace the `gen:check` stub in the root `package.json` with the real drift check. Add `vitest: catalog:` to `domain-schema` devDependencies (WU-02 D12). Prove the 95% coverage gate fires: with the first real source, confirm a deliberately uncovered branch fails `pnpm test:coverage`. WU-02 could not prove it on empty source (WU-02 review #3).
- Both gates were proven by hand: an uncovered branch failed `pnpm test:coverage` (66.66% branches), and a schema change without `gen` failed `gen:check`. `pnpm why zod` shows one version (4.6.7).
- `departureCity` became `departure { city, mode, maxStops }`, with a new `MAX_STOPS_RANGE` rule code. The implementation review ran before this change. See [the plan](plans/WU-04.md), X9–X10.
- Usage: main/Opus 56 req, 96k out; wu-implementer/Sonnet 17 req, 38k out; wu-reviewer/Opus 15 req, 24k out.

---

## WU-05 — Invariant rules & fixtures
**Status:** todo · **Depends on:** WU-04 · **Commits:**

**Goal:** every business invariant is specified language-neutrally and implemented in TS.

**Scope**
- `docs/features/trip-validation.md`: ACs for each rule code and for the populated-field definition
- `rules.md`: the catalog from CLAUDE.md §4.6–4.7
- `src/rules/`: `evaluateRules`, `countPopulatedFields`, `normalize`
- `fixtures/`: input → expected `RuleViolation[]` cases, reused later by the contract suite

**Required tests**
- *Unit:* each rule code with at least one passing and one failing case
- *Unit:* edge cases (age 17/18, equal start/end dates, Feb 29, flexible month-only dates, empty arrays, whitespace-only strings)
- *Unit:* the threshold boundary at 2 and 3 populated fields

**Definition of done**
- Every AC ID from `trip-validation.md` appears in a passing test title.
- Coverage on `domain-schema` is ≥ 95% lines and branches.

**Notes:**
- **Decided in WU-04:** `DATE_VALID` covers fixed dates that aren't real `YYYY-MM-DD` dates, flexible `month` outside 1–12, `year` outside 2000–2100 and `durationNights < 1` (CLAUDE.md §4.6). `params.value` is the offending value; `path` points at the field. See [the WU-04 plan](plans/WU-04.md), A1, and [ADR 0001](decisions/0001-structured-output.md), Q3.
- From WU-04, already fixed in `src/wire/rule-violation.ts`:
  - Age `min`/`max` params are inclusive (child 0–17, adult 18–120).
  - `DATE_NOT_PAST.value` is `YYYY-MM-DD`, `YYYY-MM` or `YYYY`. Decide how a flexible month with no year is compared, and write it into `rules.md`.
  - `path` is a JSON Pointer (`/people/2/age`; `""` for the whole profile).
- From WU-04: new rule `MAX_STOPS_RANGE` (`departure.maxStops` is null or `≥ 0`; `params.value`), and `departure` counts as populated when `city` is non-empty after trimming (CLAUDE.md §4.6–4.7). `normalize` must turn an extraction `departure` into a `Departure`, dropping nulls.
- Optional: a test that reads `rules.md` and fails if its codes differ from `RuleCode`, or if a code has no fixture case. Prose and code otherwise aren't linked mechanically.

---

## WU-06 — `api-nextjs` skeleton
**Status:** todo · **Depends on:** WU-04 · **Commits:**

**Goal:** a running, decoupled API service with the HTTP plumbing and the functional-test harness in place, and no AI yet.

**Scope**
- Next.js app on :4000, Route Handlers only, no pages
- `GET /v1/health`
- Shared handler adapter: parse with the wire schema → 422 envelope; error mapping → 500/502 envelopes
- CORS for `WEB_ORIGIN`
- Config module reading env (model IDs, `LLM_MODE`, origins), validated at startup
- Functional harness: build, start on a random port, wait for health, tear down

**Required tests**
- *Unit:* error mapping, config validation
- *Integration:* handler adapter with real `Request` objects (422 on bad body, CORS headers present)
- *Functional:* `/v1/health` over real HTTP

**Definition of done**
- `src/` (outside `app/`) has no `next/*` imports.
- `pnpm test:functional` boots and tears down the real server cleanly on Windows.

**Notes:**
- CORS must answer the preflight for a JSON `POST` to `/v1/trip/present`: `useObject` sends `content-type: application/json`. See [ADR 0001](decisions/0001-structured-output.md), Q7.
- From WU-04: `tsconfig.json` must extend the base, because contract imports end in `.ts` (`allowImportingTsExtensions`). Check that Next's `transpilePackages` handles those imports; if it doesn't, fall back to `tsx` for `gen` and extensionless imports ([plan](plans/WU-04.md), R1). Cap request body size at the HTTP layer, since `ExtractRequest.message` has no maximum length (A8).
- From WU-02: add `vitest: catalog:` to `api-nextjs` devDependencies. The Vitest `functional` project already collects `test/functional/**/*.test.ts`, with a 60 s test timeout (`vitest.config.ts`).

---

## WU-07 — Contract suite (provider side)
**Status:** todo · **Depends on:** WU-05, WU-06 · **Commits:**

**Goal:** a black-box suite that can prove any backend conforms. Written before the endpoints exist, so it starts red.

**Scope**
- `tests/contract/conformance/`: drives every `domain-schema/fixtures` case at `API_BASE_URL`; validates responses against `generated/*.schema.json` with a JSON Schema validator (not Zod, to stay independent of TS)
- `tests/contract/pact-verify.test.ts`: Pact verifier scaffold reading `contracts/pacts/` (skips cleanly while there are no pact files)
- Stub implementations of the three trip endpoints in `api-nextjs`, returning schema-valid canned responses, so the suite's wiring can be proven green

**Required tests:** the suite itself; plus a deliberately non-conformant response that makes it fail, so we know it can catch errors.

**Definition of done**
- `pnpm test:contract` passes against the `api-nextjs` stubs.
- Any one stub field changed to an invalid value makes the suite fail.

**Notes:**
- From WU-02: replace the `test:contract` stub in the root `package.json`.
- From WU-04: use the same validator setup as `packages/domain-schema/src/wire/parity.test.ts` (Ajv 2020 in strict mode + `ajv-formats`, both in the catalog). Load every `generated/*.schema.json` first, because their `$id`s and `$ref`s are relative.

---

## WU-08 — `LlmClient` with record / replay / mock
**Status:** todo · **Depends on:** WU-03, WU-06 · **Commits:**

**Goal:** a deterministic, cost-free LLM boundary for all tests (CLAUDE.md §6.1, §8.3).

**Scope**
- `LlmClient` interface, shaped by the WU-03 findings
- Anthropic implementation with per-role model selection
- Custom `fetch` for `record` / `replay`: cassettes in `.llm-cassettes/`, keyed by a request-body hash, auth headers stripped
- Cassette miss in `replay` → error with the "re-record" message
- `mock` mode using the AI SDK test model
- Usage/latency logging

**Required tests**
- *Unit:* cassette key stability, header stripping, the miss error
- *Integration:* a real provider call replayed from a committed cassette (one recorded live call)

**Definition of done**
- `grep` finds no API key material or account identifiers (`anthropic-organization-id`, `anthropic-workspace-id`) in `.llm-cassettes/`.
- Gated tests pass with the network disabled.

**Notes:**
- `LlmClient` defaults on every call: `structuredOutputMode: 'outputFormat'`, `maxRetries: 0` (the client owns the single retry), an explicit `maxOutputTokens`, and `effort` but no sampling params. See [ADR 0001](decisions/0001-structured-output.md), Decision.
- Cassette key = hash of the request body string. The SDK version is only in `user-agent`, so patch bumps don't invalidate cassettes.
- Strip `x-api-key`; **allowlist** response headers (they carry `anthropic-organization-id` and `anthropic-workspace-id`).
- Record streams without awaiting the body before returning the response; otherwise the stream arrives as one chunk. Replay should re-emit SSE events as separate chunks.
- Integration tests assert `result.warnings` is empty, so a silently dropped option fails a test.
- Reference implementation: `spikes/structured-output/src/capture-fetch.ts`.

---

## WU-09 — Extract stage + `/v1/trip/extract`
**Status:** todo · **Depends on:** WU-05, WU-07, WU-08 · **Commits:**

**Goal:** natural language → `TripProfile` → `ready` or `needs_clarification`, end to end on the API.

**Scope**
- `docs/features/extraction.md` (ACs, including corrections and unmapped experiences)
- Extraction prompt (stable system prompt; `currentProfile` + `referenceDate` in the user message)
- `ExtractionSchema` → `normalize` → `evaluateRules`
- Clarification-question generation from violation codes
- Replace the WU-07 stub with the real endpoint

**Required tests**
- *Unit:* prompt builder, response routing with a mock client
- *Integration:* `LlmClient` adapter with cassettes for a vague, a complete, a correction and an invalid-age request
- *Functional:* `/extract` over HTTP in replay mode
- *Contract:* conformance suite green for `/extract`

**Definition of done:** all AC IDs from `extraction.md` are covered by passing tests.

**Notes:**
- Check `finishReason === 'content-filter'` before reading `.output`, and map it to `502 LLM_REFUSAL`. Set `maxOutputTokens` for both calls (extraction and clarification). See [ADR 0001](decisions/0001-structured-output.md), Q5.
- From WU-04: `clarificationQuestion` must be non-empty on the wire, so an empty model reply counts as a failure (retry once, then 502). The extraction prompt must cover `departure` (`city`, `mode`, `maxStops`, where `0` = non-stop).

---

## WU-10 — Recommend + critic + `/v1/trip/recommend`
**Status:** todo · **Depends on:** WU-09 · **Commits:**

**Goal:** valid profile → critic-checked recommendations, with honest verification labels.

**Scope**
- `docs/features/recommendation.md`
- `data/routes.json` fixture dataset
- Recommendation stage
- Deterministic critic checks (dates, party fit, route claims against the fixture data)
- LLM critic
- Bounded revise loop (max 2) with `critique.unresolved[]`
- `verification` labels on factual claims

**Required tests**
- *Unit:* each deterministic check; loop cap honored; best-attempt selection
- *Integration:* cassettes for a pass on the first try, a pass after one revision, and still failing after two
- *Functional:* `/recommend` over HTTP
- *Contract:* conformance green

**Definition of done:** no recommendation path can return an unlabeled factual claim (a test asserts this).

**Notes:**
- Same as WU-09: check `finishReason` before `.output`, and set `maxOutputTokens` for recommend and critic. See [ADR 0001](decisions/0001-structured-output.md), Q4–Q5.
- From WU-04: this is where `departure.mode` and `departure.maxStops` start affecting recommendations. `routes.json` only holds non-stop routes, so only `maxStops: 0` can back a `'fixture'` claim; anything else stays `'unverified'`. `maxStops` only means something when `mode` is `plane`, and there is no rule for that in the MVP.

---

## WU-11 — Present stream + `/v1/trip/present`
**Status:** todo · **Depends on:** WU-10 · **Commits:**

**Goal:** a portable partial-JSON stream of `PresentationModel`.

**Scope**
- `docs/features/presentation.md`
- Code-mapped data fields + LLM-written copy
- `text/plain` streaming response with no SDK-specific framing

**Required tests**
- *Unit:* data-field mapping
- *Integration:* stream headers and chunking from the route handler
- *Functional:* full stream over HTTP parses to a valid model
- *Contract:* the conformance stream test passes

**Definition of done:** a non-TS client (e.g. `curl` piped to a JSON validator) can consume the stream; record how in Notes.

**Notes:**
- Serve with `createTextStreamResponse({ stream: toTextStream({ stream: result.stream }) })`; the methods on the `streamText` result are deprecated. Mid-stream errors (`onError`) were not covered by the spike, so test them here. See [ADR 0001](decisions/0001-structured-output.md), Q1/Q7.

---

## WU-12 — Web shell, API client, Pact consumer
**Status:** todo · **Depends on:** WU-04, WU-07 · **Commits:**

**Goal:** the web app exists, talks only to `NEXT_PUBLIC_API_BASE_URL`, and publishes its expectations as a pact.

**Scope**
- Next.js app on :3000: Tailwind, shadcn/ui, base layout
- Typed API client (wire types only)
- Pact consumer tests writing `contracts/pacts/web-nextjs-vacation-api.json`
- Provider verification of that pact against `api-nextjs`

**Required tests**
- *Unit:* client error mapping
- *Integration:* client against `msw`
- *Contract:* pact consumer tests, plus pact verification green in `tests/contract`

**Definition of done:** the web app has no imports from `backends/` or `@vp/domain-schema/rules` (lint enforced), and the pact is verified.

**Notes:**
- Pin `@ai-sdk/react 4.0.158` (and `react`/`react-dom 19.3.1`) to match ADR 0001; use `useObject`, not `experimental_useObject`. See [ADR 0001](decisions/0001-structured-output.md), "Versions tested".
- From WU-04: `tsconfig.json` must extend the base, and Next must handle `.ts` contract imports (same check as WU-06). `apps/` may import wire schemas at runtime (CLAUDE.md §4.2). Leave `currentProfile` out on the first turn; `null` gets a 422. Build every mock with `buildFixture`.
- From WU-02: add `webServer` to `apps/web-nextjs/playwright.config.ts`, and install Chromium in CI (`pnpm exec playwright install --with-deps chromium`) together with the first spec. Once specs exist, drop `--pass-with-no-tests` from the web `test:functional` script so an empty glob cannot pass. Replace the `test:contract` stub if WU-07 has not already. `@axe-core/playwright` is already installed.

---

## WU-13 — Conversation & clarification UI
**Status:** todo · **Depends on:** WU-09, WU-12 · **Commits:**

**Goal:** a user can converse until their profile is `ready`.

**Scope**
- `docs/features/conversation-ui.md`
- Conversation-state reducer (client owns state; sends `currentProfile` each turn)
- Message thread, clarification prompts rendered from violation codes, a profile summary panel
- Loading and error states

**Required tests**
- *Unit:* reducer, components
- *Functional:* Playwright with contract-validated `page.route` mocks for the clarification loop and the error state, plus axe checks

**Definition of done:** all `conversation-ui.md` ACs pass; no axe violations.

**Notes:**

---

## WU-14 — Streamed presentation cards + a11y
**Status:** todo · **Depends on:** WU-11, WU-13 · **Commits:**

**Goal:** recommendations render progressively from the stream.

**Scope**
- Recommend → present flow in the UI
- `useObject` (or the WU-03 equivalent) against `/present`
- Cards tolerate partial data, then run a final `safeParse`
- Verification badges ("unverified" / "from fixture data")

**Required tests**
- *Unit:* partial-render components
- *Functional:* Playwright streaming scenario plus axe checks

**Definition of done:** cards render without errors at every partial stage, which a test asserts.

**Notes:**
- Partial objects contain missing keys **and truncated strings** (e.g. `"Calm tur"`); cards must render both. Use `useObject`'s `onFinish({ object, error })` for the final validation. See [ADR 0001](decisions/0001-structured-output.md), Q7.

---

## WU-15 — Journeys + integrated gate
**Status:** todo · **Depends on:** WU-14 · **Commits:**

**Goal:** prove the integrated system works for a user, and close the gate set.

**Scope**
- `journeys/` workspace (no imports from other workspaces)
- Stack start/stop script (`BACKEND=nextjs`, `LLM_MODE=replay`)
- The four starting journeys from CLAUDE.md §6.6, with area + criticality tags
- `verify:integrated` and `verify:full` made real

**Definition of done**
- `pnpm verify:integrated` passes from a clean checkout with no network access to Anthropic.
- Journeys pass three consecutive runs (flakiness check).

**Notes:**
- From WU-02: replace the `verify:integrated` and `verify:full` stubs. `test:journeys` already runs Playwright; drop its `--pass-with-no-tests` once journeys exist.

---

## WU-16 — Portfolio README & architecture docs
**Status:** todo · **Depends on:** WU-15 · **Commits:**

**Goal:** a reviewer understands the design in five minutes and can run it in ten.

**Scope**
- README: what it is, a quickstart, the architecture diagram, the test pyramid and how to run each gate, the polyglot roadmap, the cost-control approach
- Contract docs (link to `generated/openapi.yaml`)
- Decision records index

**Definition of done:** a fresh clone, following only the README, reaches a green `pnpm verify` and a working UI in replay mode.

**Notes:**

---

## Backlog (not scheduled)
- `api-fastapi` implementation, verified by the same contract suite and journeys
- `api-go` implementation, the same
- Local Docker Pact Broker + `can-i-deploy`
- Opt-in LLM quality evals (`pnpm eval`)
- Performance testing, once a deployed environment exists
