# AI Trip Planner

A portfolio app that turns natural-language travel requests into structured, validated vacation recommendations. It's a showcase for LLM integration: travel requests are messy and open-ended, so a model turns them into structured data, while ordinary code validates that data and decides what happens next.

It's built spec-first. The HTTP contract, the business rules and worked examples of each rule live as language-neutral files in `spec/`. One TypeScript backend implements them, and a Next.js web client talks to it over HTTP only. The provider contract tests check the running backend against the spec over HTTP, without importing any of its code.

## From natural language to recommendations

The server is stateless, so each stage is its own HTTP request, and the client decides when to call the next one.

| Step | Input | Handled by | Output | Status |
|---|---|---|---|---|
| 1. Extract | The user's message and current profile | LLM | `ExtractionSchema` | Planned (WU-09) |
| 2. Normalize | `ExtractionSchema` | Code | `TripProfile`, the domain model | Built |
| 3. Validate | `TripProfile` | Code | `ready`, or violations | Built |
| 4. Clarify | Violations | LLM writes the question | `needs_clarification`, then back to step 1 | Planned (WU-09) |
| 5. Recommend | A `ready` profile | LLM | `RecommendationSet` | Planned (WU-10) |
| 6. Critique | Recommendations | Code checks first, then LLM, with at most 2 revisions | `RecommendResponse` | Planned (WU-10) |
| 7. Present | Profile and recommendations | Code for data, LLM for prose | Streamed `PresentationModel` | Planned (WU-11) |

For example, "Somewhere warm" populates only one field, so the rules ask for more detail. "A beach trip in March for two adults and a child" populates three, so it can move on to recommendations.

Model output is treated as untrusted input: every response is checked against its schema, and invented specifics such as flight details must be labeled as unverified. There's no live flight or hotel data.

## Design and tradeoffs

See [ADR 0003](docs/decisions/0003-spec-first-one-implementation.md) for the decision record.

**Why the spec is language-neutral.** The contract is published as plain files: JSON Schema, OpenAPI and a constants file in `spec/generated/`, plus a Markdown rule catalog (`spec/rules.md`) with JSON examples (`spec/fixtures/rules/`). These files are the API docs any client can read. The contract tests read only them, so the tests check the contract rather than how the TypeScript code happens to meet it, and they can check a deployed backend too.

**What it costs.** Shapes are written once in Zod and generated into `spec/generated/`, so the generated files need a drift check, and a parity test keeps Zod and JSON Schema in agreement. Wire schemas are limited to what JSON Schema can express, so cross-field checks live in the rules instead. A test keeps the rule catalog and its examples in step, and the TypeScript tests need a loader (`packages/domain-schema/tests/support/rule-fixtures.ts`) that reads and validates the JSON examples.

**What isn't proven.** Portability. The spec is written so that another backend could implement it, and the provider contract tests (the Conformance and Pact rows below) are black-box, so they would judge one unchanged. But there's only one implementation, so nothing shows a second one would pass.

**Patterns used**

| Pattern | Here |
|---|---|
| Spec-first (contract-first) API design | Shapes are written in `packages/domain-schema` and generated into `spec/generated/` before endpoints implement them |
| Specification by Example | Each rule in `spec/rules.md` has worked examples in `spec/fixtures/rules/` that run as tests. It's the idea under BDD, without Gherkin scenarios written with the business |
| Shared test vectors | The same rule examples drive the rules' unit tests and, from WU-09, the `/extract` HTTP tests |
| Consumer-driven contracts | Pact: the web client's tests write the pact, and the backend is verified against it |
| Ports and adapters | `src/usecases/` owns the `LlmClient` port; `src/llm/` holds the adapters (AI SDK with record/replay, and a mock) |

**How the design is checked**

| Check | What it confirms | Where | Status |
|---|---|---|---|
| Import boundaries | The web app can't import backend code or `rules` | `eslint.config.js`, `scripts/tests/integration/lint-boundaries.test.ts` | Built |
| Drift check | The generated files match the Zod schemas | `pnpm --filter @vp/domain-schema gen:check` | Built |
| Schema parity | Zod and the generated JSON Schema accept and reject the same payloads | `packages/domain-schema/src/wire/parity.test.ts` | Built |
| Rule examples | The rules return exactly the cataloged violations for every example | `spec/fixtures/rules/`, run by the rules' unit tests and through `/extract` | Unit tests built; `/extract` tests planned (WU-09) |
| Conformance suite | The running backend's responses match the contract | `tests/contract/conformance/`, run by `pnpm test:contract` (or `test:contract:external` for any running backend) | Built; runs against stub endpoints until WU-09–11 |
| Pact | The backend does what the web client expects | `contracts/pacts/`, `tests/contract/pact-verify.test.ts` | Verifier built; consumer pacts planned (WU-12) |
| Journeys | The whole system works from the user's side | `tests/journeys/` | Planned (WU-15) |

## Prerequisites

- Node 24.22.1 (pinned in `.nvmrc`)
- pnpm 12.15.0, provided through corepack (`corepack enable`)
- [gitleaks](https://github.com/gitleaks/gitleaks) 8.30.1 on `PATH` for the pre-commit secret scan (`winget install Gitleaks.Gitleaks` or `brew install gitleaks`). Without it, commits are blocked.
- On Windows, the Microsoft Visual C++ 2015–2022 Redistributable (x64) for the Pact verifier's native library (`winget install Microsoft.VCRedist.2015+.x64`). Without it, `pnpm test:contract` fails with a message saying so.

## Commands

```sh
pnpm install              # also installs the git hooks (lefthook)
pnpm verify               # project gate: typecheck, lint, format, audit, tests + coverage
pnpm test:unit            # or test:integration, test:functional, test:contract
pnpm verify:integrated    # integrated gate (stub until WU-15)
pnpm verify:full          # nightly-equivalent gate (stub until WU-15)
```

Git hooks: `commit-msg` enforces Conventional Commits with the scopes in CLAUDE.md §10, `pre-commit` lints and formats staged files and runs gitleaks, and `pre-push` runs `pnpm verify`.

Use pnpm only; do not use npm or Yarn.

## Where to find things

| Looking for | Location |
|---|---|
| HTTP request and response bodies | `packages/domain-schema/src/wire/http/` |
| Shared types inside those bodies | `packages/domain-schema/src/wire/models/` |
| Formats only the LLM fills in, which never cross HTTP | `packages/domain-schema/src/wire/llm/` |
| Generated JSON Schema and OpenAPI | `spec/generated/` |
| Business rules | `spec/rules.md` (the spec) and `packages/domain-schema/src/rules/` (the TS implementation) |
| Language-neutral rule test cases | `spec/fixtures/rules/` |
| API endpoints | `backends/api-nextjs/app/v1/**/route.ts` |
| Business logic for each AI stage | `backends/api-nextjs/src/usecases/` |
| The Anthropic client and record/replay | `backends/api-nextjs/src/llm/` |
| The web client | `apps/web-nextjs/` |
| Acceptance criteria and decisions | `docs/features/` and `docs/decisions/` |

The backend, web client and journeys are scaffolds until their work units land, so some of these folders don't exist yet.

### How this maps to Clean Architecture

| Clean layer | Here |
|---|---|
| Core | `packages/domain-schema` |
| Use cases | `backends/api-nextjs/src/usecases/`, which owns the `LlmClient` interface |
| Infrastructure | `backends/api-nextjs/src/llm/` |
| Web | `backends/api-nextjs/app/v1/**/route.ts` |

ESLint import rules and the package `exports` map enforce the boundaries that project references would in .NET.

### Where tests live

| Test type | Location |
|---|---|
| Unit | `*.test.ts` beside the code |
| Integration | `<project>/tests/integration/` |
| Functional | `<project>/tests/functional/` |
| Helpers shared within a project | `<project>/tests/support/` |
| Provider contract tests, black-box against the running backend | `tests/contract/` |
| Journeys, across the whole system | `tests/journeys/` |

## Documentation

- [CLAUDE.md](CLAUDE.md): architecture, testing strategy and engineering rules
- [docs/work-breakdown.md](docs/work-breakdown.md): build order and progress
