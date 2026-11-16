# Presentation UI: acceptance criteria

How `apps/web-nextjs` goes from a `ready` trip profile to recommendation cards that render while `/v1/trip/present` streams. The design is in [the WU-14 plan](../plans/WU-14.md) (D1–D10 and the decisions at approval). The conversation that leads here is in [`conversation-ui.md`](conversation-ui.md). The stream itself is specified in [`presentation.md`](presentation.md): raw JSON text with every field possibly missing or cut short until it ends, sent in the key order `headline`, `intro`, `cards`, and in each card `recommendationId`, `claims`, `title`, `blurb`, `highlights`.

## Flow

1. When the profile is `ready`, the user chooses **Get recommendations**. Nothing is requested before that, because every call spends invite quota.
2. `POST /v1/trip/recommend` gets `{ profile, referenceDate }`. On success, `POST /v1/trip/present` gets `{ profile, recommendations }`, with the recommendations unchanged and in order.
3. `useObject` (`@ai-sdk/react`) reads the stream through the typed API client and shows each partial object as it arrives. When the stream ends, it checks the result against `PresentationModel`.
4. A card shows its claims and their verification badges only once its blurb is complete.
5. Any failure shows the recoverable error state. Retry repeats only the step that failed.

## Acceptance criteria

- **AC-CARDS-01:** Given a `ready` profile, then a "Get recommendations" button is shown, and nothing is posted until it is pressed. Pressing it posts `/v1/trip/recommend` with the current profile and the browser's local date. Given any other status, or results already shown, there is no button.
- **AC-CARDS-02:** Given a successful `/recommend`, then `/v1/trip/present` gets `{ profile, recommendations }`: the same profile, and the response's recommendations unchanged and in order.
- **AC-CARDS-03:** Given a stream in progress, then the headline, the intro and the cards render as they arrive. A missing key renders nothing, and a string cut short renders as received (`Calm tur`). No partial stage of the stream makes rendering throw.
- **AC-CARDS-04:** Given a card, then its claims and badges appear only once its blurb is complete: its `highlights` key has arrived, a later card exists, or the stream has finished. Each claim shows its statement as text, followed by its badge, worded from the message catalog: "Unverified" or "From sample route data". When any claim is shown, a note explains what the two labels mean.
- **AC-CARDS-05:** Given a stream that ends with a value that passes `PresentationModel`, then the validated model is shown, and the status says "Your recommendations are ready." Given one that doesn't pass, then the error state is shown with Retry, and no cards.
- **AC-CARDS-06:** Given a stream that breaks partway (a transport error, never a clean end; AC-PRESENT-08), then the alert says "The suggestions stopped partway." and offers Retry, and the partial cards are removed. Retry posts `/present` again with the same body, and doesn't call `/recommend` again.
- **AC-CARDS-07:** Given an error from `/recommend`, or from `/present` before its stream starts, then the alert uses the same texts as the conversation (AC-CONV-09, AC-CONV-12), and Retry repeats only that step. Given a 401, the invite-code entry appears, and submitting a code repeats that step with it. Given a spent quota, there is no Retry.
- **AC-CARDS-08:** Given recommendations whose `critique.unresolved` is non-empty, then a note says the planner's own checks still had concerns. The issue text is not shown. Given none, there is no note.
- **AC-CARDS-09:** Given zero recommendations, then the streamed headline and intro show with "No trips matched this profile. Try changing a detail.", and no card list.
- **AC-CARDS-10:** Given a trip step in flight, then a status region says "Finding trips…" or "Writing up your trips…". That region is always in the DOM; only its text changes. The card list is `aria-busy` while it streams, and Send is disabled. Start over aborts the request or stream and clears the results.
- **AC-CARDS-11:** Given results, when a new extract response arrives, then the results are cleared, because they were for the old profile. A `ready` response offers the button again. The results stay while the correction is in flight.
- **AC-CARDS-12:** Given model text with markup in a title, blurb, highlight or claim, then it renders literally, never as HTML.
- **AC-CARDS-13:** Given each state (finding trips, a stream paused mid-card, the presented cards with both badge kinds and the critic note, a stream error, zero results), then the page has no axe violations.
