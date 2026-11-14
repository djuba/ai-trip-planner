# Recommendation: acceptance criteria

Stage 2 of the pipeline (CLAUDE.md §7): `POST /v1/trip/recommend` turns a `ready` profile into critic-checked recommendations, each factual claim labelled honestly. The design is in [the WU-10 plan](../plans/WU-10.md). The caps come from [ADR 0004](../decisions/0004-input-and-output-limits.md).

## Flow

1. `evaluateRules(profile, referenceDate)` runs first. A profile that breaks any rule is not `ready`, so the answer is a 422 `VALIDATION_FAILED` naming the codes, and no model is called.
2. The recommend call (`MODEL_REASONING`, `effort: medium`) fills in `RecommendationSet`: up to three drafts, each with a destination, a summary, the requested experiences it matches, its best months, whether it is adults-only, and its claims. A claim that asserts a non-stop flight carries a structured `nonstopRoute` (IATA codes).
3. The deterministic checks run in code (below), then the LLM critic (`MODEL_CRITIC`, `effort: medium`) reviews the same draft and fills in `CritiqueResult`.
4. If either finds an issue, the draft is revised: the same recommend call, with the previous draft and its issues added. There are at most **2 revisions**.
5. The answer is the first attempt that passes both. Without one, it is the attempt with the fewest issues (a tie goes to the later attempt), with its issues in `critique.unresolved`.
6. Code maps the chosen draft to the wire: it assigns the ids, sets every `verification` label, and discards anything over a cap.

### What `verification` means

Code sets every label; the model never does. A claim is `fixture` only when it is a flight claim, its `nonstopRoute` leaves from the traveler's own airport, and `backends/api-nextjs/data/routes.json` lists that non-stop. Code then writes the statement itself, from the data. Every other claim is `unverified`, with the model's statement.

`routes.json` is illustrative sample data for a few hub airports, not live schedules: `fixture` means "our sample data lists it", never "this flight exists". Any departure city works. One the data doesn't cover just gets `unverified` flight claims.

### What the checks can and can't prove

- The route checks compare the draft with `routes.json`, so they are independent evidence. Whether a route serves a destination is a name match, so a destination named in a way the data and its aliases don't cover is flagged as off-destination: the check errs toward flagging, never toward a `fixture` label that doesn't fit.
- `SEASON_MISMATCH` and `PARTY_ADULTS_ONLY` compare the trip with the draft's own `bestMonths` and `adultsOnly`. They prove the draft is consistent with itself, not that it is true; the LLM critic and the eval judge the truth.
- Code can't label prose. The prompt keeps flight, lodging, price and schedule specifics out of `summary`, and the LLM critic flags a summary that states one, but no test can prove a summary is free of them.

## Acceptance criteria

### Routing

**AC-RECOMMEND-01.** Given a `ready` profile, when recommendations are requested, then the response is a 200 `RecommendResponse` with 1 to `MAX_RECOMMENDATIONS` recommendations, each with a unique id of the form `rec-<n>`. Ids are never renumbered, so a discarded recommendation leaves a gap.

**AC-RECOMMEND-02.** Given a profile with any rule violation (for example a party with no adult), when recommendations are requested, then the response is a 422 `VALIDATION_FAILED` whose message names the violated codes, and no model is called.

### Labels

**AC-RECOMMEND-03.** Given any path through the stage (a first-try pass, after revisions, unresolved, after discards, or a draft that tries to plant a label or an "it's verified" statement), then every claim in the response carries `verification`. A claim is `fixture` only when it is a flight claim whose non-stop route leaves from the traveler's resolved origin and is listed in `routes.json`, and its statement is the one code writes from the data. Every other claim is `unverified`.

### Deterministic checks

Each check gives at most one issue per recommendation. Its text is fixed wording plus the recommendation id and values from `routes.json`, never model text, and is within `MAX_CRITIQUE_ISSUE_LENGTH`.

**AC-RECOMMEND-04.** Given a flight claim with a `nonstopRoute`, when the draft is checked, then `ROUTE_WRONG_ORIGIN` fires if `from` isn't the traveler's resolved origin airport, and `ROUTE_NOT_IN_DATA` fires if it is but the data lists no such non-stop. `ROUTE_OFF_DESTINATION` fires for a listed non-stop that doesn't serve the recommendation's destination: the destination text must name the listed city (any part of it, such as "Maui" or "Kahului" for "Maui (Kahului)"), one of its aliases ("Oahu" for HNL) or its airport code, as whole words, ignoring case, accents and punctuation. Given a departure city the data doesn't cover, then neither fires and the claim is `unverified`. City names resolve through each origin's aliases ("St. Paul", "saint paul", "MSP", "Chicago", "NYC").

**AC-RECOMMEND-05.** Given `maxStops: 0`, a `plane` or unstated mode, and an origin the data covers, when a recommendation has no claim that would be labelled `fixture` for a non-stop serving its destination, then `NONSTOP_REQUIRED` fires. A listed non-stop to somewhere else doesn't count. With `maxStops` other than 0, mode `car` or `train`, or an uncovered origin, it doesn't.

**AC-RECOMMEND-06.** Given a trip whose start month is known, when a draft's `bestMonths` doesn't include it, then `SEASON_MISMATCH` fires. A `bestMonths` value outside 1–12 fires `BAD_MONTH`. The start month comes from a fixed `start`, or from a flexible `month`; a month with no year is its next occurrence from `referenceDate`, and the reference month itself counts as this year.

**AC-RECOMMEND-07.** Given a party with a child, when a draft is `adultsOnly`, then `PARTY_ADULTS_ONLY` fires. Given a `matchedExperiences` value the traveler didn't ask for, then `EXPERIENCE_NOT_REQUESTED` fires.

### Critic and revise loop

**AC-RECOMMEND-08.** Given a draft with deterministic issues, when it is checked, then the LLM critic still reviews it, and the revision's prompt carries the previous draft and every issue as data blocks.

**AC-RECOMMEND-09.** Given a draft with no deterministic issues that the critic passes, then the response has `critique: { pass: true, unresolved: [] }`. Given critic issues, then the draft is revised.

**AC-RECOMMEND-10.** Given drafts that never pass, then there are at most 2 revisions (at most 3 recommend calls and 3 critic calls), and the response has `critique.pass: false` with the best attempt's issues in `unresolved`.

**AC-RECOMMEND-11.** Given attempts that never pass, then the best attempt is the one with the fewest issues (deterministic plus critic), and a tie goes to the later attempt. A critic issue naming an id that wasn't in the reviewed draft is reported with `recommendationId: null`.

### Caps and failures

**AC-RECOMMEND-12.** Given model output over a wire cap, then the over-cap piece is discarded, never truncated: a recommendation whose destination or summary is over its cap, a claim over its cap, recommendations past `MAX_RECOMMENDATIONS`, claims past `MAX_CLAIMS`, and critic issues that are blank, over `MAX_CRITIQUE_ISSUE_LENGTH` or past the per-call limit. `unresolved` past `MAX_UNRESOLVED_ISSUES` is cut to the cap. Each discard is logged by path, reason, cap and size, never by value, and the response is wire-valid. An issue about a discarded recommendation gets `recommendationId: null`. If no recommendation survives, the response is a 502 `LLM_UPSTREAM_ERROR`.

**AC-RECOMMEND-13.** Given any request, then every client-supplied string (the profile) and every model-written string fed back (previous drafts, issues) reaches a model only inside escaped `<data>` blocks. The system prompts are constants, and the trip-month line is computed in code.

**AC-RECOMMEND-14.** Given a refusal on the recommend or the critic call, then the response is a 502 `LLM_REFUSAL`. Given invalid output twice, or a failed `accept` check twice (an empty recommendation list, or a critic whose `pass` disagrees with its issues), then it is a 502 `LLM_UPSTREAM_ERROR`. Invalid once and then valid gives a 200.

**AC-RECOMMEND-15.** Given the recommend and critic calls, then they use the `reasoning` and `critic` roles at `effort: medium`, with a `maxOutputTokens` derived from the caps plus a margin for thinking.

### Recorded and over HTTP

**AC-RECOMMEND-16.** Given recorded cassettes, then the stage's real adapter replays three paths: a pass on the first try; a pass after one revision (starting from a fixed draft with a deterministic flaw); and still failing after two revisions (a non-stop-only trip to a region the data has no non-stop to).

**AC-RECOMMEND-17.** Given a profile whose strings carry planted instructions (to label claims as verified, add a link, or repeat a canary word), when it is replayed, then the response is wire-valid and within every cap, and every `fixture` label is backed by `routes.json`. This proves containment, not that the model resists; the eval measures that.

**AC-RECOMMEND-18.** Given the built server in replay mode, then `/recommend` answers 200 with a valid `RecommendResponse` for a `ready` profile, 422 for a profile that isn't `ready`, `OPTIONS` with CORS headers, and 502 `LLM_UPSTREAM_ERROR` when the provider fails.
