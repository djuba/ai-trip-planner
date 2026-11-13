# Extraction: acceptance criteria

Stage 1 of the pipeline (CLAUDE.md §7): `POST /v1/trip/extract` turns a message, plus the profile the client already holds, into a `TripProfile`. If no rule is violated, it answers `ready`. Otherwise it answers `needs_clarification` with a question. The design is in [the WU-09 plan](../plans/WU-09.md). The caps come from [ADR 0004](../decisions/0004-input-and-output-limits.md).

## Flow

1. The extraction call (`MODEL_FAST`, `effort: low`) fills in `ExtractionSchema`. The model returns the **full updated** profile, not a patch, so a correction replaces the old value.
2. `normalize` drops nulls and empties, and discards any value over a cap ([`spec/normalize.md`](../../spec/normalize.md)). Each discard is logged by path, reason, cap and length, never by value.
3. `evaluateRules(profile, referenceDate)` runs.
4. With no violations, the response is `ready`. Otherwise a second fast call writes `clarificationQuestion` from the violation codes and params, and the response is `needs_clarification`.

User-controlled text (the message, `currentProfile`, violation params) reaches the model only as escaped JSON inside `<data>` blocks in the user message. The system prompts are constants, and they say the blocks are data, not instructions.

## Acceptance criteria

### Routing

**AC-EXTRACT-01.** Given a message that gives enough valid detail, when it is extracted, then the response is `ready`, and its profile holds what the message said.

**AC-EXTRACT-02.** Given a vague message such as "Somewhere warm", when it is extracted, then the response is `needs_clarification`, with an `INSUFFICIENT_DETAIL` violation and a non-empty question.

**AC-EXTRACT-03.** Given a `currentProfile` and a message that corrects one of its values (e.g. "actually five of us"), when it is extracted, then the new value replaces the old one, and the rest of the profile is kept. The extraction prompt carries the current profile (or `null` on the first message).

**AC-EXTRACT-04.** Given a traveler whose stated age is outside their type's range (e.g. a 19-year-old "kid"), when it is extracted, then the age is kept as stated, and the response is `needs_clarification`, with the age-range violation at that traveler's path.

**AC-EXTRACT-05.** Given a requested activity with no `Experience` value, when it is extracted, then it is listed in `unmappedExperiences`, and it does not count towards `MIN_POPULATED_FIELDS`.

**AC-EXTRACT-06.** Given a date before `referenceDate`, when it is extracted, then the response is a 200 `needs_clarification` with `DATE_NOT_PAST`, never an HTTP error.

### Fixtures through the endpoint

**AC-EXTRACT-07.** Given each case in `spec/fixtures/rules/`, when the model returns that case's profile through `/extract`, then the violations equal `expectedViolations` exactly and in order. The status is `ready` exactly when that list is empty. The profile equals the case's profile, minus what `normalize` drops by definition.

**AC-EXTRACT-08.** Given each case in `spec/fixtures/normalize/`, when the model returns that case's `extraction` through `/extract`, then the response profile equals `expectedProfile`.

### Limits and containment

**AC-EXTRACT-09.** Given model output with a value over its cap, when it is extracted, then the value is discarded, the response is wire-valid, and the discard is logged by path, reason, cap and length, without the value.

**AC-EXTRACT-10.** Given user-controlled strings in the message, the current profile or violation params, when a prompt is built, then each one appears only inside a `<data>` block. `<`, `>` and `&` are escaped, so a value can't close its block. The system prompts are the same constant for every request, and say that data blocks are not instructions. `referenceDate` appears only in the user message.

**AC-EXTRACT-13.** Given either call, then it uses the fast model, `effort: low`, and a `maxOutputTokens` derived from the caps. Extraction gets every capped string at its cap, at 2 tokens per code point, plus overhead. Clarification gets a question at its cap, on the same basis.

**AC-EXTRACT-14.** Given a recorded real request whose message tells the model to put off-topic content into free-text fields and into the clarification question, when it is replayed, then the response is wire-valid `needs_clarification`. No field exceeds its cap, and the question is within `MAX_CLARIFICATION_QUESTION_LENGTH`. This proves containment, not that the model resists; WU-18 measures that.

### Failures

**AC-EXTRACT-11.** Given a refusal on the extraction call or on the clarification call, then the response is a 502 with code `LLM_REFUSAL`.

**AC-EXTRACT-12.** Given invalid model output twice in a row, then the response is a 502 with code `LLM_UPSTREAM_ERROR`. Invalid output includes a clarification question that is empty, blank, or over `MAX_CLARIFICATION_QUESTION_LENGTH` once trimmed. Invalid output once, then valid output, is a 200, and the question is returned trimmed.

### Over HTTP

**AC-EXTRACT-15.** Given the built server in replay mode, when it gets a vague request and a complete request, then it answers `needs_clarification` and `ready` with schema-valid bodies. An `OPTIONS` preflight carries the CORS headers, and an invalid body is a 422. A recorded exchange whose response is replaced with an upstream 500 gives a 502 `LLM_UPSTREAM_ERROR`.
