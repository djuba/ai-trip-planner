# CLAUDE.md — AI Vacation Planner (Polyglot Monorepo)

Governs every build session. When this file conflicts with a recalled habit, this file wins. When it conflicts with the user's latest instruction, ask.

## 1. What this project is

A portfolio app that turns natural-language travel requests into structured, validated vacation recommendations. Its main goal is to show that the system is **backend-swappable**: the web client talks only to an HTTP contract, so a TypeScript, Python (FastAPI) or Go backend can serve it without any frontend change.

**Portability is proven by tests, not by intent.** A backend is "conformant" only when it passes the contract suite in `tests/contract` (see §6.5).

## 2. Repository layout

```
vacation-planner-polyglot/
├── apps/
│   └── web-nextjs/              # Next.js App Router client. Talks HTTP only.
│       └── tests/functional/    # Playwright, API mocked at the network edge
├── backends/
│   ├── api-nextjs/              # TS reference backend (Route Handlers only)
│   │   └── tests/{integration,functional}/  # unit tests sit beside the code (§6.3)
│   ├── api-fastapi/             # future — README + .gitkeep only until started
│   └── api-go/                  # future — README + .gitkeep only until started
├── packages/
│   └── domain-schema/           # THE CONTRACT (see §4)
│       ├── src/wire/            # Zod schemas: http/ (bodies), models/ (shared), llm/ (model-only)
│       ├── src/rules/           # TS implementation of invariant rules (backend-only)
│       ├── generated/           # JSON Schema + openapi.yaml — generated, COMMITTED
│       ├── rules.md             # Language-neutral invariant catalog (source of truth for rules)
│       ├── fixtures/            # Contract cases: input JSON → expected output JSON
│       └── tests/support/       # TS test helpers (buildFixture, fixture loader, samples)
├── contracts/
│   └── pacts/                   # Consumer pact files written by web tests — COMMITTED
├── tests/
│   ├── contract/                # Provider verification (Pact + schema-first) vs. API_BASE_URL
│   └── journeys/                # Cross-system Playwright journeys (isolated workspace, §6.6)
├── docs/features/               # Acceptance criteria per feature (§6.2)
├── docs/decisions/              # Architecture decision records (ADRs)
├── spikes/                      # NON-PRODUCTION spikes; outside the workspace and every gate
├── .llm-cassettes/              # Recorded LLM HTTP exchanges for replay — COMMITTED
├── pnpm-workspace.yaml
├── package.json
└── README.md
```

## 3. Toolchain & commands

- **Package manager: pnpm** (strict node_modules, no phantom deps). Do not use npm or Yarn commands.
- **Node:** current LTS, pinned in `.nvmrc` and `package.json#engines`.
- **TypeScript:** `strict: true`, `noUncheckedIndexedAccess: true`, `"type": "module"` in every package, `moduleResolution: "bundler"`.
- **Pin exact versions** of `next`, `ai`, `@ai-sdk/anthropic`, `@ai-sdk/react`, `zod`, `vitest`, `@playwright/test`, `@pact-foundation/pact`. There must be exactly one `zod` version in the lockfile (`pnpm why zod` to check).
- Scripts must run on Windows and POSIX. No `rm -rf`, `&&` chains with env vars, or bash-only syntax in `package.json`; use `rimraf` / `cross-env` / node scripts.

| Task | Command |
|---|---|
| Install | `pnpm install` |
| Run everything locally | `pnpm dev` (web on :3000, api-nextjs on :4000) |
| Regenerate contract artifacts | `pnpm --filter @vp/domain-schema gen` |
| Typecheck / lint | `pnpm typecheck` / `pnpm lint` |
| Unit tests | `pnpm test:unit` |
| Integration tests | `pnpm test:integration` |
| Functional tests | `pnpm test:functional` |
| Contract tests (consumer + provider) | `pnpm test:contract` (provider side uses `API_BASE_URL`, default `http://localhost:4000`) |
| Journeys | `pnpm test:journeys --grep "@smoke\|@critical"` (or `@full`) |
| **Project gate** (≈ MR gate) | `pnpm verify` |
| **Integrated gate** (≈ deploy gate) | `pnpm verify:integrated` |
| **Nightly-equivalent** | `pnpm verify:full` |

## 4. The contract (`packages/domain-schema`)

### 4.1 Source of truth
- **Shapes:** Zod in `src/wire/` is where shapes are written. `z.toJSONSchema()` emits `generated/*.schema.json` and `generated/openapi.yaml`. Python/Go generate their models from `generated/`, never from TS. Schemas only a model fills in (`src/wire/llm/`) never cross HTTP, so they get a `.schema.json` but stay out of `openapi.yaml`.
- **Invariants:** `rules.md` is the source of truth. Each rule has a stable code, a plain-English definition, and fixture cases. `src/rules/` is just the TS implementation of it.
- **Use only JSON-Schema-expressible constructs in wire schemas:** no `.transform()`, `.refine()`, `.superRefine()`, `z.date()`, `z.bigint()`, or `.default()` that changes meaning. Cross-field rules go in `src/rules/`, never in the wire schema.

### 4.2 Package exports (enforced)
```jsonc
"exports": {
  "./wire":    "./src/wire/index.ts",              // web + backends may import
  "./rules":   "./src/rules/index.ts",             // backends ONLY — web must not import
  "./testing": "./tests/support/build-fixture.ts"  // test code ONLY
}
```
`apps/web-nextjs` may import `@vp/domain-schema/wire`: its schemas (for the final `safeParse` of streamed data) and its types (prefer `import type`). Its tests may import `buildFixture` from `@vp/domain-schema/testing`. It never imports `rules`. An ESLint `no-restricted-imports` rule blocks `@vp/domain-schema/rules` in `apps/`. `web-nextjs/next.config` lists the package in `transpilePackages`.

### 4.3 Domain model (wire shape)
All dates are ISO-8601 `YYYY-MM-DD` strings. No `Date` objects cross the wire.

```ts
TripProfile {
  departure?:      { city?: string | null, mode?: 'plane' | 'car' | 'train' | null, maxStops?: number | null /* 0 = non-stop */ } | null
  dateRange?:      { kind: 'fixed', start: string, end: string }
                 | { kind: 'flexible', month?: number /*1-12*/, year?: number, durationNights?: number, note?: string }
                 | null
  region?:         string | null
  climate?:        'tropical' | 'warm' | 'temperate' | 'cool' | 'cold' | null
  experiences?:    Experience[]          // closed enum
  unmappedExperiences?: string[]         // what the user asked for that has no enum value
  people?:         Traveler[]
}
Experience = 'beach' | 'pool' | 'golf' | 'go-karts' | 'hiking' | 'snorkeling' | 'theme-parks' | 'museums' | 'nightlife' | 'skiing'
Traveler   { userType: 'adult' | 'child', age?: number | null, gender?: string | null }
```
The enum is closed and versioned. Adding a value is a `feat(domain-schema)`; removing or renaming one is a breaking change (`!`).

### 4.4 Two schemas, never one
- **`ExtractionSchema`** — what the LLM fills in. Every field is **required but nullable** (`null` = "not mentioned"). This is the most reliable shape for structured output and has no optional-vs-absent ambiguity.
  - **Constructs (ADR 0001, Q3):** this schema, and every other schema handed to the model, uses only object, string, number/integer, boolean, enum, literal, nullable, array and discriminated union. **No** `tuple` (HTTP 400), `record` (always comes back `{}`), `.optional()`, `.default()`, numeric/length/pattern constraints or string `format`s. The provider strips constraints into descriptions, but the SDK still validates against them, so one out-of-range value fails the whole call as a 502 instead of becoming a rule violation. Range and format checks belong in `src/rules/`.
- **`TripProfile`** — the domain/wire shape above. Built by a pure `normalize(extraction)` function that drops nulls and empty arrays.

### 4.5 Validation = shape parse + rule evaluation (separate steps)
1. Zod `safeParse` against the wire schema → shape errors (contract violation → HTTP 422).
2. `evaluateRules(profile, referenceDate)` → `RuleViolation[]` (business result → HTTP 200 with `needs_clarification`).

**Profile fields the model extracts (everything reachable from `ExtractionSchema`, i.e. `TripProfile`) carry no range or format constraints on the wire**, even when no rule checks them yet. Their checks are rules, so a `needs_clarification` response can carry the bad value, and the client can send it back. Other fields may carry constraints that are the server's own guarantee (e.g. `referenceDate` is a date, `clarificationQuestion` is non-empty).

Rules never throw. Each violation is `{ code, path, params }`: `path` is a JSON Pointer into the profile, and `params` is typed per code (see `src/wire/models/rule-violation.ts`). **Messages are not part of the contract**; clients and the LLM clarification prompt render text from `code` + `params`.

### 4.6 Invariant catalog (mirror of `rules.md`)
| Code | Rule |
|---|---|
| `CHILD_AGE_RANGE` | `userType='child'` ⇒ `age` is null or `0 ≤ age < 18` |
| `ADULT_AGE_RANGE` | `userType='adult'` ⇒ `age` is null or `18 ≤ age ≤ 120` |
| `DATE_ORDER` | `fixed` range ⇒ `end ≥ start` |
| `DATE_NOT_PAST` | `start` (or flexible month + year, or year) is not before the request's `referenceDate`; a flexible month with no year means its next occurrence, so it is never past |
| `DATE_VALID` | fixed `start`/`end` are real `YYYY-MM-DD` calendar dates; flexible `month` is 1–12, `year` is 2000–2100, `durationNights ≥ 1` |
| `PARTY_HAS_ADULT` | if `people` is non-empty, at least one adult |
| `INSUFFICIENT_DETAIL` | fewer than `MIN_POPULATED_FIELDS` populated fields (see §4.7) |
| `MAX_STOPS_RANGE` | `departure.maxStops` is null or `≥ 0` |

`referenceDate` is supplied in the request (client's local date), so rules stay deterministic and testable. Backends never read the system clock inside rules.

### 4.7 "Populated field" — exact definition
A top-level field counts as populated when it is: a non-empty trimmed string (trimming means Unicode `White_Space`, see `rules.md`); a `departure` with a non-empty trimmed `city`; a `dateRange` of kind `fixed`, or `flexible` with at least `month` or `year`; or a non-empty array (`experiences`, `people`). `unmappedExperiences` never counts. `MIN_POPULATED_FIELDS = 3`, and it is exported as a constant from the contract (and copied into `generated/constants.json`) so all backends share it.

## 5. HTTP API (v1)

Base path `/v1`. JSON only. CORS allows `WEB_ORIGIN` (default `http://localhost:3000`). The frontend reads `NEXT_PUBLIC_API_BASE_URL` and nothing else to locate the backend.

**The server is stateless.** The client keeps the conversation state and sends the current profile with every turn.

| Endpoint | Request | Response |
|---|---|---|
| `POST /v1/trip/extract` | `{ message, currentProfile?, referenceDate }` | `ExtractResponse` (below) |
| `POST /v1/trip/recommend` | `{ profile, referenceDate }` | `RecommendResponse` (critic already applied) |
| `POST /v1/trip/present` | `{ profile, recommendations }` | **stream**: `text/plain` partial-JSON stream of `PresentationModel` |
| `GET  /v1/health` | — | `{ status, backend: 'nextjs' \| 'fastapi' \| 'go', contractVersion }` |

```ts
ExtractResponse =
  | { status: 'needs_clarification', profile: TripProfile, violations: RuleViolation[], clarificationQuestion: string }
  | { status: 'ready',               profile: TripProfile }
```

Status codes: `200` = handled (including `needs_clarification`); `422` = request body fails the contract; `502` = upstream LLM failure or refusal; `500` = bug. Error body: `{ error: { code, message } }`.

**Streaming wire format:** `/present` streams raw JSON text that, when complete, parses as `PresentationModel`. This is what `useObject` consumes, and any language can produce it. Do not use AI-SDK-specific data-stream framing on this endpoint; that would tie the client to a TS backend. The client must treat every streamed field as possibly `undefined` until the stream finishes, then run a final `safeParse`.

## 6. Testing strategy

**Every behavior is tested at the lowest layer that can prove it.** The suite has two boundaries:

- **Project tests** (unit, integration, functional, contract) prove one deployable unit (`web-nextjs` or one backend) in isolation. These are many and fast, and they run on every `pnpm verify`.
- **Journey tests** prove the whole system from the user's point of view. These are deliberately few and run against the fully integrated local stack.

Contract tests are what let the journey suite stay small. Never add a journey test for something a cheaper layer can prove.

### 6.1 Determinism rules (apply to every layer)
- **No gated test calls a live LLM.** Tests use `LLM_MODE=mock` (unit) or `LLM_MODE=replay` (everything else). `live` and `record` are opt-in and cost money.
- **Replay happens at the HTTP boundary:** the Anthropic provider is created with a custom `fetch` that records to / replays from `.llm-cassettes/`, keyed by a hash of the request body. Our code and the AI SDK provider code run for real; only the network is replayed.
- **A cassette miss in replay mode is a test failure** with the message "re-record with `LLM_MODE=record`". Never silently fall through to live.
- No `Date.now()`, `Math.random()` or wall-clock reads in tested logic. Inject `referenceDate`, a clock, or an ID generator.
- **Every mock or fixture payload must be built through a helper that `safeParse`s it against the wire schema.** A mock that doesn't match the contract fails at construction, so mocks can't drift from the contract.

### 6.2 Acceptance criteria first (shift-left)
Each feature gets `docs/features/<feature>.md` listing acceptance criteria and edge cases as Given/When/Then with stable IDs (e.g. `AC-EXTRACT-03`). Before or alongside the implementation:
1. Every AC maps to at least one automated test at the **lowest layer that can prove it**.
2. Test titles start with the AC ID (`it('AC-EXTRACT-03: child aged 18 yields CHILD_AGE_RANGE', …)`), so `grep` gives traceability.
3. A feature is not done until every AC ID appears in a passing test.

### 6.3 Layers, tools and conventions

| Layer | Proves | Real | Faked | Tool | File pattern | Volume |
|---|---|---|---|---|---|---|
| **Unit** | Logic in isolation | the unit | everything else (`LlmClient` = mock model) | Vitest (+ React Testing Library/jsdom for web) | `*.test.ts(x)` beside the code | hundreds, ms |
| **Integration** | One component + its real immediate dependency | that dependency | everything else | Vitest | `tests/integration/**/*.test.ts` per project | tens, seconds |
| **Functional** | One app top-to-bottom, in-process, **no internal mocks** | whole app | only other systems (LLM via replay; for web, the API via network mocks) | Vitest (api) / Playwright (web) | `tests/functional/**` per project | a handful, happy paths + key failures |
| **Contract** | Consumer and provider agree on the HTTP contract | each side alone | the other side | Pact + JSON-Schema conformance | `*.pact.test.ts`, `tests/contract/**` | one per interaction |
| **Journey** | The integrated system works for a user | everything | LLM via replay only | Playwright | `tests/journeys/**/*.spec.ts` | deliberately few |

Test helpers shared within a project go in its `tests/support/`.

What belongs where:

- **`packages/domain-schema`**
  - *Unit:* every rule code, with at least one passing and one failing fixture, including edge cases (age 17 vs 18, end date equal to start, leap days, flexible dates with month only); `normalize`; the populated-field counter; `gen` producing JSON Schema that round-trips the fixtures.
- **`backends/api-nextjs`**
  - *Unit:* prompt builders, merge/normalize, the critic's deterministic checks, the critic loop's iteration cap, presentation mapping, error mapping, each use case with a mock `LlmClient`.
  - *Integration:* the `LlmClient` adapter against the real AI SDK provider plus replay cassettes (structured-output parsing, refusal → `LLM_REFUSAL`, malformed output → retry then 502); route handlers invoked with real `Request` objects (body parsing, 422 shape errors, CORS headers, stream headers).
  - *Functional:* boot the built app on a random port and drive it over real HTTP with `LLM_MODE=replay`: extract → `needs_clarification`, extract → `ready`, recommend, the `/present` stream ending in a schema-valid object, upstream failure → 502.
- **`apps/web-nextjs`**
  - *Unit:* the conversation-state reducer, view-model mapping, and components (render states, partial-stream rendering with `undefined` fields).
  - *Integration:* the typed API client against `msw` (request shape, error handling, partial-JSON stream consumption).
  - *Functional:* Playwright against the built app with the API mocked via `page.route` using contract-validated fixtures: clarification loop UI, streamed cards, error states, plus **`@axe-core/playwright` accessibility checks on every page state**.

### 6.4 Coverage
Coverage is a floor, not a goal (Vitest, v8 provider, unit + integration combined):
- `packages/domain-schema` and `backends/api-nextjs/src/usecases`: **≥ 95% lines and branches**.
- Everything else: **≥ 80%**.
- Thresholds are enforced in `pnpm verify`. Never lower one to make a build pass; add the missing test.

### 6.5 Contract tests (the linchpin)
Two complementary halves:

1. **Consumer-driven (Pact):** web API-client tests run against a Pact mock server and write `contracts/pacts/web-nextjs-vacation-api.json` (committed). `tests/contract/pact-verify.test.ts` replays that pact against **any** backend at `API_BASE_URL`. The Pact verifier is language-neutral, so the FastAPI and Go backends are verified by the same pact without rewriting the tests.
2. **Schema-first conformance:** `tests/contract/conformance/**` sends every `domain-schema/fixtures` case to `API_BASE_URL` and validates responses against `generated/*.schema.json`. It covers what Pact handles poorly: every rule code, 422 shape errors, `needs_clarification` vs `ready` routing, and the `/present` stream ending in a valid `PresentationModel`.

A backend runs both halves with `LLM_MODE=replay` and must pass both before it counts as conformant. There is no broker yet: pact files are committed and verification runs locally. `can-i-deploy` with a local Docker Pact Broker is an optional later phase.

**Contract testing uses only open-source, local tooling: no subscriptions, accounts or hosted services.** PactFlow, including its bi-directional contract testing (BDCT), is out of scope. The schema-first conformance suite is this repo's replacement for BDCT; do not add PactFlow or any hosted broker.

### 6.6 Journey tests
- They live in `tests/journeys/`, a workspace package that **must not import** from `apps/`, `backends/` or `packages/`; it only drives a browser against URLs. (In a larger organization this would be a separate repo; here an isolated workspace keeps the same boundary.)
- They run against the fully integrated local stack (`web-nextjs` + `BACKEND=nextjs|fastapi|go`, `LLM_MODE=replay`), so the same journeys prove every backend end to end.
- **Two tag dimensions only:**
  - **area:** `@clarification`, `@recommendation`, `@presentation`
  - **criticality:** `@smoke`, `@critical`, `@full`

  Do not add a third dimension.
- Starting set:
  1. Vague request → clarification → answer → recommendations rendered (`@smoke`)
  2. Invalid traveler age → targeted clarification (`@critical`)
  3. Mid-conversation correction replaces the earlier value (`@full`)
  4. Backend 502 → user sees a recoverable error state (`@full`)

  Add a journey only when no lower layer can prove the behavior.
- Follow Playwright best practices: role- and label-based locators, no fixed sleeps, independent tests.

### 6.7 Gates
| Gate | Command | Runs | Hook |
|---|---|---|---|
| Pre-commit | (lefthook) | lint + format on staged files, `gitleaks` secret scan | `pre-commit` |
| **Project gate** (≈ MR) | `pnpm verify` | typecheck, lint, `gen` drift check (no diff in `generated/`), `pnpm audit --prod`, unit, integration, functional, contract (consumer + provider vs. api-nextjs), coverage thresholds | `pre-push` |
| **Integrated gate** (≈ deploy) | `pnpm verify:integrated` | build all, start the full stack, journeys `@smoke` + `@critical` | manual / before tagging a release |
| **Full** (≈ nightly) | `pnpm verify:full` | journeys `@full` across every implemented backend; provider contract tests against every implemented backend | manual |

Each gate is a single command. **GitHub Actions mirrors the project gate** on every PR and push to `main`: `.github/workflows/verify.yml`, job `verify`, which is the required status check for merging (§10). The local gates stay the source of truth, and CI runs the same command. CI never holds secrets: gated tests never call a live LLM (§6.1). The integrated and full gates stay local. Performance testing is out of scope until there is a deployed environment; until then, per-stage latency is logged (§7.3).

### 6.8 What tests do not cover
Tests prove plumbing, contracts and rules. They do **not** judge whether recommendations are good. LLM output quality is assessed separately by an opt-in, non-gating eval script (`pnpm eval`, live, costs money) once the pipeline exists.

## 7. AI pipeline

Each stage below is one use case: one module in `backends/api-nextjs/src/usecases/`, called by its route handler. The server is stateless, so each HTTP request runs one stage, and the client decides when to call the next.

| Stage | Pattern | Model role | Notes |
|---|---|---|---|
| 1. Extract | structured output → `ExtractionSchema` | `MODEL_FAST` | Prompt includes `currentProfile` and `referenceDate`; returns the **full updated** profile (not a patch), so corrections like "actually 5 people" replace old values. Rules run in code afterwards. A second fast call writes `clarificationQuestion` from the violation codes. |
| 2a. Recommend | structured output → `RecommendationSet` | `MODEL_REASONING` | Only runs on a `ready` profile. |
| 2b. Critic | deterministic checks **first**, then LLM critic → `CritiqueResult { pass, issues[] }` | `MODEL_CRITIC` | Max **2** revise cycles, then return the best attempt with `critique.unresolved[]`. Never loop unbounded. |
| 3. Present | streamed structured output → `PresentationModel` | `MODEL_FAST` | Fields that are pure data (dates, party size, prices) are mapped in code; the LLM writes only the prose and card copy. Serve with `createTextStreamResponse({ stream: toTextStream({ stream: result.stream }) })`. Partial objects contain missing keys **and truncated strings**. |

**Factual honesty:** there is no live flight or hotel data source. Recommendations must not present invented specifics (airline schedules, "direct flight exists", prices) as facts. Every such claim carries `verification: 'unverified' | 'fixture'`. A local fixture dataset (`backends/api-nextjs/data/routes.json`, e.g. nonstop routes from MSP) may back `'fixture'` claims, and the critic's deterministic checks validate against it.

**LLM output is untrusted input.** Every model response is `safeParse`d against its schema. A parse failure goes into the same error path as a provider error (retry once, then 502), never into an unchecked cast.

## 8. Models & cost control

### 8.1 Model configuration
Model IDs come from env vars, never hardcoded in logic:
```
MODEL_FAST=claude-haiku-5-5        # extraction, clarification text, presentation
MODEL_REASONING=claude-sonnet-5-5  # recommendations
MODEL_CRITIC=claude-sonnet-5-5     # may drop to claude-haiku-5-5 once deterministic checks carry most of the load
```
Claude 3.5 models are retired; do not use their IDs. Use exact IDs with no date suffix.

### 8.2 Provider rules (confirmed in [ADR 0001](docs/decisions/0001-structured-output.md))
Verified against `ai 7.0.154` / `@ai-sdk/anthropic 4.0.89`. Re-check the ADR on any major upgrade, and check the **pinned** version's docs (`node_modules/ai/docs`) rather than memory.
- **API:** `generateText` / `streamText` with `output: Output.object({ schema })`. Do not use `generateObject` / `streamObject` (deprecated), or the deprecated response methods on the `streamText` result; use the standalone `toTextStream` + `createTextStreamResponse`. On the client, use `useObject` from `@ai-sdk/react`.
- **Native structured output:** always pass `providerOptions.anthropic.structuredOutputMode: 'outputFormat'` (sends `output_config.format`). Sonnet 5.5 and Opus 5.5 **reject forced `tool_choice`**, and `'jsonTool'` sends a forced tool call on Haiku 5.5, so never use it.
- **No sampling params:** do not set `temperature`/`topP`/`topK`. The SDK silently drops them for the 5.5 models. Tune with `providerOptions.anthropic.effort` (`low` for extraction/presentation, `medium` for recommend/critic). Always set `maxOutputTokens` per stage; the default is the model maximum (128k).
- **Retries:** set `maxRetries: 0` on every SDK call. The `LlmClient` owns the single retry from §7, so SDK retries (default 2) don't compound it or duplicate cassette entries.
- **Refusal:** it arrives as a *successful* call with `finishReason: 'content-filter'`; reading `.output` then throws `NoOutputGeneratedError`. Check `finishReason` first and map it to a 502 with code `LLM_REFUSAL`. Schema-invalid or unparseable output is `NoObjectGeneratedError`.
- **Record/replay:** pass `createAnthropic({ fetch })`. Strip the `x-api-key` request header, and **allowlist** response headers: they carry `anthropic-organization-id` and `anthropic-workspace-id`. A recorder must not await a streaming body before returning the response, or the stream is delivered as one chunk.

### 8.3 Cost discipline in local dev
- **`LLM_MODE=live | record | replay | mock`**, implemented as described in §6.1. UI work and all gated tests run without `live`.
- Log `usage` (input/output tokens, model, stage, latency) for every call to the console in dev.
- Keep system prompts static and byte-stable (no timestamps; `referenceDate` goes in the user message). This lets prompt caching apply **and keeps cassette keys stable**.

## 9. Engineering rules

- **No coupling between web and API:** no Server Actions, no importing backend code into `apps/`, no shared runtime state. `apps/web-nextjs` never holds an API key.
- `backends/api-nextjs` exposes **Route Handlers only** (`app/v1/**/route.ts`), with no pages. Business logic lives in plain TS modules (`src/usecases/`, `src/llm/`) that do not import from `next/*`; route handlers are thin adapters (parse → call → serialize). That keeps the logic portable and unit-testable.
- No god modules: one use case per module; the LLM provider sits behind a small `LlmClient` interface so `mock`/`replay` can swap in.
- **Dependency rule (lint enforced):** `src/usecases/` owns the `LlmClient` interface and must not import `next`, `ai`, `@ai-sdk/*` or `src/llm/`. `src/llm/` implements the interface. Tests are exempt, so they can use the AI SDK mock model.
- UI: Tailwind + shadcn/ui only. **No inline `style={}`**, no CSS-in-JS.
- Secrets in `.env.local` (git-ignored); `.env.example` is committed and kept current. Cassettes must never contain API keys; the recorder strips auth headers, and `gitleaks` runs on commit.
- Do not write placeholder implementations for `api-fastapi`/`api-go` until asked; keep them to a README stating the contract they must satisfy (§6.5).
- A change is not done until its tests exist at the right layer (§6.2–6.3) and `pnpm verify` passes. Report failing tests honestly, with output.

## 10. Commits & history

**Conventional Commits, enforced** with `commitlint` (`@commitlint/config-conventional`) and `lefthook` (`commit-msg`, `pre-commit` and `pre-push` hooks; lefthook is language-agnostic, so it keeps working once Python/Go join).

Format: `type(scope): imperative summary` — ≤72 chars, lowercase type.

- **Types:** `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`
- **Scopes (enforced list):** `web`, `api-nextjs`, `api-fastapi`, `api-go`, `domain-schema`, `contract`, `journeys`, `usecases`, `repo`
- **Breaking contract changes:** `feat(domain-schema)!: …` plus a `BREAKING CHANGE:` footer, and bump `contractVersion`.
- One logical change per commit. Tests go in the same commit as the behavior they cover. Regenerate `generated/` and re-record affected cassettes/pacts in the same commit as the change that caused them.
- Never commit without the user's explicit approval of the specific changes (§12). Commit messages end with the attribution trailer configured for the session.

History is searchable by scope: `git log --oneline --grep "^feat(domain-schema)"`.

**Branches & merging.** Each work unit runs on a `wu/WU-xx-<slug>` branch and lands through a pull request. Other changes use `<type>/<short-slug>` branches (e.g. `chore/branch-pr-workflow`). PRs merge with **merge commit with semi-linear history** (GitLab's term):
- every PR lands as a merge commit; the GitHub repo allows no other merge method and deletes branches after merge;
- before merging, the branch must contain the tip of `main`. If `main` has moved, rebase onto `origin/main`, re-verify, and `git push --force-with-lease`. Never merge `main` into the branch; GitHub's "Update branch" button is disabled.

Branch protection on `main` enforces this. It requires a PR (0 approvals) and the `verify` status check (§6.7), on a branch that is up to date with `main`. So what CI verified is exactly the tree that lands. Admins may bypass protection only in an emergency, and must say so in the PR. The user performs the merge. `git log --first-parent main` then reads as one line per change.

## 11. Build plan

The build order and its progress live in **`docs/work-breakdown.md`**, not in this file. Work one unit (WU) at a time, respect its dependencies, and update its status, commits and notes in that file when the unit is done.

## 12. Session workflow (non-negotiable)

Every work unit runs through **`/start-wu WU-xx`** (`.claude/skills/start-wu/SKILL.md`), which holds the full procedure. The rules it enforces:

1. **Plan before code.** The main agent writes `docs/plans/WU-xx.md` and **stops for the user's approval**. No implementation starts on an unapproved plan.
2. **The main agent (Opus) orchestrates.** Plan tasks that are well specified, cover a known set of files and are mechanical go to the `wu-implementer` subagent (Sonnet, `.claude/agents/wu-implementer.md`). Design, contract and `CLAUDE.md` changes, spikes, debugging across layers, integration, and review of all subagent output stay with the main agent. Small tasks stay with the main agent too, because a subagent's cold start costs more than it saves.
3. **Subagents never commit**, never call live LLM APIs, and never edit `CLAUDE.md`, the work breakdown or plan files.
4. **The main agent verifies.** It runs `pnpm verify` itself before review.
4a. **One independent review per checkpoint; the user decides.** A read-only `wu-reviewer` subagent (`.claude/agents/wu-reviewer.md`) reviews the draft plan before the user sees it, and the finished implementation after `pnpm verify`. Each review runs **once**. The main agent triages every concern (agree / partly / disagree, with a recommendation) and acts only on what the user chooses. It never runs review → fix → review loops on its own. The plan sets a **review tier**: Sonnet by default; Opus only for units where a missed flaw would spread (WU-04, WU-05, WU-08, or any change to the contract, rule catalog or `LlmClient` interface); or skip for trivial units. The user can override the tier.
5. **Review before commit.** Changes stay **uncommitted** on the unit's branch for the user to review in VS Code. The main agent presents a summary, verification results, a grouped file list and the proposed commit messages (no full diff unless asked), then **stops**.
6. **Commit only on explicit approval** of those changes. `.claude/settings.json` also makes every `git commit` prompt for permission. Approval for one set of changes does not carry over to later changes.
7. **Material deviation from an approved plan** means pausing and telling the user before continuing. Every deviation, material or not, is recorded in the plan's `Deviations during implementation` section. Findings that affect later units become proposed Notes on those units in `docs/work-breakdown.md`, approved at review. Other units' scope is never rewritten.
7a. **Usage is tracked per unit.** At close, `node .claude/scripts/wu-usage.mjs WU-xx` totals token usage from local Claude Code transcripts (it spends no tokens), and a one-line summary goes in the unit's Notes. Attribution is by branch, so concurrent sessions must use separate worktrees.
8. **One branch and one PR per unit.** The unit starts on `wu/WU-xx-<slug>` cut from an up-to-date `main`. After the approved commits, the main agent pushes the branch and opens a PR. **The user merges it**, as a merge commit with semi-linear history (§10). A unit counts as `done` only once its PR is merged to `main`.
