# API skeleton

HTTP plumbing of `backends/api-nextjs`: health, body handling, error envelopes, CORS, config and server lifecycle. There is no AI yet. See CLAUDE.md §5.

The cap in AC-API-04 is `MAX_REQUEST_BODY_BYTES`, shared through `spec/generated/constants.json`.

## Health

**AC-API-01.** Given the server is running, when a client calls `GET /v1/health`, then it gets a 200 whose body is exactly `{ status: 'ok', contractVersion }`, with `contractVersion` equal to `CONTRACT_VERSION`.

## Request bodies

**AC-API-02.** Given a POST route, when the body is valid JSON that fails the route's schema, then the response is a 422 `VALIDATION_FAILED` and the handler is not called.

**AC-API-03.** Given a POST route, when the body is malformed JSON, empty, invalid UTF-8 or JSON of the wrong type, then the response is a 422 `VALIDATION_FAILED` and the handler is not called.

**AC-API-04.** Given a POST route, when the body is over the cap, then the response is a 413 `PAYLOAD_TOO_LARGE`, whether or not it declares a `content-length`, and reading stops at the cap. A body exactly at the cap is accepted. A `content-length` that can't be parsed doesn't reject the body.

## Errors

**AC-API-05.** Given a handler throws an LLM refusal, then the response is a 502 `LLM_REFUSAL`.

**AC-API-06.** Given a handler throws an upstream LLM failure, then the response is a 502 `LLM_UPSTREAM_ERROR`.

**AC-API-07.** Given a handler throws anything else, including a value that isn't an `Error`, then the response is a 500 `INTERNAL_ERROR` with no error detail in the body, and the error is logged.

**AC-API-11.** Given a handler builds a response that fails its schema, then the client gets a 500 `INTERNAL_ERROR`, not the bad body. A valid body is sent as JSON with the given status.

## CORS

**AC-API-08.** Given `WEB_ORIGIN` is set, then every 200, 413, 422, 502 and 500 from the adapter carries `Access-Control-Allow-Origin: <WEB_ORIGIN>`.

**AC-API-09.** Given a browser sends a preflight for a JSON `POST`, then the response is a 204 allowing `POST` and the `content-type` header, for the web origin.

**AC-API-10.** Given any `src/app/**/route.ts`, then it exports an `OPTIONS` handler that answers the preflight. Next's automatic answer has no CORS headers.

**AC-API-12.** Given a handler returns a streaming response, then it passes through unbuffered, keeps its headers and gains the CORS header.

**AC-API-19.** Given a built server, when it runs with a `WEB_ORIGIN`, then it uses that value rather than one from build time.

## Config

**AC-API-13.** Given a complete env, then `loadConfig` returns a typed config. A missing or blank `WEB_ORIGIN` takes the default, `http://localhost:3000`.

**AC-API-14.** Given several bad variables, then `ConfigError` names all of them and contains none of their values.

**AC-API-15.** Given `LLM_MODE` is `live` or `record`, then `ANTHROPIC_API_KEY` is required. Given `replay` or `mock`, it isn't.

**AC-API-16.** Given a `WEB_ORIGIN` with a path or trailing slash, then config is rejected, because that value would silently break CORS.

## Lifecycle

**AC-API-17.** Given an invalid config, when the built server starts, then it exits non-zero and names the variable. A build doesn't depend on config.

**AC-API-18.** Given a running server, when the harness stops it, then its port refuses connections.
