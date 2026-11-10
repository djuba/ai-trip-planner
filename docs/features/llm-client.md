# LLM client: record, replay and mock

The one boundary every pipeline stage uses to call a model (CLAUDE.md §7, §8). Use cases call the `LlmClient` interface in `backends/api-nextjs/src/usecases/llm-client.ts`. The implementation in `src/llm/` runs the AI SDK's `generateText` with `Output.object` and applies the call defaults from [ADR 0001](../decisions/0001-structured-output.md): `structuredOutputMode: 'outputFormat'`, `maxRetries: 0`, an explicit `maxOutputTokens`, and `effort`, but no sampling params.

## Modes (`LLM_MODE`)

| Mode | Network | Used by |
|---|---|---|
| `live` | Anthropic, directly | Opt-in manual runs. Costs money. |
| `record` | Anthropic, and every 2xx exchange is written to a cassette | `pnpm record:cassettes <test filter>` only. Costs money. |
| `replay` | None. Answers come from cassettes; a miss is an error | Every gated test (forced by `vitest.config.ts`) and the functional/contract servers |
| `mock` | None. The AI SDK's `MockLanguageModelV4` answers per stage | Unit tests of use cases |

**Gates can't go live.** Vitest forces `LLM_MODE=replay` and blocks `fetch` to any non-loopback host, except in the `contract` project, which has to reach any `API_BASE_URL`. Both protections are lifted only when `VP_LLM_RECORD=1` **and** the run was started by `pnpm record:cassettes`.

## Cassettes

- Location: `.llm-cassettes/api-nextjs/<sha256 of the request body>.json`. Override with `LLM_CASSETTE_DIR`.
- The key is the exact request body string. Changing the prompt, schema, model or effort changes the key; headers, including the SDK user agent, don't.
- Request headers are never stored. Response headers are allowlisted to `content-type` and `request-id`, because Anthropic responses carry account identifiers.
- Streamed (SSE) responses are stored as a list of events and replayed one event per chunk. The recorder never buffers a stream before returning it.
- Each key holds exactly one exchange, and only 2xx responses are recorded. A retry with the same body overwrites the file. Error responses are passed through unrecorded with a warning.
- To re-record: `pnpm record:cassettes <test file filter>`. It needs `ANTHROPIC_API_KEY` in the root `.env.local`. Review the cassette diff before committing; `cassette-hygiene.test.ts` and `gitleaks` check it too.

## Failure handling

| What happened | Result | Retried? |
|---|---|---|
| Refusal (`finishReason: 'content-filter'`) | `LlmError` `LLM_REFUSAL` → 502 | No |
| Output that isn't JSON, doesn't match the schema, or is truncated | `LlmError` `LLM_UPSTREAM_ERROR` → 502 | Once |
| Retryable HTTP error (e.g. 529, network) | `LlmError` `LLM_UPSTREAM_ERROR` → 502 | Once |
| Non-retryable HTTP error (4xx) | `LlmError` `LLM_UPSTREAM_ERROR` → 502 | No |
| Replay cassette miss | `CassetteMissError` ("re-record with `LLM_MODE=record`") → test failure / 500 | No |
| Mock stage with no responder | `MockNotConfiguredError` → test failure / 500 | No |

Each attempt logs one line with stage, role, model, attempt, outcome, input/output tokens, latency and any SDK warnings.

## Acceptance criteria

**AC-LLM-01.** Given two requests with the same body string, when they are keyed, then they get the same 64-hex-character key regardless of headers; any change to the body gives a different key.

**AC-LLM-02.** Given a recorded exchange whose request carries `x-api-key` and whose response carries account and rate-limit headers, then the cassette has no request headers, only `content-type` and `request-id` response headers, and none of those values.

**AC-LLM-03.** Given replay mode and no cassette for a request, then the call fails with `CassetteMissError` naming the key and model and saying "re-record with `LLM_MODE=record`", and no network call is made.

**AC-LLM-04.** Given record mode and a streaming upstream, then the response is returned before the upstream body ends, and `flush()` resolves once the cassette is on disk. Non-2xx responses are not recorded, and a repeated key keeps the last 2xx exchange.

**AC-LLM-05.** Given an SSE cassette, when it is replayed, then each event arrives as a separate chunk; a JSON cassette replays its status, headers and body.

**AC-LLM-06.** Given a call, then the request uses native structured output (`output_config.format`), the requested `effort`, an explicit `max_tokens` and the role's model, with no sampling params and no tools, and one HTTP request per attempt.

**AC-LLM-07.** Given a refusal, then the call fails with `LLM_REFUSAL` after one request.

**AC-LLM-08.** Given schema-invalid or non-JSON output, then the call is retried once; a valid retry is returned, and a second failure is `LLM_UPSTREAM_ERROR` after exactly two requests.

**AC-LLM-09.** Given HTTP 529, then the call is retried once and then fails with `LLM_UPSTREAM_ERROR`; given HTTP 400, it fails after one request.

**AC-LLM-10.** Given a replay miss inside a real provider call, then it surfaces as `CassetteMissError`, not `LlmError`, after one attempt.

**AC-LLM-11.** Given the committed live cassette, when it is replayed, then the output is valid `ExtractionSchema`, the SDK reports no warnings, and non-zero usage is logged.

**AC-LLM-12.** Given a slow SSE stream recorded through the cassette fetch, when it is replayed through `streamText`, then it yields more than one partial output and a schema-valid final object.

**AC-LLM-13.** Given mock mode, then each stage returns its configured value through the real adapter. `mockObject` rejects an invalid value at construction, `mockRefusal` gives `LLM_REFUSAL`, malformed output is retried and then `LLM_UPSTREAM_ERROR`, and an unconfigured stage throws `MockNotConfiguredError`.

**AC-LLM-14.** Given any call, then each attempt logs stage, role, model, tokens, latency from the injected clock, warnings and outcome, including retries and failures.

**AC-LLM-15.** Given the committed `.llm-cassettes/`, then no file contains key material, account identifiers or a non-allowlisted header.

**AC-LLM-16.** Given a gated test process, then `fetch` to a non-loopback host fails and `LLM_MODE` is `replay`, even with `LLM_MODE=record` or `VP_LLM_RECORD=1` set in the shell.

**AC-LLM-17.** Given each `LLM_MODE`, then `createLlmClient` uses the matching transport: replay never touches the global `fetch`, record and live use the network, models come from config, and mock without responders fails at construction.

**AC-LLM-18.** Given replay or record, then `cassetteDir` defaults to `<workspace root>/.llm-cassettes/api-nextjs` and honours `LLM_CASSETTE_DIR`.
