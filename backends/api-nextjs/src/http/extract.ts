// POST /v1/trip/extract: parse → extractTrip → serialize (CLAUDE.md §9). The LlmRuntime is injected,
// so integration tests drive the real handler with a mock client (WU-09 plan D6).
import type { Discarded } from '@vp/domain-schema/rules';
import { ExtractRequest, ExtractResponse } from '@vp/domain-schema/wire';
import type { LlmRuntime } from '../llm/index.ts';
import { extractTrip } from '../usecases/extract.ts';
import { jsonResponse, postRoute } from './route.ts';

export interface ExtractRouteDeps {
  llm: () => LlmRuntime;
  logDiscarded?: (discarded: Discarded) => void;
}

/** One console line per discard: a security signal (ADR 0004), never the value itself. */
export function consoleDiscardLog({ path, reason, limit, actual }: Discarded): void {
  console.warn(`[extract] discarded path=${path} reason=${reason} limit=${limit} actual=${actual}`);
}

export function createExtractPost({ llm, logDiscarded = consoleDiscardLog }: ExtractRouteDeps) {
  return postRoute(ExtractRequest, async (body) => {
    const runtime = llm();
    try {
      const response = await extractTrip(body, { llm: runtime.client, logDiscarded });
      return jsonResponse(ExtractResponse, response);
    } finally {
      // A no-op outside record mode. In record mode, cassettes are on disk before any response,
      // error or not, so a test harness can stop the server as soon as it has its answer (D6).
      await runtime.flush();
    }
  });
}
