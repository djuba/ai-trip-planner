# ADR 0003 — Spec-first, one implementation

**Status:** accepted · **Date:** 2026-11-11 · **Work unit:** WU-19 · **Plan:** [WU-19](../plans/WU-19.md) · **Supersedes in part:** [ADR 0002](0002-rule-parity-across-backends.md) (its cross-backend parts)

## Context

The repo started as a polyglot monorepo. Its headline was that TypeScript, FastAPI and Go backends could serve the same web client behind one HTTP contract. Only the TypeScript backend was ever planned as a work unit. The other two existed as README-only placeholders, and several checks and gates existed only to compare backends: ADR 0002's JUnit results check and `RULE-FIXTURE` test naming, `BACKEND=` selection for the contract runner and the journeys stack, a `verify:full` that loops over backends, `HealthResponse.backend`, and commit scopes for backends that don't exist.

Each of these costs something now and pays off only if a second backend is built. Some of the surrounding design is worth having even if one never is.

## Decision

The repo is a **spec-first app with one TypeScript implementation**. Portability stays a property of the design, because the provider contract tests (CLAUDE.md §6.5: Pact verification and the conformance suite) are black-box and would judge a second implementation unchanged, but it is no longer the headline or a planned deliverable.

**The keep/drop test:** a piece stays only if it is worth having even when no second backend ever exists.

| Piece | Verdict | Why it passes or fails the test |
|---|---|---|
| `spec/rules.md`, `spec/fixtures/rules/`, `catalog.test.ts` | keep | A rule catalog people can read, with executable examples, kept in sync by a test |
| `spec/generated/` (OpenAPI, JSON Schema, constants), `parity.test.ts` | keep | Published API docs and schemas any future client can use; the parity test keeps Zod and JSON Schema in agreement |
| Provider contract tests (black-box), `pnpm test:contract:external` | keep | Checks the contract, not the implementation, and can check a deployed backend |
| The web ↔ API split over HTTP, Zod, Pact | keep | Independent of how many backends exist |
| Rule fixtures through `/extract` with a mock `LlmClient` | keep, simplified | Proves HTTP serialization and `ready` vs `needs_clarification` routing for every rule example |
| ADR 0002's JUnit results check and `RULE-FIXTURE <file>/<id>` titles | drop | Exist only to prove that another language's suite ran every fixture |
| `BACKEND=` selection, a multi-backend `verify:full` | drop | Nothing to select between |
| `HealthResponse.backend` (`BackendName`) | drop | Identifies nothing with one implementation |
| `backends/api-fastapi/`, `backends/api-go/`, `apps/mobile-react-native/` | drop | Placeholders with no code; the mobile client stays in the backlog |
| `api-fastapi` and `api-go` commit scopes | drop | Scopes for code that doesn't exist |

Removing `HealthResponse.backend` is a breaking contract change, so `contractVersion` goes from 0.2.0 to 0.3.0. The contract is pre-1.0, so under semver a breaking change bumps the minor version.

## Patterns

Named precisely, because several are often confused with neighbours:

- **Spec-first (contract-first) API design.** Shapes are written in Zod and generated into JSON Schema and OpenAPI before endpoints implement them, and the generated files are committed and drift-checked.
- **Specification by Example (executable specification).** Each rule in `spec/rules.md` has worked examples in `spec/fixtures/rules/`, and those examples run as tests. This is the idea under BDD, but it is not full BDD, which means Gherkin scenarios written together with the business.
- **Shared test vectors.** The same fixture cases drive the unit tests of the rules and, from WU-09, the `/extract` HTTP tests.
- **Consumer-driven contracts.** The web client's tests write the Pact file, and the backend is verified against it.
- **Ports and adapters.** `src/usecases/` owns the `LlmClient` port; `src/llm/` provides the adapters (the AI SDK client with record/replay, and the mock).

## Consequences

- **Costs accepted.** `catalog.test.ts` keeps `rules.md` and the fixtures in step; the TS fixture loader (`packages/domain-schema/tests/support/rule-fixtures.ts`) reads the JSON cases; wire schemas stay limited to JSON-Schema-expressible constructs (CLAUDE.md §4.1); the generated files need a drift check.
- **What stays unproven: portability.** The spec is written so another implementation could satisfy it, and the provider contract tests would judge one, but nothing shows a second implementation would pass. Comparison strictness, the gap ADR 0002 left open, doesn't arise with one implementation: there is one fixture helper, and code review covers it.
- **Rule fixtures, simplified.** WU-09 still sends every rule fixture through `/extract` with the mock `LlmClient`, asserts the normalized profile is unchanged, and compares violations exactly and in order. It drops the `RULE-FIXTURE` naming, the JUnit report and `tests/contract/rule-results.ts`.
- **Repository name.** The GitHub repository becomes `ai-trip-planner`, and the product name becomes "AI Trip Planner". The local folder keeps its old name, because Claude Code transcripts, project memory and `wu-usage.mjs` are keyed by it.

## If a second backend is added

Re-add what this ADR removed, in the same unit as the backend:

- **Cross-backend fixture checks:** ADR 0002's JUnit results check (a shared script in `tests/contract/` that fails unless every fixture `id` passed) and the `RULE-FIXTURE <file>/<id>` test titles, in every backend's suite. Settle comparison strictness again: one shared fixture helper per language, covered by review.
- **`BACKEND=` selection** in `scripts/run-contract.ts` and the journeys stack script.
- **A multi-backend `verify:full`:** journeys `@full` and the provider contract tests against every implemented backend.
- **`HealthResponse.backend`** (a `BackendName` enum), as an additive contract change.
- **The backend's commit scope** in `commitlint.config.js`, `scripts/commitlint-config.test.ts` and CLAUDE.md §10.
- **Its folder in `backends/`**, with a README stating the contract it must satisfy (CLAUDE.md §6.5).

The contract suite, the generated schemas and the rule fixtures need no change: they already read only `spec/`.
