// What the recommendation model fills in (CLAUDE.md §7 stage 2). It never crosses HTTP:
// `RecommendResponse` carries the recommendations with the critic's result instead. Uses only
// ADR 0001 Q3 constructs, as does `Recommendation`.
import { z } from 'zod';
import { Recommendation } from '../models/recommendation.ts';

export const RecommendationSet = z.object({
  recommendations: z.array(Recommendation),
});
export type RecommendationSet = z.infer<typeof RecommendationSet>;
