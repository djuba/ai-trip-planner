# AI Vacation Planner (polyglot monorepo)

A portfolio app that turns natural-language travel requests into structured, validated vacation recommendations. Its main goal is to show that the system is backend-swappable: the web client talks only to an HTTP contract, so a TypeScript, Python (FastAPI) or Go backend can serve it without any frontend change. Portability is proven by the contract test suite, not by intent.

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
| The HTTP contract: request and response shapes | `packages/domain-schema/src/wire/`, generated into `generated/` |
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
