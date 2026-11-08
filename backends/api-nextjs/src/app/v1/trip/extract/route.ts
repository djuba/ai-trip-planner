// STUB — replaced in WU-09
import { ExtractRequest, ExtractResponse } from '@vp/domain-schema/wire';
import { jsonResponse, postRoute, preflight } from '../../../../http/route.ts';
import { CANNED_EXTRACT } from '../../../../stubs/canned.ts';

export const dynamic = 'force-dynamic';

export const POST = postRoute(ExtractRequest, () => jsonResponse(ExtractResponse, CANNED_EXTRACT));

export const OPTIONS = preflight;
