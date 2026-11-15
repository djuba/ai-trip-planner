# Presentation: acceptance criteria

Stage 3 of the pipeline (CLAUDE.md §7): `POST /v1/trip/present` turns a profile and its recommendations into presentation copy, streamed as raw JSON that, once complete, parses as `PresentationModel`. The design is in [the WU-11 plan](../plans/WU-11.md). The caps come from [ADR 0004](../decisions/0004-input-and-output-limits.md) and its WU-11 addendum.

## Flow

1. The request (`PresentRequest`: `profile`, `recommendations`) is shape-checked; a shape error is a 422 and no model is called.
2. With no recommendations, no model is called: code streams a fixed headline and intro and `cards: []`.
3. Otherwise one streamed call (`MODEL_FAST`, `effort: low`) fills in `PresentationCopy`: a headline, an intro, and one card per recommendation (title, blurb, highlights). It never sees the claims and never writes an id or a label.
4. Code writes the stream: for each partial copy it sends only what extends the text already sent, in a fixed key order (`headline`, `intro`, `cards`; in each card `recommendationId`, `claims`, `title`, `blurb`, `highlights`).
5. Cards line up with the request's recommendations by position. Extra model cards are dropped; a missing card is written by code from the recommendation (title = destination, blurb = summary, no highlights).
6. Each card's `recommendationId` and `claims` come from its recommendation, unchanged, except that a `fixture` label code can't back is sent as `unverified`.

### What a client sees

- The response is `200 text/plain; charset=utf-8`, sent in several chunks. Partial text is not valid JSON; every field may be missing, and the last string may be cut short, until the stream ends. Then the whole body parses as `PresentationModel`.
- In an open string, code sends text only up to the last space, so a word appears whole (a run longer than 32 characters with no space goes out anyway).
- A string the model makes longer than its cap ends at a word boundary with "…", within the cap. The prompt asks for about half of each cap, so this only happens when the model ignores it.
- A failure before any copy is a normal JSON 502. A failure after the stream has started can't change the status any more, so the connection ends with a transport error instead of a clean end, and the body never closes its JSON.

## Acceptance criteria

- **AC-PRESENT-01:** Given a valid request with recommendations, when it is posted, then the answer is `200 text/plain`, raw JSON with no SDK framing, that parses as `PresentationModel`, with one card per recommendation in the request's order.
- **AC-PRESENT-02:** Given a streamed presentation, when it is read, then it arrives as more than one chunk, and the text sent so far is always a prefix of the final text.
- **AC-PRESENT-03:** Given recommendations with claims, when they are presented, then each card's `recommendationId` and `claims` are the recommendation's own, set by code. Copy the model writes can't add, change or relabel a claim.
- **AC-PRESENT-04:** Given a `fixture` claim, when it is presented, then it keeps its label only if it is a `flight` claim, the traveler's departure city resolves to a covered airport, and its statement is exactly the one code writes for a non-stop from that airport in the route data. Otherwise it is sent as `unverified`, with its statement unchanged.
- **AC-PRESENT-05:** Given model copy with fewer cards than recommendations, then code writes each missing card from its recommendation (title = destination, blurb = summary, no highlights). Given more, the extra cards are dropped. A code-written card always fits the caps (`MAX_SHORT_TEXT_LENGTH` ≤ `MAX_CARD_TITLE_LENGTH`, `MAX_SUMMARY_LENGTH` ≤ `MAX_BLURB_LENGTH`).
- **AC-PRESENT-06:** Given model copy with a string over its cap, then the string sent ends at a word boundary with "…", is within the cap in code points, and the cut is logged (path, reason `truncated`, received length, never the value). Highlights past `MAX_HIGHLIGHTS` are dropped. The final text always passes `PresentationModel`.
- **AC-PRESENT-07:** Given a model failure before any copy is written, then the answer is a JSON 502: `LLM_UPSTREAM_ERROR` after one retry, or `LLM_REFUSAL` with no retry.
- **AC-PRESENT-08:** Given a model failure after the stream has started, then there is no retry, the response stream is errored (the client's read fails; there is no clean end), and nothing becomes an unhandled rejection.
- **AC-PRESENT-09:** Given any request, when the prompt is built, then the system prompt is the same constant for every request, the profile and recommendations reach the model only inside data blocks, and no claim reaches the model.
- **AC-PRESENT-10:** Given recommendations with instructions and a canary planted in their strings, when they are presented (replay), then every claim and label comes out unchanged, and the system prompt does not leak.
- **AC-PRESENT-11:** Given a recorded stream that has an `error` event or lacks `message_stop`, when the recorder finishes, then no cassette is written, and a warning says why.
- **AC-PRESENT-12:** Given a request that fails the contract, then the answer is a 422 with no model call. A CORS preflight is answered, and the access gate applies as on every trip endpoint.
- **AC-PRESENT-13:** Given `recommendations: []`, then no model is called, and the stream holds a code-written headline and intro and `cards: []`, a valid `PresentationModel`.
