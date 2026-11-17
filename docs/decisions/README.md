# Architecture decision records

Each record states one decision: its context, the options considered, what was chosen and what it costs. Records are not rewritten once accepted; a later record supersedes them instead, in whole or in part.

| ADR | Decision | Status | Date | Unit |
|---|---|---|---|---|
| [0001 — Structured output with the AI SDK and Claude 5.5](0001-structured-output.md) | How every stage gets schema-shaped JSON from Claude: `generateText`/`streamText` with native structured output, the schema constructs the provider accepts, how refusals arrive, and the `/present` streaming format. Backed by a spike against the pinned versions. | accepted | 2026-10-27 | WU-03 |
| [0002 — Proving rule parity across backends](0002-rule-parity-across-backends.md) | Every rule example runs through each backend's real `/extract` HTTP path with a mock LLM client. | accepted; superseded in part by 0003 | 2026-11-08 | WU-07 |
| [0003 — Spec-first, one implementation](0003-spec-first-one-implementation.md) | The repo is a spec-first app with one TypeScript backend. A piece of the multi-backend design stays only if it is worth having with one backend. | accepted | 2026-11-11 | WU-19 |
| [0004 — Input and output limits](0004-input-and-output-limits.md) | Size caps go on the wire as resource limits (a 422, not a rule), and model output over a cap is discarded, so a prompt injection can only get a few short strings out. | accepted | 2026-11-11 | WU-17 |
| [0005 — Hosting and access](0005-hosting-and-access.md) | One Cloud Run environment, deployed from a container image by keyless CI, run in replay mode until the demo launches; invite codes with quotas and rate limits instead of user accounts. | accepted | 2026-11-12 | WU-20 |

Each record links the work unit's plan in [`docs/plans/`](../plans/), where the detailed design and its deviations are kept.
