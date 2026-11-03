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

## Documentation

- [CLAUDE.md](CLAUDE.md): architecture, testing strategy and engineering rules
- [docs/work-breakdown.md](docs/work-breakdown.md): build order and progress
