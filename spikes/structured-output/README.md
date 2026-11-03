# ⚠️ NON-PRODUCTION SPIKE — structured output (WU-03)

**This directory is throwaway evidence, not product code.** It is not part of the pnpm workspace and is not built, linted, typechecked or tested by any gate. Nothing in `apps/`, `backends/` or `packages/` may import from it.

The decision it supports is recorded in [`docs/decisions/0001-structured-output.md`](../../docs/decisions/0001-structured-output.md). Read that first; this directory only exists so the findings can be reproduced.

## What's here

| File | Answers | Network |
|---|---|---|
| `src/capture-fetch.ts` | Q6: capturing and synthetic `fetch` for the Anthropic provider (auth headers stripped) | — |
| `src/schemas.ts` | Probe schemas (a stand-in for §4.3/§4.4, **not** the contract) and the constructs matrix | — |
| `src/q5-failures.ts` | Q5/Q6: refusal, schema-invalid, non-JSON, truncation, HTTP 400/529, retry counts | offline |
| `src/q1-q4-structured.ts` | Q1/Q2/Q4: request shapes per model and setting (offline); Q3: live extraction on Haiku and Sonnet | 2 live calls |
| `src/q3-constructs.ts` | Q3: how each Zod construct is sent, and whether the API accepts it | 12 live calls (Haiku) |
| `src/q7-use-object.ts` | Q7: the real `useObject` under jsdom against a hand-chunked `text/plain` server and an AI SDK server | 1 live call |
| `src/run-all.ts` | Runs everything | ~15 live calls |
| `captures/` | Recorded request/response pairs from the runs above (auth stripped) | — |

## Running it

From this directory (Node 24, pnpm 12):

```sh
pnpm install --ignore-workspace   # own lockfile; never touches the root one
pnpm run q5                       # offline probes are free
pnpm run all                      # live phases run only if ANTHROPIC_API_KEY is set
```

The scripts read `ANTHROPIC_API_KEY` from the repo root `.env.local`. A full run costs well under $0.10.

## Versions tested

`ai 7.0.154` · `@ai-sdk/anthropic 4.0.89` · `@ai-sdk/react 4.0.158` · `zod 4.6.7` · `react 19.3.1` · Node 24.22.1
