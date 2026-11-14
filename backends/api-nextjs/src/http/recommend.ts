// POST /v1/trip/recommend: parse → recommendTrip → serialize (CLAUDE.md §9; WU-10 plan D11). The
// LlmRuntime and route data are injected, so integration tests drive the real handler with a mock
// client and their own data.
import type { Discarded } from '@vp/domain-schema/rules';
import { RecommendRequest, RecommendResponse } from '@vp/domain-schema/wire';
import type { LlmRuntime } from '../llm/index.ts';
import { recommendTrip } from '../usecases/recommend.ts';
import type { RouteData } from '../usecases/routes.ts';
import { jsonResponse, postRoute } from './route.ts';

export interface RecommendRouteDeps {
  llm: () => LlmRuntime;
  routes: () => RouteData;
  logDiscarded?: (discarded: Discarded) => void;
}

/** One console line per discard: a security signal (ADR 0004), never the value itself. */
export function consoleRecommendDiscardLog({ path, reason, limit, actual }: Discarded): void {
  console.warn(
    `[recommend] discarded path=${path} reason=${reason} limit=${limit} actual=${actual}`,
  );
}

export function createRecommendPost({
  llm,
  routes,
  logDiscarded = consoleRecommendDiscardLog,
}: RecommendRouteDeps) {
  return postRoute(RecommendRequest, async (body) => {
    const runtime = llm();
    try {
      const response = await recommendTrip(body, {
        llm: runtime.client,
        routes: routes(),
        logDiscarded,
      });
      return jsonResponse(RecommendResponse, response);
    } finally {
      // As for /extract: in record mode, cassettes are on disk before any response (WU-09 D6).
      await runtime.flush();
    }
  });
}
