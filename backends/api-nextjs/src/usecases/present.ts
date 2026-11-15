// Stage 3, Present (CLAUDE.md §7; WU-11 plan D1–D7, D12). Profile and recommendations → one
// streamed copy call (MODEL_FAST, effort low) → code writes the wire JSON stream, with the ids and
// claims mapped from the request. The model never writes an id, a claim or a label.
import { PresentationCopy, PresentationModel, type PresentRequest } from '@vp/domain-schema/wire';
import type { LlmClient } from './llm-client.ts';
import { cardData, fallbackCopy } from './present/mapping.ts';
import {
  createStreamWriter,
  StreamWriterError,
  type CardInput,
  type PresentDiscard,
} from './present/stream-writer.ts';
import { buildPresentPrompt, EMPTY_PRESENTATION } from './prompts/present.ts';
import type { RouteData } from './routes.ts';
import { PRESENT_MAX_OUTPUT_TOKENS } from './token-budget.ts';

export interface PresentDeps {
  llm: LlmClient;
  routes: RouteData;
  /** A security signal (ADR 0004): path, reason, cap and size only, never the value. */
  logDiscarded: (discarded: PresentDiscard) => void;
}

/** The wire text in one chunk, for a presentation code writes alone. */
function whole(model: PresentationModel): AsyncIterable<string> {
  const text = JSON.stringify(PresentationModel.parse(model));
  return {
    [Symbol.asyncIterator]: () => {
      let done = false;
      return {
        next: () => {
          const result = done
            ? { done: true as const, value: undefined }
            : { done: false as const, value: text };
          done = true;
          return Promise.resolve(result);
        },
      };
    },
  };
}

/**
 * Resolves once the model's first partial is in, so a failure before it rejects with `LlmError`
 * (a JSON 502), and nothing has been sent. The chunks then extend each other and end as one valid
 * `PresentationModel`. A failure after the first partial is thrown by the iterator (an `LlmError`
 * with `midStream`), so the caller can error the response instead of ending it cleanly.
 */
export async function presentTrip(
  request: PresentRequest,
  { llm, routes, logDiscarded }: PresentDeps,
): Promise<AsyncIterable<string>> {
  const { profile, recommendations } = request;
  // Nothing to present: no model call (plan D12).
  if (recommendations.length === 0) return whole(EMPTY_PRESENTATION);

  const data = cardData(recommendations, profile, routes);
  const cards: CardInput[] = recommendations.map((recommendation, i) => ({
    recommendationId: data[i]?.recommendationId ?? recommendation.id,
    claims: data[i]?.claims ?? [],
    fallback: fallbackCopy(recommendation),
  }));
  const { system, prompt } = buildPresentPrompt({ profile, recommendations });
  const parts = await llm.streamObject({
    stage: 'present',
    role: 'fast',
    schema: PresentationCopy,
    system,
    prompt,
    maxOutputTokens: PRESENT_MAX_OUTPUT_TOKENS,
    effort: 'low',
  });

  return (async function* (): AsyncGenerator<string, void, undefined> {
    const writer = createStreamWriter(cards);
    let finished = false;
    try {
      for await (const part of parts) {
        if (part.type === 'partial') {
          const delta = writer.push(part.partial);
          if (delta !== '') yield delta;
          continue;
        }
        const delta = writer.finish(part.object);
        // The server's own last check (plan D3): a body that breaks the contract must not end
        // cleanly. It can't be taken back, so the stream is errored instead.
        const parsed = PresentationModel.safeParse(JSON.parse(writer.sent));
        if (!parsed.success) {
          throw new StreamWriterError(
            `The presentation breaks the contract: ${parsed.error.message}`,
          );
        }
        finished = true;
        yield delta;
      }
      // A stream that ends without its final object would leave cut-off JSON: never end cleanly.
      if (!finished) throw new StreamWriterError('The model stream ended without a final object');
    } finally {
      for (const discarded of writer.discarded) logDiscarded(discarded);
    }
  })();
}
