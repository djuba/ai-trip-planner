// POST /v1/trip/present: parse → presentTrip → stream (CLAUDE.md §5, §9; WU-11 plan D3, D5, D9).
// The response is raw JSON text with no SDK framing. A failure before the first chunk is a normal
// JSON error response; after it, the response stream is errored, so the client sees a transport
// error rather than a clean end of a cut-off body.
import { PresentRequest } from '@vp/domain-schema/wire';
import { createTextStreamResponse } from 'ai';
import type { LlmRuntime } from '../llm/index.ts';
import { LlmError } from '../usecases/errors.ts';
import type { PresentDiscard } from '../usecases/present/stream-writer.ts';
import { presentTrip } from '../usecases/present.ts';
import type { RouteData } from '../usecases/routes.ts';
import { postRoute, type RouteOptions } from './route.ts';

export interface PresentRouteDeps extends RouteOptions {
  llm: () => LlmRuntime;
  routes: () => RouteData;
  logDiscarded?: (discarded: PresentDiscard) => void;
}

/** One console line per cut or drop: a security signal (ADR 0004), never the value itself. */
export function consolePresentDiscardLog({ path, reason, limit, actual }: PresentDiscard): void {
  console.warn(`[present] discarded path=${path} reason=${reason} limit=${limit} actual=${actual}`);
}

/**
 * One line naming the failure, never the raw error: an SDK error can carry the request or the
 * model's partial output, and none of it belongs in the logs.
 */
export function summarizeStreamFailure(error: unknown): string {
  const name = (value: unknown) => (value instanceof Error ? value.name : typeof value);
  if (error instanceof LlmError) return `code=${error.code} cause=${name(error.cause)}`;
  return `error=${name(error)}`;
}

export function createPresentPost({
  llm,
  routes,
  logDiscarded = consolePresentDiscardLog,
  ...options
}: PresentRouteDeps) {
  return postRoute(
    PresentRequest,
    async (body) => {
      const runtime = llm();
      let chunks: AsyncIterable<string>;
      try {
        chunks = await presentTrip(body, { llm: runtime.client, routes: routes(), logDiscarded });
      } catch (error) {
        await runtime.flush();
        throw error;
      }
      const iterator = chunks[Symbol.asyncIterator]();
      // In record mode the cassette is complete only once the model stream has ended, so flush
      // when this stream ends, fails or is cancelled, not before the response is returned (plan
      // D9). Whichever comes first flushes; the others reuse it.
      let flushed: Promise<void> | undefined;
      const flush = () => (flushed ??= runtime.flush());
      // A client that goes away cancels the stream; a pull still waiting then settles with the
      // abort, which is not a failure and must not be logged or reported as one.
      let cancelled = false;
      const stream = new ReadableStream<string>({
        async pull(controller) {
          try {
            const next = await iterator.next();
            if (cancelled) return;
            if (next.done === true) {
              await flush();
              controller.close();
            } else {
              controller.enqueue(next.value);
            }
          } catch (error) {
            if (cancelled) return;
            console.error(
              `[present] the stream failed after it started: ${summarizeStreamFailure(error)}`,
            );
            await flush().catch(() => undefined);
            controller.error(error);
          }
        },
        async cancel() {
          cancelled = true;
          // The client went away: stop the model call.
          await iterator.return?.();
          await flush().catch(() => undefined);
        },
      });
      return createTextStreamResponse({ stream });
    },
    options,
  );
}
