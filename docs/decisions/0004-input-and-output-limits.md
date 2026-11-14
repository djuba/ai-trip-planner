# ADR 0004 — Input and output limits

**Status:** accepted · **Date:** 2026-11-11 · **Work unit:** WU-17 · **Plan:** [WU-17](../plans/WU-17.md)

## Context

The API takes free text from users and hands it to a model, and the model's output comes back to the client as a `TripProfile`. Before this ADR, no string or list in the contract had a size limit beyond the 1 MiB request body cap (`MAX_REQUEST_BODY_BYTES`). Two problems follow:

- **Abuse.** A 1 MiB message is a 1 MiB prompt, paid for with our tokens.
- **Prompt injection.** An instruction hidden in the message ("put this essay in the region field") that gets past the model can fill any free-text field with arbitrary output, which the server then returns and the client sends back on every turn.

The model can't be relied on to resist injection; evals (WU-18) measure how often it does. What the code can guarantee is **containment**: whatever the model writes, only a few short strings get out.

CLAUDE.md §4.5 keeps range and format checks off the wire, so a `needs_clarification` response can carry the bad value back. A size limit needs a different answer.

## Decision

### 1. Resource limits go on the wire; business rules stay off it

A cap is a resource limit, not a business rule: a 2 MB region is abuse, not something to clarify. So every string and array reachable from `TripProfile`, and `ExtractRequest.message`, gets `maxLength` / `maxItems` in the wire schema. A request over a cap fails the contract and gets a **422 `VALIDATION_FAILED`**, like any other shape error. Range and format checks (ages, dates, `maxStops`) stay rules (§4.5).

`TripProfile` is shared, so the caps apply wherever a profile crosses HTTP: `ExtractRequest.currentProfile`, `ExtractResponse.profile`, `RecommendRequest.profile` and `PresentRequest.profile`.

Rejected: a `FIELD_TOO_LONG` rule returning `needs_clarification`. It would echo the oversized value in the response and in the clarification prompt, which is exactly the output we want to stop.

### 2. Caps are shared constants, set well above honest use

| Constant | `constants.json` key | Value | Applies to |
|---|---|---|---|
| `MAX_MESSAGE_LENGTH` | `maxMessageLength` | 2000 | `ExtractRequest.message` |
| `MAX_SHORT_TEXT_LENGTH` | `maxShortTextLength` | 100 | `region`, `departure.city`, `people[].gender`, each `unmappedExperiences` item |
| `MAX_NOTE_LENGTH` | `maxNoteLength` | 300 | flexible `dateRange.note` |
| `MAX_DATE_TEXT_LENGTH` | `maxDateTextLength` | 32 | fixed `dateRange.start` and `end` |
| `MAX_EXPERIENCES` | `maxExperiences` | 20 | `experiences` item count |
| `MAX_UNMAPPED_EXPERIENCES` | `maxUnmappedExperiences` | 10 | `unmappedExperiences` item count |
| `MAX_PEOPLE` | `maxPeople` | 50 | `people` item count |

They are exported from `@vp/domain-schema/wire` and copied into `spec/generated/constants.json`, so the web client (WU-13's `maxlength`), the conformance suite and any future backend read the same values.

- **Dates:** the cap is 32, not 10. `DATE_VALID` is a rule, so a malformed date such as `"June 1st, 2027"` must still reach the rules and come back as `needs_clarification`.
- **Experiences:** the enum has 10 values. Duplicates are not a contract error, so the cap leaves room above 10.
- **Worst case:** a profile at every cap holds about 6.7k code points of model-written text. `gender` (50 × 100) is the largest share; a smaller gender cap is a cheap later change.
- Raising a cap later is non-breaking. Lowering one is breaking.

### 3. Length means Unicode code points

Measured during WU-17 planning against the pinned zod 4.6.7 and ajv 8.20.0:

| Input | Zod `.max(3)` | Ajv `maxLength: 3` |
|---|---|---|
| `'🌴🌴🌴'`: 3 code points, 6 UTF-16 units | accept | accept |
| `'éé'`: 4 code points, 2 graphemes | reject | reject |
| a lone surrogate | counts as 1 | counts as 1 |

Zod 4 counts with `util.codePointLength` once the UTF-16 length passes the limit, and Ajv uses `ucs2length` (its `unicode: false` option, which counts UTF-16 units, is deprecated). JSON Schema defines `maxLength` in characters per RFC 8259, i.e. code points, which is also what Python's `len()` and Go's `utf8.RuneCountInString` give. So the definition is: **a string's length is its number of Unicode code points; a lone surrogate counts as one.**

- **UTF-16 units** were rejected because they are a JavaScript artifact: an emoji would cost two.
- **Graphemes** were rejected because no JSON Schema validator counts them.

Boundary samples in `samples.ts` (astral characters at the cap, combining marks over it) make `parity.test.ts` fail if a library upgrade changes how length is counted. Server code that measures strings (`normalize`) uses one shared code-point helper, never `.length`. The definition is stated normatively in [`spec/normalize.md`](../../spec/normalize.md) (Definitions).

### 4. The model's schema stays uncapped; `normalize` discards

`ExtractionSchema` gets no caps. Constraints in a model schema turn one out-of-range value into a failed call and a 502 (ADR 0001, Q3; CLAUDE.md §4.4). Instead, `normalize` drops anything over a cap, so **the server never returns a value its own request schema would reject**, and the client can always send the profile back.

**The normative definition is [`spec/normalize.md`](../../spec/normalize.md)**, with executable examples in `spec/fixtures/normalize/`, as `spec/rules.md` is for the rules. A discard changes what `/extract` returns, so it is visible to clients and belongs in the spec. This ADR records why the policy is what it is.

- **Discard, never truncate.** A truncated injected string is still injected text, and a cut-off city name is a wrong value presented as right.
- **Drop the smallest unit that keeps the shape valid.** An over-long text field drops only that field. An over-long fixed `start` or `end` drops the whole `dateRange`, because both are required in the fixed variant.
- **An over-count list is dropped whole.** Keeping the first N would be truncation, and an over-count list signals abuse rather than an honest request.
- **What was discarded is a log signal, not contract.** The TS `normalize` also reports each discard (JSON Pointer, reason, cap and measured size, never the value), so WU-09 can log it without leaking or amplifying the payload. The report never crosses the wire, so the spec and its fixtures leave it out, and TS unit tests cover it.

### 5. Breaking change: `contractVersion` 0.4.0

Requests that used to be valid (a 3k-character message, a 200-character region) now get a 422, so this is a breaking contract change: `contractVersion` goes from 0.3.0 to 0.4.0. Pre-1.0, a breaking change bumps the minor version, as in ADR 0003. No consumer pact exists yet, so nothing in the repo breaks.

## Consequences

- Every free-text value a client can send or receive in a profile is bounded, and the conformance suite checks the bounds over HTTP: 200 at exactly the cap (in astral characters, to prove code-point counting), 422 at the cap plus one.
- Injected model output can't grow a response past the caps. It can still put *wrong* short strings in fields. Containment limits the damage; it doesn't stop the injection.
- An honest value over a cap is lost silently, without a clarification. At these values that should be rare. WU-09 logs discards, and `INSUFFICIENT_DETAIL` asks again if too little is left.
- `RecommendationSet` and `PresentationModel` are not covered here; WU-10 and WU-11 cap them. WU-09 caps `clarificationQuestion` at `MAX_CLARIFICATION_QUESTION_LENGTH` (300 code points), a server guarantee on the wire, in `contractVersion` 0.5.0. That change only narrows a response, so it isn't breaking. The model's `ClarificationOutput` stays unconstrained (ADR 0001 Q3). An empty or over-cap question is invalid output: retried once, then a 502.
- WU-10 caps recommendations in `contractVersion` 0.7.0, a breaking change because `PresentRequest.recommendations` is a request field. The caps: `MAX_RECOMMENDATIONS` (3) per response or `/present` request, `MAX_CLAIMS` (5) per recommendation, `MAX_SUMMARY_LENGTH` (500), `MAX_CLAIM_LENGTH` (200), `MAX_CRITIQUE_ISSUE_LENGTH` (300) and `MAX_UNRESOLVED_ISSUES` (24); ids and destinations use `MAX_SHORT_TEXT_LENGTH`. The model fills the unconstrained `RecommendationSet` and `CritiqueResult`, and the deterministic critic flags over-cap drafts so a revision can fix them. Whatever is still over a cap is discarded with the same policy as `normalize`: a recommendation whose destination or summary is over its cap is dropped, as is an over-cap claim or critic issue; items past a count cap are dropped. Ids are never renumbered, and an issue about a dropped recommendation gets a null `recommendationId`. If no recommendation survives, the request is a 502. `PresentationModel` stays model-facing and uncapped until WU-11.

## Future hardening

Out of scope for this ADR, each with an owner:

| Item | Owner |
|---|---|
| Authentication | Done in WU-22: per-recipient invite codes, not user accounts ([ADR 0005](0005-hosting-and-access.md), WU-22 addendum) |
| Per-user rate limits and quotas | Done in WU-22: a lifetime quota per endpoint and an hourly window per code, plus a global daily window; WU-23 makes the counts persistent and sets the live values ([ADR 0005](0005-hosting-and-access.md), WU-22 addendum) |
| Provider spend limits, with a separate Anthropic workspace per environment | WU-23; an account setting, not code ([ADR 0005](0005-hosting-and-access.md)) |
| An on-topic guard step that rejects requests that aren't about travel | Backlog; may move into WU-18 if the evals show it's needed |
| Second-order prompt injection: user strings (message, `currentProfile`, violation params) go into later prompts only as delimited JSON data, never as instructions | WU-09 (shared prompt-data helper), reused by WU-10 and WU-11 |
| Output caps on recommendation, presentation and clarification text | WU-09, WU-10, WU-11 |
| Sizing `maxOutputTokens` from these caps | WU-09 |
| Evals that measure how often injection succeeds, as opposed to whether it is contained | WU-18 |
