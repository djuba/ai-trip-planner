# Input and output limits: acceptance criteria

What the length and count caps on the wire, and `normalize`'s discarding, must do. The decision and the cap values are in [ADR 0004](../decisions/0004-input-and-output-limits.md). "Length" always means Unicode code points.

## Counting

- **AC-LIMITS-01:** Given a string at its cap written in astral characters (two UTF-16 units each), when it is validated, then Zod and the generated JSON Schema both accept it. Given a string over its cap only once combining marks are counted as code points, then both reject it.

## Caps on the wire

- **AC-LIMITS-02:** Given an `ExtractRequest` whose `message` is `MAX_MESSAGE_LENGTH` long, when it is validated, then it is valid; at `MAX_MESSAGE_LENGTH + 1`, it is invalid.
- **AC-LIMITS-03:** Given a profile with one capped string (`region`, `departure.city`, `people[].gender`, `dateRange.note`, fixed `start`/`end`, an `unmappedExperiences` item) or one capped list (`experiences`, `unmappedExperiences`, `people`) at its cap, when it is validated as a `TripProfile` and inside each request schema that carries a profile, then it is valid; at the cap plus one, it is invalid.
- **AC-LIMITS-04:** Given each cap constant, then it is the maximum the wire schema actually sets on every field it applies to.
- **AC-LIMITS-05:** Given `pnpm --filter @vp/domain-schema gen`, then `spec/generated/constants.json` contains every cap under its key with its value.
- **AC-LIMITS-06:** Given the generated `ExtractionSchema`, then it contains no `maxLength` or `maxItems`.

## Discarding in `normalize`

- **AC-LIMITS-07:** Given an extraction whose `region`, `departure.city`, `people[i].gender` or flexible `note` is over its cap, when it is normalized, then that field is dropped and reported (`too_long`, with path, cap and length). A `departure` or flexible range left empty is dropped. A value exactly at its cap, including in astral characters, is kept and nothing is reported.
- **AC-LIMITS-08:** Given a fixed `dateRange` whose `start` or `end` is over its cap, when it is normalized, then the whole `dateRange` is dropped and the over-cap field is reported.
- **AC-LIMITS-09:** Given an over-long `unmappedExperiences` item, when it is normalized, then that item is dropped and reported, and the list is dropped if nothing is left. Given a list over its count cap after item drops, then the whole list is dropped and reported (`too_many_items`).
- **AC-LIMITS-10:** Given an extraction with any capped field at its cap, at its cap plus one, in astral characters, or containing a lone surrogate, or with every field over its cap at once, when it is normalized, then the profile parses against `TripProfile`.

## Output caps

- **AC-LIMITS-12:** Given an `ExtractResponse` with `status: 'needs_clarification'`, when it is validated, then a `clarificationQuestion` of `MAX_CLARIFICATION_QUESTION_LENGTH` code points (ASCII or astral) is valid, and one longer is invalid, in Zod and in the generated JSON Schema. `constants.json` carries the cap. The model-facing `ClarificationOutput` carries no constraints.
- **AC-LIMITS-13:** Given a `RecommendResponse` or `PresentRequest`, when it is validated, then each recommendation and critique cap (`Recommendation.id`, `destination`, `summary`, `matchedExperiences`, `claims`; `FactualClaim.statement`; the `recommendations` list; `CritiqueIssue.issue` and `recommendationId`; `critique.unresolved`) accepts a value at exactly its cap (strings in astral characters) and rejects one over it, in Zod and in the generated JSON Schema. `constants.json` carries the new caps. The model-facing `RecommendationSet` and `CritiqueResult` carry no constraints.

## Over HTTP

- **AC-LIMITS-11:** Given the backend under test, when `/v1/trip/extract` gets a `message`, or any POST endpoint gets a profile `region`, at exactly its cap in astral characters, or a `people` list at its cap, then it answers 200 with a schema-valid body. At the cap plus one it answers 422 `VALIDATION_FAILED`. A fake backend that ignores the caps fails the check, and so does one that counts UTF-16 units.
