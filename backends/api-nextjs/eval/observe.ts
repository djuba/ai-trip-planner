// Sees every model attempt without changing what the pipeline does (WU-18 plan D2). The adapter runs
// `accept` on each schema-valid attempt (WU-09 plan-review change 6), so a recording `accept` that
// then applies the original check sees both attempts of a retried call, and the retry-once-then-502
// path stays exactly as it is. With no original check, it always passes, so it adds none.
import { z } from 'zod';
import type { LlmClient, LlmObjectRequest } from '../src/usecases/llm-client.ts';
import type { Attempt } from './types.ts';

export function observeLlm(inner: LlmClient, record: (attempt: Attempt) => void): LlmClient {
  return {
    generateObject<T>(request: LlmObjectRequest<T>): Promise<T> {
      const original = request.accept;
      const accept = z.custom((output: unknown) => {
        const accepted = original === undefined || original.safeParse(output).success;
        record({ stage: request.stage, output, accepted });
        return accepted;
      });
      return inner.generateObject({ ...request, accept });
    },
  };
}
