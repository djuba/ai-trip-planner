import { createRecommendPost } from '../../../../http/recommend.ts';
import { getRouteData } from '../../../../http/route-data.ts';
import { preflight } from '../../../../http/route.ts';
import { getLlmRuntime } from '../../../../llm/runtime.ts';

export const dynamic = 'force-dynamic';

export const POST = createRecommendPost({ llm: getLlmRuntime, routes: getRouteData });

export const OPTIONS = preflight;
