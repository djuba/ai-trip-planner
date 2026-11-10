// STUB — replaced in WU-10
import { RecommendRequest, RecommendResponse } from '@vp/domain-schema/wire';
import { jsonResponse, postRoute, preflight } from '../../../../http/route.ts';
import { CANNED_RECOMMEND } from '../../../../stubs/canned.ts';

export const dynamic = 'force-dynamic';

export const POST = postRoute(RecommendRequest, () =>
  jsonResponse(RecommendResponse, CANNED_RECOMMEND),
);

export const OPTIONS = preflight;
