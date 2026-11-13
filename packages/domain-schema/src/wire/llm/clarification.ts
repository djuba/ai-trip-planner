// What the clarification model fills in (CLAUDE.md §7 stage 1, the second fast call). It never
// crosses HTTP: the question goes out as `ExtractResponse.clarificationQuestion`, which carries the
// cap (ADR 0004). Unconstrained here, per ADR 0001 Q3: the backend checks emptiness and length.
import { z } from 'zod';

export const ClarificationOutput = z.object({
  question: z.string(),
});
export type ClarificationOutput = z.infer<typeof ClarificationOutput>;
