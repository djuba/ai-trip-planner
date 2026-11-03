# ADR 0001 — Structured output with the AI SDK and Claude 5.5

**Status:** accepted · **Date:** 2026-10-27 · **Work unit:** WU-03 · **Evidence:** `spikes/structured-output/` (non-production; probes + captures)

## Context

Every pipeline stage (CLAUDE.md §7) depends on getting schema-shaped JSON out of Claude through the Vercel AI SDK. CLAUDE.md §8.2 listed known hazards: Sonnet 5.5 rejects forced `tool_choice`, the 5.5 models reject sampling params, the SDK's structured-output API has moved between majors, and refusals need a defined error path. The `/present` endpoint also has to stream in a format any backend language can produce (§5). This spike answers the seven questions in `docs/work-breakdown.md` (WU-03) with evidence from the pinned versions, before any pipeline code exists.

## Versions tested

| Package | Version |
|---|---|
| `ai` | 7.0.154 |
| `@ai-sdk/anthropic` | 4.0.89 |
| `@ai-sdk/react` | 4.0.158 |
| `@ai-sdk/provider` / `provider-utils` (transitive) | 4.0.34 / 5.0.69 |
| `zod` | 4.6.7 |
| `react` / `react-dom` | 19.3.1 |
| Node / pnpm | 24.22.1 / 12.15.0 |
| Models | `claude-haiku-5-5`, `claude-sonnet-5-5` (both resolved as such in responses) |

The `7.0.155` patch set was published on the day of the spike and was skipped to stay outside pnpm's release-age window. **WU-04, WU-08 and WU-12 should pin exactly the versions above** (add them to the pnpm `catalog:`) unless they deliberately re-run the spike.

Live spend: 15 calls (2 extraction, 12 constructs, 1 stream), about 9k tokens in total. That's a few cents at most.

## Answers

### Q1 — Which API produces structured output?

**`generateText` / `streamText` with `output: Output.object({ schema })`.** Read the result from `result.output` (non-streaming) or `result.partialOutputStream` (streaming).

- `generateObject` / `streamObject` have been deprecated since v6 (`08-migration-guides/24-migration-guide-6-0.mdx`). They are still exported in v7, but **we don't use them**.
- In v7 the response helpers on the `streamText` result (`toTextStreamResponse`, `pipeTextStreamToResponse`, …) are also deprecated. Use the standalone helpers: `createTextStreamResponse({ stream: toTextStream({ stream: result.stream }) })`.
- `useObject` is stable in `@ai-sdk/react` v4. `experimental_useObject` is a deprecated alias.

Evidence: `q1-q4-structured.ts`, `q7-use-object.ts`, and the pinned docs under `node_modules/ai/docs/`.

### Q2 — Native structured output on Sonnet 5.5 and Haiku 5.5, without forced `tool_choice`?

**Yes, on both, in the default `structuredOutputMode: 'auto'`.** The request carries `output_config.format = { type: 'json_schema', schema }` and has no `tools` and no `tool_choice`. No beta header is sent.

The exception is `structuredOutputMode: 'jsonTool'`:
- On **Haiku 5.5** it sends a synthetic `json` tool with `tool_choice: { type: 'any' }`, i.e. a forced tool call.
- On **Sonnet 5.5** the provider refuses it, falls back to `outputFormat`, and emits a warning. The provider's capability table marks Sonnet 5.5 `rejectsForcedToolUse: true`.

**Decision:** the `LlmClient` always passes `structuredOutputMode: 'outputFormat'` explicitly. That way, swapping `MODEL_*` env vars can never silently switch a stage to forced tool use.

Evidence: `captures/q2-request-*.json` (8 model × setting combinations), live calls in `captures/q3-live-extract-*.json`.

### Q3 — Does a required-but-nullable schema round-trip? Are any Zod constructs rejected?

**The §4.4 shape round-trips on both models.** The probe used every field required + `.nullable()`, a nullable discriminated union for `dateRange`, closed enums, arrays of objects, and `null` for anything unmentioned. Haiku and Sonnet returned identical, schema-valid output for a mixed request: flexible March 2027 dates, 2 adults + a 7-year-old, `beach` + `snorkeling` mapped, and `wine tasting` put in `unmappedExperiences`.

**The provider rewrites the schema before sending it** (`sanitizeJsonSchema` in `@ai-sdk/anthropic`):

| Construct | Sent to Anthropic | Live result | Verdict for LLM-facing schemas |
|---|---|---|---|
| `.nullable()` → `type: [T, 'null']` | unchanged | ✅ | **use** |
| `.optional()` | dropped from `required` | ✅ | avoid (§4.4 already requires nullable instead) |
| `z.enum`, `z.literal` (`const`) | unchanged | ✅ | **use** |
| `z.discriminatedUnion` (`oneOf`) | rewritten to `anyOf`, `additionalProperties: false` added | ✅ | **use** |
| `z.union` of primitives | unchanged | ✅ | ok |
| `.default()` | unchanged | ✅ | avoid (§4.1) |
| `z.int().min().max()`, `.regex()`, `z.array().min().max()`, `minLength`, … | **removed** and appended to `description` ("minimum: 1; maximum: 12.") | ✅ accepted | **avoid** — see below |
| `z.iso.date()` | `format: 'date'` kept; its long regex is moved into `description` | ✅ | **avoid** — adds ~180 input tokens per field |
| `z.record()` | `additionalProperties` forced to `false` | ⚠️ accepted, but the model can only return `{}` | **never** |
| `z.tuple()` | `prefixItems` mangled into `items: [...]` | ❌ **HTTP 400** ("Array types must be specified with a single object schema for 'items'") | **never** |

Why constraints are dangerous: the constraint is only a *hint* to the model, but the SDK still validates the result against the **full** Zod schema. A value outside the range (e.g. `month: 13`) therefore fails the entire call with `NoObjectGeneratedError`/`TypeValidationError`, which §7 maps to retry, then 502. That sends a business problem down the infrastructure error path, when it should become a `needs_clarification` with a rule code.

**Decision:** `ExtractionSchema` (and every other schema handed to the model) uses only: object, string, number/integer, boolean, enum, literal, nullable, array, and discriminated union. No `tuple`, `record`, `.optional()`, `.default()`, numeric/length/pattern constraints or `format`s. Range and format checks belong in `src/rules/` (§4.5). Wire schemas (`TripProfile` etc.) may still carry JSON-Schema constraints for contract validation, because the model never fills them in directly. `normalize()` sits between the two.

Evidence: `q3-constructs.ts`, `captures/q3-construct-*-{request,live}.json`, `captures/q3-live-extract-*.json`.

### Q4 — How is `effort` passed? Are sampling params sent?

- **`providerOptions: { anthropic: { effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max' } }`** is sent as `output_config.effort` (merged with `output_config.format`). Type it with `satisfies AnthropicLanguageModelOptions`.
- **No sampling params are sent by default.** If `temperature` (or `topP`/`topK`) is passed, the provider **drops it** for both 5.5 models and emits an SDK warning (it never reaches the API). So a 400 isn't the risk; a setting silently not taking effect is. §8.2's "do not set" rule stands.
- **`max_tokens` defaults to the model maximum (128 000)** when `maxOutputTokens` isn't set. **Decision:** every stage sets `maxOutputTokens` explicitly (cost guard, §8.3).
- Sonnet 5.5 thinking is adaptive and cannot be disabled. At `effort: 'low'` the extraction call used 0 reasoning tokens on both models.
- SDK warnings are printed to the console by default and are also available as `result.warnings`. **Decision:** WU-08 integration tests assert `warnings` is empty, so a dropped option fails a test instead of disappearing into a log.

Evidence: `captures/q2-request-*-{effort-low,temperature-0.5-passed}.json`; the SDK warnings printed by `q1-q4-structured.ts`.

### Q5 — What do a refusal and a schema-invalid response look like to our code?

All of these were produced offline from synthetic Anthropic responses through the custom `fetch`:

| Upstream | What our code sees |
|---|---|
| `stop_reason: "refusal"` (with or without `stop_details`) | `generateText` **resolves**: `finishReason: 'content-filter'`, `rawFinishReason: 'refusal'`, details (if any) on `providerMetadata.anthropic.stopDetails`. Reading `result.output` **throws** `NoOutputGeneratedError`. |
| JSON that violates the schema (`month: 13`, missing fields) | rejects with `NoObjectGeneratedError` (`cause`: `TypeValidationError`; `.text` holds the raw model text) |
| Text that isn't JSON | `NoObjectGeneratedError` (`cause`: `JSONParseError`) |
| Truncated JSON (`stop_reason: "max_tokens"`) | `NoObjectGeneratedError`, `finishReason: 'length'` |
| HTTP 400 | `APICallError`, `statusCode: 400`, `isRetryable: false`; 1 attempt |
| HTTP 529 (default settings) | **3 attempts** (SDK default `maxRetries: 2`), then `RetryError` (`reason: 'maxRetriesExceeded'`, `.lastError` = `APICallError` 529) |
| HTTP 529 with `maxRetries: 0` | `APICallError` 529, `isRetryable: true`; 1 attempt |

**Decisions:**
- Check `finishReason === 'content-filter'` **before** reading `output`, and map it to `502 LLM_REFUSAL`. Don't rely on `stop_details` being present.
- Set **`maxRetries: 0`** on every SDK call. The `LlmClient` owns the single retry (§7 "retry once, then 502") and applies it uniformly to retryable `APICallError`s and `NoObjectGeneratedError`. Non-retryable `APICallError`s (4xx) go straight to 502. Otherwise SDK retries would multiply our own retry and record duplicate cassette entries.
- We don't adopt Anthropic's server-side `fallbacks` option for now. A refusal for a vacation planner is an anomaly to surface, not something to reroute.

Evidence: `q5-failures.ts`, `captures/q5-*.json`.

### Q6 — Can the provider take a custom `fetch`?

**Yes:** `createAnthropic({ fetch })`. Every request goes through it, including SDK retries (3 calls for the default 529 case), which is another reason for `maxRetries: 0`. What WU-08 can rely on:

- The request body is a JSON **string** that includes `model`, `max_tokens`, `system`, `messages` and `output_config` (schema + effort). Hashing the body therefore invalidates a cassette when the schema, prompt, model or effort changes, which is what we want.
- **Response headers identify the account:** `anthropic-organization-id` and `anthropic-workspace-id`, plus rate-limit and CDN headers. Cassettes are committed to a public repo, so the recorder must **allowlist** response headers (the spike keeps only `content-type` and `request-id`) rather than denylist them. The spike's first captures had to be scrubbed after the fact.
- Request headers are `anthropic-version`, `content-type`, `user-agent` (`ai/7.0.154 … node.js/24`) and `x-api-key`. Only `x-api-key` is secret. The SDK version sits in the user-agent header, not the body, so an SDK patch bump doesn't invalidate cassettes.
- Streaming responses are `text/event-stream` SSE. **Pitfall found:** a recorder that `await`s `response.clone().text()` before returning buffers the whole stream, so the consumer receives everything as one chunk. The first Q7 run showed exactly that: 1 partial state instead of 16. The recorder must return the response immediately and record the clone in the background. Replay should re-emit events as separate chunks.

Evidence: `capture-fetch.ts`, `q5-failures.ts` (`fetchCalls`), `captures/q7-sdk-stream-haiku.json`.

### Q7 — Does the partial-object stream work with `useObject` from a plain `text/plain` response?

**Yes, from both an SDK producer and a non-SDK producer.** The real `useObject` hook ran under jsdom against two local HTTP servers:

| Producer | `content-type` | Partial states seen | Final object |
|---|---|---|---|
| Hand-chunked `JSON.stringify` written 7 bytes at a time (a stand-in for FastAPI/Go; splits tokens, strings and a multibyte `ú`) | `text/plain; charset=utf-8` | 25 | schema-valid |
| `streamText` + `Output.object` → `toTextStream` → `createTextStreamResponse` (live Haiku) | `text/plain; charset=utf-8` | 16 | schema-valid |

This confirms §5's portable wire format: raw JSON text, no SDK framing. Things the client (WU-14) must handle:
- Partial objects have **missing keys and truncated string values** (e.g. `blurb: "Calm tur"`), not just `undefined` fields.
- `onFinish({ object, error })` gives the validated final object, or a `TypeValidationError` if the finished stream doesn't match the schema. That's the "final `safeParse`" in §5.
- The hook sends `POST` with `JSON.stringify(input)` and `content-type: application/json`, so cross-origin `/present` needs a CORS preflight (WU-06).

Not covered here: errors in the middle of a stream (`streamText` reports them through `onError` rather than throwing). That's left to WU-11.

Evidence: `q7-use-object.ts`, `captures/q7-sdk-stream-haiku.json`.

## Decision

Build every stage on `generateText`/`streamText` + `Output.object`, through an `LlmClient` that:
- always passes `structuredOutputMode: 'outputFormat'`, an explicit `maxOutputTokens`, `maxRetries: 0`, and `effort` per stage (never sampling params);
- maps `content-filter` → `LLM_REFUSAL` and handles `NoObjectGeneratedError` / retryable `APICallError` with exactly one retry, then 502;
- takes a custom `fetch` for record/replay, recording streams without buffering them.

LLM-facing schemas use only the constructs marked **use** in Q3. `/present` streams with `toTextStream` + `createTextStreamResponse`.

## Consequences

- **CLAUDE.md** updated in the same commit: §4.4 (the LLM-facing schema construct rule), §7 (stage 3 streaming helpers; partial strings), §8.2 (rewritten from "check" items into confirmed rules linking here).
- **WU-04:** pin the versions above in the catalog. `ExtractionSchema` follows the Q3 construct rule.
- **WU-04/05:** decide whether the flexible `month` range (1–12) becomes part of `DATE_VALID` or another rule code, since it can't be a schema constraint on the extraction side. That's a rule-catalog change (`rules.md`, CLAUDE.md §4.6), so it's raised there rather than made here.
- **WU-06:** CORS must answer the preflight for `useObject`'s JSON `POST` to `/present`.
- **WU-08:** the `LlmClient` defaults listed under Decision; cassette key = hash of the request body string; strip `x-api-key`; allowlist response headers; non-buffering stream recording; assert `warnings` is empty in integration tests.
- **WU-09/10:** check `finishReason` before reading `output`; set `maxOutputTokens` per stage.
- **WU-11:** `toTextStream` + `createTextStreamResponse`; test mid-stream errors.
- **WU-12:** pin `@ai-sdk/react` (and `react`/`react-dom`) at the versions above; use `useObject`, not `experimental_useObject`.
- **WU-14:** cards must render truncated strings as well as missing fields. Use `useObject`'s `onFinish` for the final validation.
- Revisit this ADR on any `ai` major upgrade (v8 is expected to remove the deprecated helpers).
