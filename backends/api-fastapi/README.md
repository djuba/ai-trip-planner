# api-fastapi (future)

Python (FastAPI) backend. Not started; this directory holds only this README until the work is requested. No placeholder implementation belongs here.

## Contract it must satisfy

- Serve the HTTP API v1 described in `CLAUDE.md` §5 (`/v1/trip/extract`, `/v1/trip/recommend`, `/v1/trip/present`, `/v1/health`) with `backend: 'fastapi'` in the health response.
- Generate its models from `packages/domain-schema/generated/` (JSON Schema, `openapi.yaml`, `constants.json`), never from the TypeScript sources.
- Implement the invariant rules in `packages/domain-schema/rules.md`.
- Run with `LLM_MODE=replay` and pass both contract halves via `pnpm test:contract:external` with `API_BASE_URL` set: the Pact verification (`tests/contract/pact-verify.test.ts`) and the schema-first conformance suite (`tests/contract/conformance/**`). See `CLAUDE.md` §6.5.
- Prove rule parity ([ADR 0002](../../docs/decisions/0002-rule-parity-across-backends.md)): an integration test sends every case in `packages/domain-schema/fixtures/rules/` through this backend's real `/v1/trip/extract` with a mock LLM client returning the fixture's profile, asserts the normalized profile is unchanged, compares violations exactly and in order, and titles each test `RULE-FIXTURE <file>/<id>`. Its JUnit XML report must pass the shared results check in `tests/contract/`.
