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
| WU-05 | Invariant rules & fixtures | WU-04 | done |
| WU-06 | `api-nextjs` skeleton | WU-04 | done |
| WU-07 | Contract suite (provider side) | WU-05, WU-06 | done |
| WU-08 | `LlmClient` with record / replay / mock | WU-03, WU-06 | done |
| WU-19 | Refocus: spec-first, one implementation | WU-08 | done |
| WU-17 | Input and output limits (prompt-injection hardening) | WU-05, WU-07, WU-19 | done |
| WU-20 | Hosting approach + API container image | WU-08 | done |
| WU-21 | Hosted environment, pre-launch (replay mode) | WU-20 | done |
| WU-09 | Extract stage + `/v1/trip/extract` | WU-05, WU-07, WU-08, WU-17 | done |
| WU-18 | Eval harness + adversarial cases | WU-09 | todo |
| WU-10 | Recommend + critic + `/v1/trip/recommend` | WU-09, WU-18 | todo |
| WU-11 | Present stream + `/v1/trip/present` | WU-10 | todo |
| WU-22 | Invite-code access gate + rate limit | WU-07, WU-20 | todo |
| WU-12 | Web shell, API client, Pact consumer | WU-04, WU-07, WU-22 | todo |
| WU-13 | Conversation & clarification UI | WU-09, WU-12 | todo |
| WU-14 | Streamed presentation cards + a11y | WU-11, WU-13 | todo |
| WU-15 | Journeys + integrated gate | WU-14 | todo |
| WU-16 | Portfolio README & architecture docs | WU-15 | todo |
| WU-23 | Live demo launch | WU-16, WU-21, WU-22 | todo |

```
WU-01 ─┬─ WU-02 ─┐
       └─ WU-03 ─┴─ WU-04 ─┬─ WU-05 ─┐
                           ├─ WU-06 ─┴─ WU-07 ──────────┬─ WU-17 ─ WU-09 ─ WU-18 ─ WU-10 ─ WU-11 ─┐
                           │   WU-03,06 ─ WU-08 ─ WU-19 ┘                                         │
                           └──── WU-22 (needs WU-20) ─ WU-12 ─ WU-13 (needs WU-09) ───────────────┴─ WU-14 ─ WU-15 ─ WU-16 ─┐
                                                                                                                            │
Hosting track:   WU-08 ─ WU-20 ─┬─ WU-21 ─────────────────────────────────────────────────────────────────────────────── WU-23
                                └─ WU-22 (above)
```

WU-17 to WU-23 were added after WU-16 was planned, so their IDs are out of sequence. This table and the sections below list them in build order. WU-19 comes before WU-17: WU-17 depends on it.

**Hosting track (WU-20 to WU-23).** The live demo is for interviewers who ask for it, so it launches last (WU-23), once the UI is complete and the README exists. The pieces that are useful before then come early. WU-20 decides the approach and builds the API image, which CI checks against the contract right away. WU-21 deploys that image to the one hosted environment in replay mode, at no cost and unadvertised, so every later merge proves the deployment still works. WU-22 adds the access gate before WU-12, so the web client and its pact include it from the start. Only WU-23 depends on WU-21, so WU-21 can move later, or fold into WU-23, without changing anything else.

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
- Hooks use lefthook's native staged-file handling, not `lint-staged` (plan Q2). `pre-commit` runs in sequence (eslint → prettier → gitleaks), because the two fixers re-stage the same files. `scripts/tests/functional/git-hooks.test.ts` reads `lefthook.yml` via `lefthook dump`, so hook edits are tested.
- **gitleaks is a native-binary prerequisite** (8.30.1; `winget install Gitleaks.Gitleaks`). `scripts/gitleaks.mjs` fails rather than skips when it is missing. CI installs it pinned with a SHA-256 check; bump the version and checksum together in `.github/workflows/verify.yml`.
- pnpm 12 fails install on ignored build scripts, so new dependencies with postinstall scripts need an explicit `allowBuilds` entry in `pnpm-workspace.yaml` (lefthook is `false`; `prepare` installs the hooks).
- Gate stubs (`gen:check`, `test:contract`, `verify:integrated`, `verify:full`) call `scripts/skip.mjs`, which names the WU that makes each one real. Notes on WU-04/06/07/12/15 say what to replace.
- The script is named `audit:prod`, because `pnpm audit` always runs pnpm's built-in command.
- Usage: main/Opus 88 req, 95k out; wu-implementer/Sonnet 4 req, 2k out; wu-reviewer/Sonnet 6 req, 4k out.
- From WU-06: Next API functional tests now run in the `functional-api` Vitest project, which builds the app once per run (`vitest.config.ts`). The `functional` project no longer collects them.

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
**Status:** done · **Depends on:** WU-04 · **Commits:** [PR #7](https://github.com/djuba/vacation-planner-polyglot/pull/7)

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
- Decided: past dates return `needs_clarification`, and a flexible month with no year means its next occurrence, so it is never past. This replaces the tentative WU-04 A6 wording. Violation order is part of the contract, and "trimmed" means Unicode `White_Space`. See [the plan](plans/WU-05.md), §9.
- Done: the optional check above is in `src/rules/catalog.test.ts`, which also ties ACs and committed `generated/` schemas to the fixtures. `test/rule-fixtures.ts` fails on any key Zod would strip, so a fixture typo can't silently test nothing.
- Fixtures total 129 cases. Widening `CHILD_AGE_RANGE` to 0–18 failed 5 of them.
- Usage: main/Opus 23 req, 56k out; wu-implementer/Sonnet 19 req, 61k out; wu-reviewer/Opus 12 req, 44k out.

---

## WU-06 — `api-nextjs` skeleton
**Status:** done · **Depends on:** WU-04 · **Commits:** [PR #11](https://github.com/djuba/vacation-planner-polyglot/pull/11)

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
- From WU-02: add `vitest: catalog:` to `api-nextjs` devDependencies. The Vitest `functional` project already collects `tests/functional/**/*.test.ts`, with a 60 s test timeout (`vitest.config.ts`).
- From the test-layout refactor: unit tests sit beside the code, and integration and functional tests go in `backends/api-nextjs/tests/{integration,functional}/`. Add `tests` to its `tsconfig.json` `include`.
- Next compiles the contract's `.ts` imports through `transpilePackages`, which closes the WU-04 risk. A 1 MiB request cap is now a contract constant, `MAX_REQUEST_BODY_BYTES`, with a `413 PAYLOAD_TOO_LARGE` response (`CONTRACT_VERSION` 0.2.0).
- Next logs a throw from `register()` and keeps serving, so `src/instrumentation.ts` calls `process.exit(1)`. Keep its `if (process.env.NEXT_RUNTIME === 'nodejs')` form; an early return brings back a Turbopack Edge warning. `register()` doesn't run during a build.
- `next build` now runs in `pnpm verify` and `pre-push`. It ran out of memory once on a 3.9 GB machine with Chrome open, and passed after Chrome closed. See the [plan](plans/WU-06.md), X10.
- Usage: main/Opus 42 req, 99k out; wu-implementer/Sonnet 5 req, 6k out; wu-reviewer/Sonnet 8 req, 7k out.

---

## WU-07 — Contract suite (provider side)
**Status:** done · **Depends on:** WU-05, WU-06 · **Commits:** [PR #12](https://github.com/djuba/vacation-planner-polyglot/pull/12)

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
- From the wire reorganization: when this unit is done, set the Conformance suite row to Built in the README's "How interchangeability is checked" table. The Pact row stays Planned until WU-12.
- From WU-05: the fixtures are in `packages/domain-schema/fixtures/rules/`, and `rules.md` gives the format. Decide how they reach a backend: no endpoint evaluates a given profile deterministically, and `/extract` puts the LLM in between, with cassettes specific to each backend. Canned stubs can't return each fixture's expected violations, so this unit's scope and Definition of done can't both hold for rule fixtures as written. A rule-evaluation endpoint would be a §5 contract change. See [the WU-05 plan](plans/WU-05.md), R1.
- From WU-02: replace the `test:contract` stub in the root `package.json`.
- From WU-04: use the same validator setup as `packages/domain-schema/src/wire/parity.test.ts` (Ajv 2020 in strict mode + `ajv-formats`, both in the catalog). Load every `generated/*.schema.json` first, because their `$id`s and `$ref`s are relative.
- From WU-06: test the 413 boundary over real HTTP using `maxRequestBodyBytes` from `generated/constants.json`; so far it is only proven at the integration layer. Stubs use `postRoute` and `jsonResponse`, and must export `OPTIONS = preflight` or AC-API-10 fails. The harness in `backends/api-nextjs/tests/support` can't be imported from a black-box suite, so this unit needs its own way to start the server. See the [plan](plans/WU-06.md).
- From WU-07: the rule-fixture half of this scope ("drives every `domain-schema/fixtures` case at `API_BASE_URL`") was replaced by per-backend HTTP fixture tests plus a shared JUnit results check, built in WU-09. See [ADR 0002](decisions/0002-rule-parity-across-backends.md).
- Stacked on WU-06 (PR #11) while `main` is on hold; the PR targets `wu/WU-06-api-nextjs-skeleton` and has no CI until retargeted. Pact needs the Visual C++ runtime on Windows (plan X1). Ctrl-C cleanup of the runner was proven by hand only (X6).
- Usage: main/Opus 109 req, 132k out; wu-implementer/Sonnet 22 req, 34k out; wu-reviewer/Opus 11 req, 18k out; wu-reviewer/Sonnet 6 req, 3k out.

---

## WU-08 — `LlmClient` with record / replay / mock
**Status:** done · **Depends on:** WU-03, WU-06 · **Commits:** [PR #13](https://github.com/djuba/vacation-planner-polyglot/pull/13)

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
- From the test-layout refactor: the `LlmClient` interface lives in `backends/api-nextjs/src/usecases/`, and its implementation, the cassette `fetch` and `mock` mode live in `src/llm/` (CLAUDE.md §9, lint enforced).
- `LlmClient` defaults on every call: `structuredOutputMode: 'outputFormat'`, `maxRetries: 0` (the client owns the single retry), an explicit `maxOutputTokens`, and `effort` but no sampling params. See [ADR 0001](decisions/0001-structured-output.md), Decision.
- Cassette key = hash of the request body string. The SDK version is only in `user-agent`, so patch bumps don't invalidate cassettes.
- Strip `x-api-key`; **allowlist** response headers (they carry `anthropic-organization-id` and `anthropic-workspace-id`).
- Record streams without awaiting the body before returning the response; otherwise the stream arrives as one chunk. Replay should re-emit SSE events as separate chunks.
- Integration tests assert `result.warnings` is empty, so a silently dropped option fails a test.
- Reference implementation: `spikes/structured-output/src/capture-fetch.ts`.
- From WU-06: throw `LlmError` from `src/usecases/errors.ts`; the adapter maps it to a 502. Config already provides `llmMode`, `models` and `anthropicApiKey` (`src/config.ts`).
- From WU-07: the mock `LlmClient` must be able to return a given extraction, so WU-09 can run every rule fixture through `/extract` with it. See [ADR 0002](decisions/0002-rule-parity-across-backends.md).
- From security planning: the AI SDK client checks `finishReason === 'content-filter'` but not `'length'`. Output cut off at `maxOutputTokens` fails to parse and is retried once, which repeats the same capped generation, so anyone who can trigger the cap costs two calls instead of one. Decide in this unit: either skip the retry on `'length'` and fail with its own 502 error code, or keep the current behavior and record why.
- Done: built stacked on WU-07 while `main` was on hold, then rebased onto `main` after #11, #12 and #14 merged. See [the plan](plans/WU-08.md) and [`llm-client.md`](features/llm-client.md).
- Decided (the security-planning Note above): output cut off at `maxOutputTokens` is not retried. It fails at once as `LLM_UPSTREAM_ERROR` (502), logged as `OutputTruncatedError`, with no new wire code ([plan](plans/WU-08.md), deviation 12; AC-LLM-19).
- Learned:
  - The SDK passes an error thrown from a custom `fetch` through unwrapped, so a cassette miss reaches the caller as is.
  - `Output.object` validates through Standard Schema, not `safeParse`, so the adapter's own `safeParse` is a real second check.
  - `config.ts` is also compiled for the Edge runtime (through `instrumentation.ts`), so it must stay free of Node APIs.
  - `gitleaks` reads a hash under a field named `key` as an API key, so cassettes carry no `key` field.
  - A live Haiku call takes more than Vitest's default 5 s timeout.
- Usage: main/Opus 148 req, 195k out; wu-implementer/Sonnet 11 req, 14k out; wu-reviewer/Opus 23 req, 29k out.

---

## WU-19 — Refocus: spec-first, one implementation
**Status:** done · **Depends on:** WU-08 · **Commits:** [PR #19](https://github.com/djuba/ai-trip-planner/pull/19)

**Goal:** cut the complexity that only pays off with a second backend, and keep what is worth having with one. The repo becomes a spec-first app with one TypeScript implementation. Portability stays a property of the design, checked by black-box tests, but it is no longer the headline or a planned deliverable. Anything removed here can come back if a second backend is ever built.

**Direction.** Each piece is kept only if it is worth having even when no second backend ever exists:
- **Kept:**
  - `spec/rules.md`, the rule fixtures and `catalog.test.ts`: a business-readable rule catalog with executable examples, kept in sync by a test;
  - `spec/generated/` (OpenAPI, JSON Schema, constants) and `parity.test.ts`: published API docs and schemas any future client can use;
  - the black-box conformance suite and `test:contract:external`, which can also check a deployed backend;
  - the web ↔ API split, Zod and Pact.
- **Removed:** the placeholder backends and every check or gate that exists only to compare backends.

**Patterns to name** in the ADR and README, precisely:
- Specification by Example (executable specification), the idea under BDD. Not full BDD, which means Gherkin scenarios written together with the business.
- Shared test vectors.
- Spec-first (contract-first) API design.
- Consumer-driven contracts.
- Ports and adapters.

**Scope**
- **ADR 0003, "Spec-first, one implementation":**
  - the keep/drop test above and the decision;
  - the patterns;
  - the costs it accepts (the catalog test, the fixture loader);
  - what stays unproven (portability, until a second implementation exists);
  - an **If a second backend is added** section listing what to re-add: cross-backend fixture checks (ADR 0002's JUnit results check and `RULE-FIXTURE` naming), `BACKEND=` selection in `scripts/run-contract.ts` and the journeys stack, a multi-backend `verify:full`, `HealthResponse.backend`, the backend's commit scope, and its README in `backends/`.

  It supersedes ADR 0002's multi-backend parts; mark that in ADR 0002's status.
- **CLAUDE.md:**
  - §1: rewrite the pitch;
  - §2: the layout, without the placeholder folders;
  - §4 intro and §4.1: no "every backend" or "Python/Go generate…" wording;
  - §6.5: conformance framed as a black-box check of the running backend, and the rule-parity paragraph replaced by the plain fixtures-through-`/extract` test;
  - §6.6 and §6.7: no `BACKEND=` or "every implemented backend";
  - §9: drop the placeholder-implementation rule;
  - §10: drop the `api-fastapi`/`api-go` scopes and the "once Python/Go join" aside;
  - the title.
- **Contract: remove `HealthResponse.backend`** (and the `BackendName` schema). With one implementation it identifies nothing.
  - This is a breaking change under CLAUDE.md §4.3: a `feat(domain-schema)!` commit with a `BREAKING CHANGE:` footer and a `contractVersion` bump.
  - Regenerate `spec/generated/`, and update `/v1/health`, its tests, and the conformance health check and its self-test.
  - Update CLAUDE.md §5's endpoint table.
- **README:** describe the project as it is and is intended to be, without the history of what was removed (that lives in ADR 0003):
  - new title and pitch;
  - replace "How interchangeability is checked" with a short **Design and tradeoffs** section on the current choices: why the spec is language-neutral, what that costs, what isn't proven, and the patterns.
- **Remove:**
  - `backends/api-fastapi/` and `backends/api-go/`;
  - `apps/mobile-react-native/` (a README-only placeholder; the mobile idea stays in the backlog);
  - the `api-fastapi` and `api-go` scopes in `commitlint.config.js`.
- **Fix `scripts/tests/functional/git-hooks.test.ts`:** start child processes without inherited `GIT_*` variables. Run from a worktree's `pre-push` hook, its `git init` and `git add` act on the real repository: on 2026-11-10 that set `core.bare = true` and staged a stray `config.ts`.
- **Rename the GitHub repository to `ai-trip-planner`:**
  - the user renames it, or the main agent runs `gh repo rename ai-trip-planner` with explicit approval at that step;
  - update the local remote, the root `package.json` `name`, and the docs that name the repo.

  Existing PR links keep working through GitHub's redirect. Keep the local folder name, because Claude Code transcripts, project memory and `wu-usage.mjs` are keyed by it.

**Required tests**
- *Functional:* `git-hooks.test.ts` runs its git commands with `GIT_DIR` set to a different repository and asserts that repository is untouched.
- Commitlint still rejects an unknown scope (its existing test, if any, updated for the scope list).
- *Unit and contract:* the health response no longer has `backend`, and `contractVersion` matches the bumped value.

**Definition of done**
- `pnpm verify` passes.
- `HealthResponse` has no `backend` field, and `contractVersion` is bumped.
- `git grep -n -i -E "fastapi|api-go|polyglot|every backend"` finds matches only in history: done units, old plans, ADR 0002 and the new ADR.
- The repo is named `ai-trip-planner` on GitHub and the local remote points at it.

**Notes:**
- From refocus planning: removing `HealthResponse.backend` is a contract change, so the review tier is Opus (CLAUDE.md §12, 4a). The breaking change belongs in its own commit, so granularity is likely `fine`: the contract change, the docs and removals, and the hook-test fix as separate checkpoints. Confirm in the plan.
- Takes ADR 0003; WU-17's ADR becomes 0004.
- Done: see [the plan](plans/WU-19.md) and [ADR 0003](decisions/0003-spec-first-one-implementation.md). The contract is now 0.3.0, and `/v1/health` returns `{ status, contractVersion }`. "Provider contract tests" is the name for Pact verification plus the conformance suite, and CLAUDE.md §6.5 says what makes them black-box.
- Decided at plan approval:
  - the product name is "AI Trip Planner";
  - ADR 0001 and `spikes/` are kept as records, so they still match the Definition-of-done grep (deviation 5);
  - the contract version goes to 0.3.0;
  - the `@vp/*` scope stays;
  - the main agent ran `gh repo rename`.
- Learned:
  - Zod `parse()` strips unknown keys, so `toEqual` after `parse` can't catch an extra field. Compare the raw body ([plan](plans/WU-19.md), deviation 1).
  - A worktree's git hooks export `GIT_DIR` and `GIT_INDEX_FILE`, so a test that starts git, gitleaks or commitlint must strip every `GIT_*` variable from the child's env.
  - `gh repo rename` carries the open PR, branch protection and the required `verify` check across, and old URLs redirect. The PR links in done units still use the old name.
- Usage: main/Opus 98 req, 76k out; wu-reviewer/Opus 30 req, 20k out; wu-reviewer/Sonnet 13 req, 6k out.

---

## WU-17 — Input and output limits (prompt-injection hardening)
**Status:** done · **Depends on:** WU-05, WU-07, WU-19 · **Commits:** [PR #20](https://github.com/djuba/ai-trip-planner/pull/20)

**Goal:** limit what prompt injection and API abuse can achieve. Every free-text value the API accepts or returns has a cap. Oversized input is rejected at the wire, and an injected instruction that gets past the model can yield only a few short strings, never free-form output paid for with our tokens.

**Scope**
- Time-boxed spike: how Zod `.max()`, Ajv `maxLength`, Python and Go count string length. Pick one definition (likely Unicode code points) and record it.
- ADR 0004. Resource limits go on the wire (422), while business rules stay off it (CLAUDE.md §4.5). `normalize` discards model-produced values over a cap, so the server never returns a value its own request schema would reject. `ExtractionSchema` gets no caps (ADR 0001). Discard rather than truncate. The length definition from the spike. A **Future hardening** section listing authentication, per-user rate limits and quotas, provider spend limits with a workspace per environment, an on-topic guard step, second-order prompt injection and evals, each pointing to the unit or backlog item that owns it.
- Cap constants exported from the contract and copied into `spec/generated/constants.json` with `MAX_REQUEST_BODY_BYTES`. They cover `message`, short text (`region`, `departure.city`, `gender`), `dateRange.note`, fixed `start`/`end`, and list counts and item lengths (`unmappedExperiences`, `experiences`, `people`). Set them well above any honest value.
- `.max()` / `maxItems` on every string and array reachable from `TripProfile`, and on `ExtractRequest.message`. Every endpoint that accepts a profile gets the caps. Regenerate, and update CLAUDE.md §4.5.
- `normalize` discards over-cap strings and list items and reports what it discarded.
- Conformance checks: 200 at exactly the cap, and 422 at the cap plus one, for `message` and at least one profile field.

**Required tests**
- *Unit:* boundary samples in `samples.ts`, including non-ASCII text, through `schemas.test.ts` and `parity.test.ts`. `normalize` discard cases. The constants appear in `spec/generated/constants.json`.
- *Unit:* language-neutral normalize fixtures in `spec/fixtures/normalize/` (over-cap value in, field discarded out) so later backends match.
- *Contract:* the boundary checks above.

**Definition of done**
- Every string and array reachable from `TripProfile`, and `ExtractRequest.message`, is capped by a shared constant.
- A test asserts that `normalize` output always parses against `TripProfile`, including from over-cap input.
- ADR 0004 is accepted.

**Notes:**
- From security planning: this is a contract change, so the review tier is Opus (CLAUDE.md §12, 4a).
- `RecommendationSet` and `PresentationModel` strings are out of scope here; WU-10 and WU-11 cap them.
- The web input's `maxlength` comes from the same constant (WU-13).
- From WU-19: drop Python and Go from the spike. It still matters for TS: Zod `.max()` and Ajv `maxLength` may count length differently (UTF-16 code units vs code points), and `parity.test.ts` compares them. Settle the definition for those two, and state it in ADR 0004.
- From WU-19: the normalize discard cases can be plain TS unit tests instead of `spec/fixtures/normalize/`, since no other backend needs to match them. Decide in this unit's plan, and record the reason. If you choose plain TS tests, add "normalize fixtures in `spec/fixtures/normalize/`" to ADR 0003's "If a second backend is added" list, or say why ADR 0004 records it instead.
- Done: see [the plan](plans/WU-17.md) and [ADR 0004](decisions/0004-input-and-output-limits.md). The contract is now 0.4.0. Seven caps are exported constants copied into `constants.json`, and lengths count Unicode code points.
- Answering the WU-19 Note above: shared fixtures were chosen, not plain TS tests ([plan](plans/WU-17.md), deviation 1). A discard changes what `/extract` returns, so it is visible to clients and belongs in the spec. [`spec/normalize.md`](../spec/normalize.md) is its source of truth, with profile-only examples in `spec/fixtures/normalize/`. The `discarded` report stays a TS-only log signal, so nothing was added to ADR 0003's list.
- Decided at plan approval: the D2 cap values with no separate gender cap; an over-count list is dropped whole; granularity `fine`, unit tier `opus`.
- Learned:
  - Zod 4 `.max()` and Ajv `maxLength` both count code points. HTML `maxlength` counts UTF-16 units (WU-13 Note).
  - A `\u` escape in a string written through the shell or a Node one-liner can silently become the literal character. That happened to a combining mark and a lone surrogate. Build such strings with `String.fromCodePoint`, or write them with the Edit tool.
- Usage: main/Opus 228 req, 238k out; wu-reviewer/Opus 45 req, 41k out; wu-implementer/Sonnet 9 req, 14k out; wu-reviewer/Sonnet 7 req, 6k out.

---

## WU-20 — Hosting approach + API container image
**Status:** done · **Depends on:** WU-08 · **Commits:** [PR #24](https://github.com/djuba/ai-trip-planner/pull/24)

**Goal:** decide how the app is hosted, and build the API as a container image that CI checks against the contract. The image is useful before anything is hosted: it is the artifact that will be shipped, and CI proves it conforms.

**Direction** (from deployment planning; ADR 0005 records it):
- **Goals.** 1a: a portfolio piece, linked from every job application. Proactive reviewers read the GitHub repo, and a live demo is offered case by case, mostly around interviews. 1b: learn and demonstrate what platform teams usually provide: containers, infrastructure-as-code, CI deploying without stored credentials, and cost controls.
- **Threat model.** The server is stateless, with no user data and nothing to authorize, so the risk worth controlling is LLM spend and abuse of the live API. Structured output and the ADR 0004 caps already limit what abuse yields.
- **Budget.** $5–10 a month in total. Hosting should cost about nothing (scale to zero, free tier), so the budget goes to the LLM.
- **No user accounts.** A product would likely need them (saved trips, history, billing). A portfolio demo doesn't, and a sign-up screen costs a reviewer's attention. A per-recipient invite code (WU-22) plus a provider spend limit (WU-23) bounds the worst case.
- **A later use: a closed beta.** Codes are per recipient partly so the same gate can later admit a small pool of testers, with usage visible per code (by its hash) and each code revocable. Not scheduled (Backlog).
- **No Kubernetes.** Two stateless containers on a managed platform get what Kubernetes would give here.
- **Terraform** for the hosted resources (WU-21), for goal 1b.
- **One hosted environment, built early and launched late.** It runs in replay mode until WU-23 switches it to live. No separate staging.

**Scope**
- **ADR 0005, "Hosting and access":**
  - the goals, threat model, budget and decisions above, plus what would change if this became a product;
  - a cloud comparison, short and with a recommendation: GCP Cloud Run (leaning choice: scale to zero, free tier, streaming, GitHub OIDC through Workload Identity Federation) against AWS (App Runner or ECS Fargate), with a line each on Fly.io, Vercel and a VPS;
  - the gate: per-recipient invite codes checked by the API, chosen over Cloudflare Access (which needs a domain, and is awkward for cross-origin web → API calls);
  - deploy credentials: GitHub Actions authenticates through OIDC, so CI still stores no secrets and the `verify` job has no cloud access;
  - `max instances = 1`: it caps compute and makes an in-memory rate limiter correct;
  - one image across LLM modes, with the cassettes baked in (they are already public in the repo);
  - `NEXT_PUBLIC_API_BASE_URL` is inlined when the web app is built, so the web image is built for its environment. Record the tradeoff;
  - a custom domain is optional; the default `*.run.app` URLs are fine to start.
- Update ADR 0004's Future hardening owners: authentication and rate limits → WU-22, spend limits → WU-23.
- **`backends/api-nextjs/Dockerfile`**, built from the repo root with a `.dockerignore`:
  - multi-stage, `pnpm` with the frozen lockfile, Next's `output: 'standalone'` (the existing `outputFileTracingRoot` covers the monorepo), a non-root user;
  - `LLM_CASSETTE_DIR` points at the baked-in cassettes;
  - no secrets in any layer.
- **CI:** a job that builds the image, runs it in replay mode, and runs `pnpm test:contract:external` against it. Decide in the plan whether it becomes a required check.
- **CLAUDE.md:** §2 (the Dockerfile), §3 (the image build command), §6.7 (the image job, and how deploys get credentials).
- **README** (nothing is hosted yet, so nothing about a demo):
  - "How the design is checked": a row for the container image passing the provider contract tests in CI;
  - Prerequisites: Docker, optional and needed only to build the image, since `pnpm verify` doesn't use it;
  - Commands: building and running the image in replay mode;
  - "Where to find things": the Dockerfile, and ADR 0005 for hosting decisions.

**Required tests**
- *Contract:* `test:contract:external` passes against the running container in CI (`pnpm test:image`). It can also run locally where Docker is available.

**Definition of done**
- ADR 0005 is accepted.
- The image builds from a clean checkout, runs as a non-root user, holds no secrets, and passes the provider contract tests in replay mode.
- `pnpm verify` still needs no Docker.

**Notes:**
- From deployment planning: review tier `sonnet`; likely commits: the ADR, then the image and the CI job.
- Risk: with `output: 'standalone'`, Next warns that `next start` doesn't work. The functional tests boot the built app, so check how they start it and keep them working ([WU-08 plan](plans/WU-08.md), R2, is related: `ai/test` in the bundle).
- Docker is optional locally: `pnpm test:image` needs it, `pnpm verify` doesn't. The dev machine (~3.9 GB RAM) can't run Docker Desktop well, so CI is where the image is built and tested, and the Dockerfile is iterated on a scratch draft PR ([WU-20 plan](plans/WU-20.md), Q1). The image is built for `linux/amd64`.
- Done: see [the plan](plans/WU-20.md) and [ADR 0005](decisions/0005-hosting-and-access.md). `backends/api-nextjs/Dockerfile` builds Next's standalone output (only when `NEXT_OUTPUT=standalone`, so `next start` still serves the tests) and runs as `node` with the cassettes baked in. `pnpm test:image` checks it and runs the provider contract tests against it; the CI `image` job runs that, and is the second required check.
- Decided at plan approval: no Docker on the dev machine, so the image is iterated on a throwaway PR and proven in CI (option A); `image` becomes a required check; review tier `sonnet`.
- Learned:
  - Vitest collects tests from git-ignored directories, including Claude Code worktrees in `.claude/worktrees/`. A concurrent unit's worktree broke `pnpm verify` until `vitest.config.ts` excluded `.claude/**`. A `--exclude` flag on the command line doesn't reach projects that set their own `exclude`.
  - BuildKit warns about a constant `FROM --platform`; set the platform in the build command instead.
  - The image needs every workspace `package.json` for pnpm's frozen install, even when only one project is installed.
- Usage: main/Opus 63 req, 63k out; wu-reviewer/Sonnet 9 req, 10k out.

---

## WU-21 — Hosted environment, pre-launch (replay mode)
**Status:** done · **Depends on:** WU-20 · **Commits:** [PR #27](https://github.com/djuba/ai-trip-planner/pull/27)

**Goal:** a walking skeleton. The API runs in the cloud from the WU-20 image, in replay mode, with no API key and no LLM cost. Every merge to `main` deploys it and runs the provider contract tests against its URL. It isn't a demo, and nothing links to it. No input a person types can hit a cassette: the key is a hash of the exact model request, which includes `referenceDate` (the browser's date) and the whole conversation. So only the contract suite, which sends the recorded requests, exercises it. Its value is that image, Terraform, OIDC, CORS across real origins, streaming through the platform's front end, timeouts and cold starts are all proven long before launch, when problems are cheap to fix. WU-23 turns the same environment into the live demo.

**Scope**
- **`infra/`** Terraform, with remote state in a storage bucket. Bootstrapping the bucket and the project is a documented manual step:
  - the registry, with a cleanup policy that keeps the last few images (to stay in the free tier);
  - the API service: min 0, max 1 instances, a request timeout above the worst-case `/recommend` latency, a startup probe on `/v1/health`, `LLM_MODE=replay`, `WEB_ORIGIN`;
  - a runtime service account with no extra permissions;
  - Workload Identity Federation for this GitHub repo only, with a deploy identity limited to pushing images and deploying the service;
  - a billing budget alert, as an early warning (GCP has no hard spend cap).
- **A deploy workflow** on push to `main`: build and push the image, deploy it, then run `pnpm test:contract:external` against the service URL. It uses OIDC and no stored secrets.
- `infra/README.md`: a runbook covering bootstrap, `terraform plan`/`apply`, rollback to an earlier image, and teardown.
- An `infra` commit scope in `commitlint.config.js` and CLAUDE.md §10. CLAUDE.md §2, §3 and §6.7 updated for `infra/` and the deploy workflow.
- `terraform fmt -check` and `terraform validate` run in CI, not in `pnpm verify`, so the project gate needs no Terraform.
- **README:** `infra/` in "Where to find things", and a "How the design is checked" row for the post-deploy contract check. Describe it as a deployment check, with no URL and nothing that reads as a demo.

**Required tests**
- *Contract:* the post-deploy `test:contract:external` run passes against the hosted URL.

**Definition of done**
- A merge to `main` deploys, and the post-deploy contract check passes.
- `terraform plan` shows no drift after a deploy.
- No long-lived cloud key exists anywhere: no GitHub secret, no key file.
- After a week of normal merges, the bill is about $0. Record the actual figure in Notes.

**Notes:**
- From deployment planning: review tier `sonnet`, but review the IAM bindings closely. Likely commits: Terraform and bootstrap, then the deploy workflow.
- The README does not mention this environment. WU-23 adds the live demo line.
- This unit is deliberately movable: only WU-23 depends on it. If it slips, WU-23 absorbs its scope.
- If WU-22 lands first, the post-deploy contract check needs an invite code. See WU-22's open question.
- From WU-20: the image listens on `PORT` (default 8080) on `0.0.0.0`, defaults to `LLM_MODE=replay` with the cassettes at `/app/.llm-cassettes/api-nextjs`, and `/v1/health` suits the startup probe. Its files are owned by root and read-only to the `node` user, so record mode can't run in the container (it isn't meant to). See [ADR 0005](decisions/0005-hosting-and-access.md).
- Done: see [the plan](plans/WU-21.md), [`infra/README.md`](../infra/README.md) and the [ADR 0005 addendum](decisions/0005-hosting-and-access.md). Terraform in `infra/` (applied by hand) runs the API on Cloud Run in `us-central1`, 0 to 1 instances, replay mode. `.github/workflows/deploy.yml` deploys every merge to `main` by digest through GitHub OIDC and runs the provider contract tests against the hosted URL. The deploy identity can push to one repository, deploy one service and act as one service account. The CI `infra` job checks `terraform fmt` and `validate`.
- Decided at plan approval: dedicated project, tools via `winget`; proof on a scratch branch before merge; `us-central1`; `infra` becomes a required check; the one-week cost follows later; all plan-review fixes. Decided during the build: the three identifiers are Actions secrets (none is a credential), so the public logs mask them; the runbook covers reviewing and applying infra changes; Cloudflare was assessed after the fact (ADR 0005).
- Proven: a non-`main` ref is refused at `auth` ("rejected by the attribute condition"); the scratch deploy passed with 24 contract tests (1 skipped) against the hosted URL; `terraform plan` is clean after a deploy; both service accounts have 0 keys; the service scales to 0 instances when idle. The first deploy from `main` runs when this PR merges.
- Learned:
  - GitHub prints a step's `env:` values in the log header, so only secrets are masked from the first line. The Workload Identity provider's name holds the project number, and new-style Cloud Run URLs (`https://<service>-<project number>.<region>.run.app`) can be derived from it. `gcloud run services update` prints that form, not `status.url`.
  - The Budget API, called with user credentials, needs a quota project, and it has to be enabled before Terraform's first apply.
  - Service accounts need `depends_on` the IAM API's enablement, or a first apply can race it.
  - Google's `hello` sample answers `/v1/health`, so it works as a placeholder image behind the startup probe.
- Cost: $0.00 on 2026-11-13, the day the environment was created (Billing → Reports, filtered to the project). The one-week figure follows in a small `docs(repo)` change (plan Q5).
- Usage: main/Opus 118 req, 123k out; wu-reviewer/Sonnet 13 req, 20k out.

---

## WU-09 — Extract stage + `/v1/trip/extract`
**Status:** done · **Depends on:** WU-05, WU-07, WU-08, WU-17 · **Commits:** [PR #26](https://github.com/djuba/ai-trip-planner/pull/26)

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
- From the wire reorganization: when this unit is done, set the Extract and Clarify rows to Built in the README's "From natural language to recommendations" table.
- Check `finishReason === 'content-filter'` before reading `.output`, and map it to `502 LLM_REFUSAL`. Set `maxOutputTokens` for both calls (extraction and clarification). See [ADR 0001](decisions/0001-structured-output.md), Q5.
- From WU-05: past dates return `needs_clarification` through `DATE_NOT_PAST`, never an HTTP error. A flexible month with no year means its next occurrence, and the rules never flag it as past. Violation order is part of the contract (`rules.md`). `normalize` doesn't trim strings; `evaluateRules` judges them.
- From WU-04: `clarificationQuestion` must be non-empty on the wire, so an empty model reply counts as a failure (retry once, then 502). The extraction prompt must cover `departure` (`city`, `mode`, `maxStops`, where `0` = non-stop).
- From WU-06: the new route must export `OPTIONS = preflight` (AC-API-10), and goes in the functional tests.
- From WU-07: run every rule fixture through `/extract` at the integration layer, with the mock `LlmClient` returning the fixture's profile. Compare violations exactly and in order, assert the normalized profile equals the fixture's profile, and title each test `RULE-FIXTURE <file>/<id>`. Write a JUnit report and build `tests/contract/rule-results.ts`, which fails unless every fixture `id` passed. See [ADR 0002](decisions/0002-rule-parity-across-backends.md).
- From WU-07: add conformance routing checks (`needs_clarification` vs `ready`) to `tests/contract/conformance/`, with replay cassettes. Record cassettes for the AC-CONTRACT-05 `/extract` request, then delete the `/extract` stub and its `src/stubs/canned.ts` entry. See [`contract-suite.md`](features/contract-suite.md).
- From security planning: treat every user-controlled string as untrusted data in prompts. That covers the message, the client-supplied `currentProfile` and the violation params. They go only in the user message, serialized as JSON in a clearly delimited data block, and the static system prompt says the block is data, not instructions. Build this as one shared prompt-data helper that WU-10 and WU-11 reuse. Unit-test each prompt builder: every profile string appears only inside the data block.
- From security planning: size the extraction call's `maxOutputTokens` from the WU-17 caps (every field at its cap, plus a margin), and the clarification call's for a question of a sentence or two. Log what `normalize` discarded as a security signal.
- From security planning: add a containment test, an integration test with a cassette recorded from a real injection attempt (a message telling the model to put off-topic content in free-text fields and in the clarification question). Assert the response is wire-valid, nothing exceeds a cap, and the clarification question is within its limit. It proves containment, not that the model resists; WU-18 measures that.
- From WU-20: cassettes the contract suite replays are keyed on the model IDs in `CONTRACT_TEST_ENV` (`backends/api-nextjs/tests/support/api-server.ts`). `pnpm test:image` and the README's hand-run `docker run` give the container the same IDs, so record the contract cassettes with them. This is also the first unit to bundle `ai/test` into the server (WU-08 R2); the CI `image` job will show whether Next's standalone trace copes with it.
- From WU-08: `tests/support/api-server.ts`'s `baseEnv` uses `test-model-*` model IDs and forces `LLM_MODE=replay`, and `pnpm record:cassettes` runs only the integration project. The model is part of the cassette key, so before recording any server-side cassette, switch `baseEnv` to the real §8.1 IDs and give recording a path to the spawned server. Recommended: `startApi` passes record mode and the key through when `recordingAllowed()`, and `record:cassettes` accepts `--project functional-api`. See [`llm-client.md`](features/llm-client.md) and the WU-08 implementation review (#3).
- From WU-08: the routes need a seam to inject a mock `LlmClient` (`createMockLlmClient` + `mockObject` from `src/llm`) for the rule-fixture test. Build the real client with `createLlmClient(getConfig())`. An unresolvable cassette directory now fails there, not at startup ([plan](plans/WU-08.md), deviation 3).
- From WU-08: this is the first unit where `next build` bundles `src/llm`, including `ai/test` through `mock.ts`. If that breaks the build or the bundle, keep `mock.ts` out of the route's import graph ([plan](plans/WU-08.md), R2).
- From WU-19: this replaces the WU-07 rule-fixture note above. Still run every rule fixture through `/extract` with the mock `LlmClient`: assert the normalized profile is unchanged, and compare violations exactly and in order. Drop the `RULE-FIXTURE <file>/<id>` naming, the JUnit report and `tests/contract/rule-results.ts`; they exist only to compare backends (ADR 0003, "If a second backend is added").
- From WU-19: when the fixtures-through-`/extract` test lands, set the "Rule examples" row to Built in the README's "How the design is checked" table.
- From WU-17: also run every `spec/fixtures/normalize/` case through `/extract`, with the mock `LlmClient` returning the case's `extraction`, and assert the response profile equals `expectedProfile`. Use the same harness as the rule fixtures. When it lands, set the "Normalize examples" row to Built in the README's "How the design is checked" table. See [`spec/normalize.md`](../spec/normalize.md) and [ADR 0004](decisions/0004-input-and-output-limits.md).
- From WU-17: the conformance suite's AC-LIMITS-11 checks (`tests/contract/conformance/limits.test.ts`) send `/extract` a message at `maxMessageLength`, and a `currentProfile` with `region` at its cap and with `people` at `maxPeople`, and require a schema-valid 200. Once the stub is gone, each of these is a real model call, so record replay cassettes for them, or the contract gate fails on a cassette miss. Consider changing the at-cap text in `checks/limits.ts` to a realistic request padded to the cap with astral characters, so the recorded answer is meaningful. The probe must still count only in code points (WU-17 unit review #1).
- Done: see [the plan](plans/WU-09.md) and [`extraction.md`](features/extraction.md). `/v1/trip/extract` runs extract → `normalize` → rules → `ready`, or a second fast call writes `clarificationQuestion`. The contract is now 0.5.0: `clarificationQuestion` is capped at `MAX_CLARIFICATION_QUESTION_LENGTH` (300 code points), and the model-only `ClarificationOutput` is unconstrained. `LlmObjectRequest` gained an optional `accept` check, which runs after `schema`; a failure is retried once, then a 502. Every rule and normalize fixture runs through `/extract`, and 14 live-recorded cassettes back the integration, functional and contract layers.
- Decided at plan approval: cap 300; 0.5.0 as a non-breaking `feat`; the `accept` option; the main agent records cassettes; the realistic padded message probe; all six plan-review fixes.
- Learned:
  - Server-side cassettes record with `pnpm record:cassettes --project functional-api …` or `--contract`. Gated runs still force replay.
  - `CONTRACT_TEST_ENV` (`tests/support/api-server.ts`) now holds the real §8.1 model IDs. `baseEnv`, `pnpm test:image` and the README's `docker run` all use it, so one set of cassettes serves every layer and the image.
  - Two requests that extract to the same profile share their clarification cassette.
  - `next build` bundles `src/llm`, including `ai/test` through `mock.ts`, without trouble (WU-08 R2). So does the standalone image: the CI `image` job passed on PR #26, including the contract suite against the container in replay.
  - In the recorded injection run the model resisted, so that test proves wire validity, not that the caps fire; the mock-based tests prove the caps.
  - A low-memory machine kills background `pnpm verify` runs while another session builds. Run the gate in the foreground, one session at a time.
- Usage: main/Opus 127 req, 123k out; wu-implementer/Sonnet 35 req, 38k out; wu-reviewer/Opus 31 req, 33k out.

---

## WU-18 — Eval harness + adversarial cases
**Status:** todo · **Depends on:** WU-09 · **Commits:**

**Goal:** measure with live calls how well the prompts resist prompt injection and off-topic use, and how good extraction is (CLAUDE.md §6.8). It runs before WU-10, so the recommend and present prompts are written with these checks already in place.

**Scope**
- `pnpm eval`: opt-in, live and never part of a gate. It requires the same explicit opt-in as other live calls and reports token usage and cost.
- Extraction quality cases, drawn from the `extraction.md` ACs
- Adversarial cases: instructions in the message to put off-topic content in free-text fields or the clarification question, and instructions planted in `currentProfile` strings
- Deterministic scoring first: values over a cap or discarded by `normalize`, field content unrelated to its purpose (for example a `region` that isn't a place), a clarification question that doesn't address the violations. An LLM judge only where code can't decide.
- A results record per run (date, models, prompt hash, scores), so runs can be compared

**Required tests**
- *Unit:* each scorer, against hand-written passing and failing outputs; the eval refuses to run without the opt-in.

**Definition of done:** `pnpm eval` runs the extraction and adversarial sets, no gate runs it, and the first run's results are recorded in Notes.

**Notes:**
- From security planning: WU-10 and WU-11 add cases for their stages (profile strings in `/recommend`, `recommendations` in `/present`).
- Evals don't block merges, so a prompt change can weaken injection resistance between runs. The gated containment (WU-17 caps, the WU-09 prompt-data helper, output checks) bounds the damage either way.
- Every run costs money, so get approval for its budget first.
- If the results show the model is often fooled, consider the on-topic guard step from ADR 0004's Future hardening section.
- From WU-09: in the recorded containment case (AC-EXTRACT-14) the model ignored the injection, so no cap fired. Keep at least one adversarial case that does land over-cap text in a free-text field or the clarification question, so the eval shows discarding and the `accept` check working against real output. Record any cassettes with the model IDs in `CONTRACT_TEST_ENV` ([WU-09 plan](plans/WU-09.md), unit review #3).

---

## WU-10 — Recommend + critic + `/v1/trip/recommend`
**Status:** todo · **Depends on:** WU-09, WU-18 · **Commits:**

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
- From the wire reorganization: when this unit is done, set the Recommend and Critique rows to Built in the README's "From natural language to recommendations" table.
- Same as WU-09: check `finishReason` before `.output`, and set `maxOutputTokens` for recommend and critic. See [ADR 0001](decisions/0001-structured-output.md), Q4–Q5.
- From WU-05: define what `/recommend` does with a profile that isn't `ready`; CLAUDE.md §5 and §7 don't say. Read a month-only date as its next occurrence.
- From WU-04: this is where `departure.mode` and `departure.maxStops` start affecting recommendations. `routes.json` only holds non-stop routes, so only `maxStops: 0` can back a `'fixture'` claim; anything else stays `'unverified'`. `maxStops` only means something when `mode` is `plane`, and there is no rule for that in the MVP.
- From WU-06: the new route must export `OPTIONS = preflight` (AC-API-10), and goes in the functional tests.
- From WU-07: record cassettes for the AC-CONTRACT-05 `/recommend` request, then delete the `/recommend` stub and its `canned.ts` entry.
- From security planning: the client can post any profile to `/recommend` directly, so its strings are untrusted here even though WU-17 caps them. Pass the profile to the recommend and critic prompts through the WU-09 prompt-data helper.
- From security planning: cap `RecommendationSet` strings the same way WU-17 caps the profile. The schema given to the model stays unconstrained (ADR 0001), the wire schema carries the caps (`/present` takes `recommendations` back from the client), and code discards over-cap model values before responding. Size `maxOutputTokens` from those caps.
- From security planning: add a containment test with an injection cassette (instructions planted in profile strings), and add `/recommend` cases to WU-18's eval set.
- From WU-17: the conformance suite's AC-LIMITS-11 checks post `/recommend` a profile with `region` at its cap and with `people` at `maxPeople`, and require a schema-valid 200. Once the stub is gone, record replay cassettes for both probes, including the critic calls, or the contract gate fails on a cassette miss (WU-17 unit review #1).
- From deployment planning: record the worst-case live `/recommend` latency (two revise cycles) and the tokens per stage from the usage logs. WU-21 sizes the request timeout from the latency, and WU-23 sets the spend and rate limits from the tokens.
- From WU-21: the hosted timeout is `request_timeout_seconds` in `infra/variables.tf` (300 s today). If the worst-case latency approaches it, raise it and apply by hand ([`infra/README.md`](../infra/README.md), "Reviewing and applying infra changes"). Any `/recommend` cassette the contract suite replays must use the `CONTRACT_TEST_ENV` model IDs, which the hosted service also runs (`scripts/infra-config.test.ts`).
- From WU-09: reuse `dataBlock` and `DATA_BLOCK_RULE` from `backends/api-nextjs/src/usecases/prompts/prompt-data.ts` for every client-supplied string, and keep system prompts constant. Put output caps in exported constants (CLAUDE.md §4.5). Use `LlmObjectRequest.accept` for checks the model's schema can't express. Derive `maxOutputTokens` from the caps, as `src/usecases/token-budget.ts` does, at 2 tokens per code point. Record the contract cassettes with `pnpm record:cassettes --contract` ([WU-09 plan](plans/WU-09.md)).

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
- From the wire reorganization: when this unit is done, set the Present row to Built in the README's "From natural language to recommendations" table.
- Serve with `createTextStreamResponse({ stream: toTextStream({ stream: result.stream }) })`; the methods on the `streamText` result are deprecated. Mid-stream errors (`onError`) were not covered by the spike, so test them here. See [ADR 0001](decisions/0001-structured-output.md), Q1/Q7.
- From WU-06: the new route must export `OPTIONS = preflight` (AC-API-10), and goes in the functional tests. `route()` passes a streaming `Response` through unbuffered (AC-API-12), so return the stream response directly.
- From WU-07: record cassettes for the AC-CONTRACT-06 `/present` request, then delete the `/present` stub and `src/stubs/canned.ts`.
- From security planning: the profile and `recommendations` in the request are client-supplied, so they go into the prompt through the WU-09 prompt-data helper. The stream reaches the client as it's generated, so over-cap text can't be discarded afterwards. `maxOutputTokens` is the main bound here, with per-field caps on the `PresentationModel` wire schema checked by the final parse. Add a containment test and `/present` cases to WU-18's eval set.
- From WU-08: add `streamObject` to the `LlmClient` interface here, together with its mid-stream error semantics. That changes the interface, so this unit's review tier is `opus`. Record and replay of SSE are already proven (AC-LLM-12, [`llm-client.md`](features/llm-client.md)).
- From WU-09: the shared prompt-data helper is `backends/api-nextjs/src/usecases/prompts/prompt-data.ts` (`dataBlock`, `DATA_BLOCK_RULE`). Record the contract cassettes with `pnpm record:cassettes --contract`. `createExtractPost` in `src/http/extract.ts` shows the injected-runtime route pattern, which flushes recordings in a `finally` ([WU-09 plan](plans/WU-09.md)).
- From WU-17: the conformance suite's AC-LIMITS-11 checks post `/present` a profile with `region` at its cap and with `people` at `maxPeople`, and require a stream that ends in a valid `PresentationModel`. Once the stub is gone, record replay cassettes for both probes, or the contract gate fails on a cassette miss (WU-17 unit review #1).
- From WU-08: the recorder writes any 2xx response. An SSE body can still fail partway through (`event: error`) after a 200, so skip writing a stream cassette that contains `event: error` or has no `message_stop` (WU-08 implementation review #6).
- From deployment planning: if WU-21 is done, its post-deploy contract check covers the `/present` stream through the platform's front end. If the stream arrives as a single chunk there, fix it in this unit.

---

## WU-22 — Invite-code access gate + rate limit
**Status:** todo · **Depends on:** WU-07, WU-20 · **Commits:**

**Goal:** only people given an invite code can use the trip endpoints, and each code has a rate limit. This is the access control ADR 0005 chooses in place of user accounts. It lands before WU-12, so the web client and its pact include it from the start.

**Scope**
- `docs/features/access-gate.md` (ACs).
- **Contract** (a breaking change: requests now need a header):
  - the trip endpoints require `Authorization: Bearer <invite code>`, declared as a security scheme in `openapi.yaml`;
  - a missing or unknown code → `401` with a new error code; over the limit → `429` with a new error code and a `Retry-After` header;
  - `GET /v1/health` and the CORS preflight stay open, and CORS allows the `Authorization` header;
  - CLAUDE.md §5's status codes and endpoint table; a `feat(domain-schema)!` commit and a `contractVersion` bump.
- **api-nextjs:**
  - the codes come from an env var, compared in constant time and never logged (log a short hash of the code instead);
  - the gate fails closed: in `LLM_MODE=live`, the server refuses to start without codes;
  - an in-memory, per-code rate limiter with an injected clock (CLAUDE.md §6.1), correct because ADR 0005 sets `max instances = 1`. The limits are config, set by WU-23 from measured cost.
- `.env.example` and the test harness supply a test code.
- **Conformance:** checks for 401 without a code and with an unknown one, and for health staying open. The provider tests take the code from the environment.

**Required tests**
- *Unit:* code matching, the rate limiter's window and reset with a fake clock, fail-closed startup.
- *Integration:* route handlers return 401 and 429 with the error body; the preflight allows `Authorization`.
- *Contract:* the conformance checks above.

**Definition of done**
- No trip endpoint can be reached without a valid code. A test covers every route, so a new route can't skip the gate.
- `contractVersion` is bumped, and `spec/generated/` is regenerated.

**Notes:**
- From deployment planning: contract change, so the review tier is `opus` (CLAUDE.md §12, 4a). The contract change goes in its own commit (required), then the server side.
- Open question for the plan: how the post-deploy contract check (WU-21) gets a code without CI holding a secret that matters. One option is a code with no live value, stored as a GitHub secret. In replay mode it can't spend anything. Another is to put the check behind a manual step. Decide and record it in ADR 0005.
- From WU-21: the deploy workflow already reads three non-credential identifiers from Actions secrets (ADR 0005 addendum). A code with no live value would be a fourth, withheld from every step but the contract check. The hosted service also needs the codes' hashes: an env var in `infra/service.tf`, or a Secret Manager secret that WU-23 needs anyway.
- Revoking a code means removing it from the secret and redeploying. That's fine for a handful of interviewers.
- An invite link (`?invite=<code>`) is a web concern (WU-13). A code in a URL can end up in logs, which is acceptable for this threat model; say so in the ADR.

---

## WU-12 — Web shell, API client, Pact consumer
**Status:** todo · **Depends on:** WU-04, WU-07, WU-22 · **Commits:**

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
- From the wire reorganization: when this unit is done, set the Pact row to Built in the README's "How interchangeability is checked" table.
- From WU-19: that table is now "How the design is checked", under the README's "Design and tradeoffs" section. Set its Pact row to Built there.
- Pin `@ai-sdk/react 4.0.158` (and `react`/`react-dom 19.3.1`) to match ADR 0001; use `useObject`, not `experimental_useObject`. See [ADR 0001](decisions/0001-structured-output.md), "Versions tested".
- From WU-04: `tsconfig.json` must extend the base, and Next must handle `.ts` contract imports (same check as WU-06). `apps/` may import wire schemas at runtime (CLAUDE.md §4.2). Leave `currentProfile` out on the first turn; `null` gets a 422. Build every mock with `buildFixture`.
- From WU-02: add `webServer` to `apps/web-nextjs/playwright.config.ts`, and install Chromium in CI (`pnpm exec playwright install --with-deps chromium`) together with the first spec. Once specs exist, drop `--pass-with-no-tests` from the web `test:functional` script so an empty glob cannot pass. Replace the `test:contract` stub if WU-07 has not already. `@axe-core/playwright` is already installed.
- From WU-06: the `.ts` contract imports work under Turbopack with `transpilePackages`. Set `agentRules: false` in `next.config`, or `next dev` writes an `AGENTS.md` when it detects a coding agent. Treat a 413 (`PAYLOAD_TOO_LARGE`) as "message too long". See the [plan](plans/WU-06.md).
- From WU-07: the Pact consumer writes `contracts/pacts/web-nextjs-vacation-api.json` for provider `vacation-api`. `tests/contract/pact-verify.test.ts` picks it up with no change, and its skip goes away. On Windows, Pact needs the Visual C++ runtime (README Prerequisites).
- From deployment planning: the API client sends `Authorization: Bearer <invite code>` (WU-22) and maps 401 and 429 to typed errors. Include the header in the pact interactions.
- From deployment planning: add `apps/web-nextjs/Dockerfile` on the WU-20 pattern. `NEXT_PUBLIC_API_BASE_URL` is a build argument, because Next inlines it at build time. If WU-21 is done, add the web service to `infra/`, point the API's `WEB_ORIGIN` at it, and extend the deploy workflow.

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
- From security planning: set the message input's `maxlength` from WU-17's shared cap constant, and show the remaining length, so an honest user never gets a 422.
- From WU-17: the cap is `MAX_MESSAGE_LENGTH`, counted in Unicode code points. HTML `maxlength` counts UTF-16 units, so on its own it would stop a message of emoji at half the real limit. Count and show the remaining length with `codePointLength` from `@vp/domain-schema/wire`, and test a message of emoji at the cap. See [ADR 0004](decisions/0004-input-and-output-limits.md) §3.
- From deployment planning: an invite-code entry state before the conversation, kept for the browser session. An invite link (`?invite=<code>`) fills it in and then removes the code from the address bar. The UI shows 401 ("this code isn't valid") and 429 ("try again in …" from `Retry-After`) as recoverable states, with axe checks.
- From WU-09: `clarificationQuestion` is plain text of at most `MAX_CLARIFICATION_QUESTION_LENGTH` (300 code points), and it is model-written. Render it as text, never as HTML or markdown. Show `violations` from `code` + `params`, not from the question. The response's `profile` is the full updated profile, so replace the client's copy with it on every turn ([`extraction.md`](features/extraction.md)).

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
- `tests/journeys/` workspace (no imports from other workspaces)
- Stack start/stop script (`BACKEND=nextjs`, `LLM_MODE=replay`)
- The four starting journeys from CLAUDE.md §6.6, with area + criticality tags
- `verify:integrated` and `verify:full` made real

**Definition of done**
- `pnpm verify:integrated` passes from a clean checkout with no network access to Anthropic.
- Journeys pass three consecutive runs (flakiness check).

**Notes:**
- From the wire reorganization: when this unit is done, set the Journeys row to Built in the README's "How interchangeability is checked" table. WU-16 may then drop the Status column.
- From WU-02: replace the `verify:integrated` and `verify:full` stubs. `test:journeys` already runs Playwright; drop its `--pass-with-no-tests` once journeys exist.
- From WU-07: add `BACKEND=` selection to `scripts/run-contract.ts`; today it only starts api-nextjs, and `--external` covers any other backend.
- From WU-19: this replaces the WU-07 `BACKEND=` note above. The stack script starts `api-nextjs` only, and `verify:full` runs journeys `@full` plus the provider contract tests against `api-nextjs`. The "How interchangeability is checked" table from the wire-reorganization note is replaced by WU-19's README section, so update that section instead. The Scope's `BACKEND=nextjs` is dropped too: the stack script has no `BACKEND` variable (ADR 0003, "If a second backend is added").
- From deployment planning: the stack script supplies an invite code (WU-22), and journeys enter it the way a user would. Decide in the plan whether the stack can also run from the WU-20 images ("test what you ship"). The default path must still need no Docker.
- From WU-08: add `record:cassettes --prune` to delete cassettes no test replays any more ([plan](plans/WU-08.md), R5). A dead-proxy "network off" check can't cover `test:contract`: Pact's native verifier routes even loopback requests through the proxy and ignores `NO_PROXY`, so use a real network-off run ([plan](plans/WU-08.md), deviation 7).

---

## WU-16 — Portfolio README & architecture docs
**Status:** todo · **Depends on:** WU-15 · **Commits:**

**Goal:** a reviewer understands the design in five minutes and can run it in ten.

**Scope**
- README: what it is, a quickstart, the architecture diagram, the test pyramid and how to run each gate, the design-and-tradeoffs section from WU-19, the cost-control approach
- Contract docs (link to `spec/generated/openapi.yaml`)
- Decision records index

**Definition of done:** a fresh clone, following only the README, reaches a green `pnpm verify` and a working UI in replay mode.

**Notes:**
- From deployment planning: don't link to or offer the hosted environment. Describing the deployment pipeline and its checks is fine (WU-20, WU-21). WU-23 adds the "live demo available on request" line once the demo works. Do cover the hosting approach as a design decision (ADR 0005) and the cost-control approach.

---

## WU-23 — Live demo launch
**Status:** todo · **Depends on:** WU-16, WU-21, WU-22 · **Commits:**

**Goal:** the hosted environment becomes a live demo, offered on request to interviewers, with a worst-case monthly cost within the $5–10 budget.

**Scope**
- **Cost first:** from the WU-10 usage figures and one recorded full session, work out the cost per demo session. Size the rate limits and the spend limit from it, and record the arithmetic in ADR 0005.
- **Anthropic:** a dedicated workspace for the demo with a hard spend limit, and its own API key. This is an account setting, documented in the runbook.
- **Secrets:** Terraform creates the Secret Manager secrets, but their values (API key, invite codes) are added by hand, so they never appear in Terraform state, CI or the repo. The runtime service account can read them.
- **Switch to live:** `LLM_MODE=live`, the model IDs (consider `MODEL_CRITIC` on Haiku for cost), and the WU-22 rate limits. The gate fails closed (WU-22).
- **Release trigger:** live deploys run from a manual workflow (or a tag), after `pnpm verify:integrated` passes locally, through a GitHub Environment that needs your approval. Merges to `main` no longer deploy straight to live. Record in ADR 0005 how the replay-mode contract check fits from now on.
- **Logging review:** production logs carry usage, latency, discard signals and code hashes, never message content or codes.
- **Runbook** (`infra/README.md`): issue and revoke a code, rotate the key, pause the demo (scale to zero or remove the codes), and read the logs and the bill.
- **README:** a "Live demo available on request" line and how to ask. No public URL or code.

**Required tests**
- *Unit:* any code this unit changes. Most of the scope is config.
- A manual launch checklist, recorded in Notes: a new code works end to end on the hosted URL, a revoked code gets 401, the limit returns 429, and health is open.

**Definition of done**
- The checklist passes on the hosted environment.
- Worst-case monthly spend is bounded by the Anthropic spend limit, which is at most $10, plus about $0 of hosting.
- No secret exists outside Secret Manager and the Anthropic console.

**Notes:**
- From deployment planning: review tier `sonnet`; likely one code commit.
- If WU-21 was skipped, its scope moves here, ahead of everything above.
- From WU-21 (plan review #5): once the runtime service account can read the API key secret, the deploy identity can reach the key too, by deploying an image that runs as that account. Accept it with the Anthropic spend limit as the bound, or move live deploys to their own identity behind the GitHub Environment this unit already plans. Record the choice in ADR 0005.
- From WU-21: consider deploying with `--no-traffic --tag candidate`, running the contract check on the tagged URL, then moving traffic, so a failing revision never serves the demo. Pin the traffic block in Terraform's `ignore_changes` if so.
- From WU-21: the model IDs need no change for live mode: the hosted service already runs the CLAUDE.md §8.1 IDs, because the cassettes are keyed on them. Revisit `request_timeout_seconds` with WU-10's latency figure.

---

## Backlog (not scheduled)
- `mobile-react-native` client, with its own consumer pact verified against the backend
- Local Docker Pact Broker + `can-i-deploy`
- Remaining abuse controls from ADR 0004's Future hardening section (written in WU-17). Invite codes and per-code rate limits are now WU-22, and the spend limit is WU-23. Left: an on-topic guard step (it may move into WU-18 if the evals show it's needed). User accounts belong here only if this becomes a product (ADR 0005).
- Performance testing, against the hosted environment (WU-21)
- A custom domain for the hosted environment (ADR 0005: optional). Likely through Cloudflare in front of Cloud Run, which adds an edge, DDoS protection and a WAF, and makes Cloudflare Access an option (ADR 0005, "Considered after acceptance: Cloudflare")
- Terraform applied from CI: plan and apply on merge, with its own near-owner identity behind a GitHub Environment that needs your approval. Plan output must stay out of the public Actions logs. Today it is applied by hand ([`infra/README.md`](../infra/README.md))
- Closed beta after WU-23: a small pool of testers on invite codes, a feedback channel outside the app (a form, a GitHub issue template or a short call, since the server stores nothing), consented capture of real inputs as WU-18 eval cases, and the pool sized from WU-23's cost per session
