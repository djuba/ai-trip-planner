# ADR 0002 — Proving rule parity across backends

**Status:** accepted · **Date:** 2026-11-08 · **Work unit:** WU-07 · **Plan:** [WU-07](../plans/WU-07.md)

## Context

Every backend must implement the invariant rules in `packages/domain-schema/rules.md` identically, including violation `params` and order: order feeds the clarification prompt and therefore the cassette keys. The rules come with language-neutral fixture cases (`fixtures/rules/*.json`, `profile` + `referenceDate` → `expectedViolations`).

CLAUDE.md §6.5 originally had the black-box conformance suite send every fixture case to the backend over HTTP. No endpoint can do that deterministically. `/extract` puts the LLM between the input and the rules, and its replay cassettes are specific to each backend, because they hash each backend's own prompt. Canned stubs can't return each fixture's violations either (WU-05 R1).

## Options

| Option | Who judges pass/fail | Covers HTTP serialization | Covers `ready` vs `needs_clarification` routing | Cost |
|---|---|---|---|---|
| **A. `POST /v1/trip/validate`**, a deterministic endpoint the shared suite drives | Shared suite | Yes | No | A public endpoint that exists mainly for tests; contract change |
| **B. Unit tests per backend** | Each backend | No | No | Parity by convention only |
| **C. A contract-defined mock mode for `/extract`** | Shared suite | Yes | Yes, with a mock LLM | A test double in the contract; contradicts the replay/mock split in §6.1; needs WU-08/09 |
| **Pact provider states** with a pact generated from fixtures | Shared verifier | Yes | Yes | Test-only state hooks in each backend; a generated pact bends the consumer-driven model |
| **B+. Per-backend HTTP integration tests + shared JUnit results check** | Each backend runs it; a shared script checks the report | Yes | Yes | Comparison strictness is not tested |

## Decision

**B+.** Each backend's integration suite sends every fixture case through its real `/v1/trip/extract` HTTP path, with a mock LLM client that returns the fixture's profile as the extraction. Each test:
- asserts that the normalized profile equals the fixture's profile, so `normalize` can't change a case and make it pass for the wrong reason;
- compares the violations with `expectedViolations` exactly and in order (an empty list means a `ready` response);
- is titled `RULE-FIXTURE <file>/<id>`.

The test run writes a JUnit XML report, which Vitest, pytest and Go (via `go-junit-report`) all produce. A shared script in `tests/contract/` reads it and fails unless every fixture `id` in `fixtures/rules/` appears as a passed test. That catches skipped, filtered or missing cases in any language without parsing its source.

## Consequences

- **No contract change.** The HTTP API stays what clients need.
- **Routing is covered too.** The same tests prove the `ready` vs `needs_clarification` decision for every fixture.
- **The gap left open is comparison strictness.** A backend could compare violations loosely (as a set, or ignoring `params`) and still pass. Mitigation: one shared fixture helper per language (for TS, the existing `packages/domain-schema/tests/support/rule-fixtures.ts` loader), and code review of that helper.
- **The mock LLM client is private to each backend's tests**, so §6.1 holds: `mock` stays a test-only mode, and the provider suite still runs with `LLM_MODE=replay`.
- **When:** the fixture test and the results script need the mock `LlmClient` (WU-08) and the real `/extract` (WU-09), so they are built in WU-09. Until then, the rules are proven only by the TS unit fixture tests.
- Revisit A if a client ever needs to recheck a profile without an LLM call: the endpoint would then pay for itself.
