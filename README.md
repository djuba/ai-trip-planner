# AI Vacation Planner (polyglot monorepo)

A portfolio app that turns natural-language travel requests into structured, validated vacation recommendations. Its main goal is to learn and demonstrate several tech stacks, which works because each side of the system is interchangeable behind one HTTP contract. A TypeScript, Python (FastAPI) or Go backend can serve the web client without any frontend change, and the same contract leaves room for more clients, such as a future React Native app. It's also a good showcase for LLM integration: travel requests are messy and open-ended, so a model turns them into structured data, while ordinary code validates that data and decides what happens next. A real product would likely run the other way, with one backend and several clients. A backend counts as interchangeable only when it passes the contract test suite.

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

## How interchangeability is checked

| Check | What it confirms | Where | Status |
|---|---|---|---|
| Import boundaries | The web app can't import backend code or `rules` | `eslint.config.js`, `scripts/tests/integration/lint-boundaries.test.ts` | Built |
| Drift check | The generated files match the Zod schemas | `pnpm --filter @vp/domain-schema gen:check` | Built |
| Schema parity | Zod and the generated JSON Schema accept and reject the same payloads | `packages/domain-schema/src/wire/parity.test.ts` | Built |
| Shared rule cases | Every backend can run the same rule test cases | `packages/domain-schema/fixtures/rules/` | Built; only TypeScript runs them so far |
| Conformance suite | A backend's responses match the contract | `tests/contract/conformance/` | Planned (WU-07) |
| Pact | A backend does what the web client expects | `contracts/pacts/`, `tests/contract/pact-verify.test.ts` | Planned (WU-07, WU-12) |
| Journeys | The whole system works from the user's side | `tests/journeys/` | Planned (WU-15) |

Only the TypeScript backend is planned so far, and FastAPI and Go are in the backlog. So interchangeability isn't proven yet: these checks are what a second backend would have to pass.

## Prerequisites

- Node 24.22.1 (pinned in `.nvmrc`)
- pnpm 12.15.0, provided through corepack (`corepack enable`)
- [gitleaks](https://github.com/gitleaks/gitleaks) 8.30.1 on `PATH` for the pre-commit secret scan (`winget install Gitleaks.Gitleaks` or `brew install gitleaks`). Without it, commits are blocked.

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
| Generated JSON Schema and OpenAPI | `packages/domain-schema/generated/` |
| Business rules | `packages/domain-schema/rules.md` (the spec) and `src/rules/` (the TS implementation) |
| Language-neutral rule test cases | `packages/domain-schema/fixtures/rules/` |
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
| Contract, across backends | `tests/contract/` |
| Journeys, across the whole system | `tests/journeys/` |

## Documentation

- [CLAUDE.md](CLAUDE.md): architecture, testing strategy and engineering rules
- [docs/work-breakdown.md](docs/work-breakdown.md): build order and progress
