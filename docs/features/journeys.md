# Journeys and the integrated gate: acceptance criteria

The journeys prove the whole system works from the user's side (CLAUDE.md §6.6): a browser drives `web-nextjs`, which talks to `api-nextjs` over HTTP, which replays recorded LLM calls (`LLM_MODE=replay`). They live in `tests/journeys/`, which imports nothing from other workspaces. The design is in [the WU-15 plan](../plans/WU-15.md) (D1–D13 and the decisions at approval).

## The stack runner

`pnpm test:journeys [playwright args]` runs `scripts/run-journeys.ts`. It:

1. copies `.llm-cassettes/api-nextjs/` to a temporary directory and swaps journey 4's recorded response for a provider `500` there (replay only);
2. builds and starts `api-nextjs` on a free port, configured as when hosted (`LOCAL_DEV=false`, a fresh invite code, `LLM_MODE=replay`, a blank `ANTHROPIC_API_KEY`, `LLM_CASSETTE_DIR` set to the copy);
3. builds `web-nextjs` into `.next-journeys` with `NEXT_PUBLIC_API_BASE_URL` set to that API, and starts it on a free port that is the API's `WEB_ORIGIN`;
4. runs Playwright in `tests/journeys/` with `WEB_BASE_URL` and `JOURNEY_INVITE_CODE`, then stops both servers.

| Command | Runs |
|---|---|
| `pnpm verify:integrated` | journeys tagged `@smoke` or `@critical` |
| `pnpm verify:full` | journeys tagged `@full`, then `pnpm test:contract` |
| `pnpm record:cassettes --journeys [filters]` | the journeys with live LLM calls, writing cassettes (costs money; never a gate) |
| `pnpm record:cassettes --prune` | every replaying suite with a usage log, then deletes cassettes none of them used |

Every journey fixes the browser clock at `2026-11-16T12:00:00Z` (time zone UTC), so the requests' `referenceDate`, and so the cassette keys, never change. Each sends its first message, gets the 401 the API gives without a code, and enters the invite code in the "Invite code" field, as a user would. Journeys assert structure, never model wording.

The messages are chosen so that rules, not the model, decide the path: each first turn populates fewer than `MIN_POPULATED_FIELDS` fields, so it comes back `needs_clarification` whatever the model writes.

## Acceptance criteria

### Journeys (`tests/journeys/specs/`)

- **AC-JOURNEY-01** (`@clarification @smoke`): Given a vague request, when the user sends it, then the conversation asks a clarifying question. When the user answers with the missing details and asks for recommendations, then the results region says "Your recommendations are ready." and shows at least one card heading at level 3.
- **AC-JOURNEY-02** (`@clarification @critical`): Given a request whose party includes a child aged 19, then the clarification's "What needs fixing" list includes the child-age item (the `CHILD_AGE_RANGE` catalog text), and the profile panel marks the travelers as needing attention.
- **AC-JOURNEY-03** (`@clarification @full`): Given a first message with two adults, when the user then says it is four adults, then the profile panel shows four travelers and no longer two.
- **AC-JOURNEY-04** (`@clarification @full`): Given the upstream model fails on the user's message (a provider error, twice), then an alert explains it and offers Retry, the user's message is still in the thread, and the composer can be typed in.
- **AC-JOURNEY-05:** Given each journey's final state, then the page has no axe violations (scanned after animations finish).

### Runner and tooling (unit)

- **AC-JOURNEY-06:** The runner passes its arguments through to Playwright; in replay it gives the API `LLM_MODE=replay`, a blank `ANTHROPIC_API_KEY` even when the parent environment has one, `LOCAL_DEV=false`, the copied `LLM_CASSETTE_DIR` and `WEB_ORIGIN` of the web server; it gives the web build `NEXT_PUBLIC_API_BASE_URL` and `NEXT_DIST_DIR=.next-journeys`; and it gives Playwright `WEB_BASE_URL` and `JOURNEY_INVITE_CODE`. In record mode the API gets `LLM_MODE=record`, `LOCAL_DEV=true` and the real cassette directory, and Playwright gets `JOURNEYS_RECORDING=1`.
- **AC-JOURNEY-07:** The failure swap replaces the response of every cassette whose request contains journey 4's message with a `500 api_error`, leaves every other cassette byte-identical, and fails with an error naming the message when none matches.
- **AC-JOURNEY-08:** In replay, a cassette hit appends its key and a newline to the file named by `LLM_CASSETTE_USAGE_LOG`; with the variable unset nothing is written. A miss writes nothing.
- **AC-JOURNEY-09:** `--journeys` and `--prune` parse (and conflict with each other and with `--contract`/`--project`). The prune deletes exactly the cassettes whose keys are not in the log and whose request bodies contain none of the kept markers. (The runner deletes nothing when a suite failed; that ordering is in `scripts/record-cassettes.ts`, not unit-tested.)
