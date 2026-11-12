import { CONTRACT_VERSION, HealthResponse } from '@vp/domain-schema/wire';
import { jsonResponse, preflight, route } from '../../../http/route.ts';

export const dynamic = 'force-dynamic';

export const GET = route(() =>
  jsonResponse(HealthResponse, {
    status: 'ok',
    contractVersion: CONTRACT_VERSION,
  }),
);

export const OPTIONS = preflight;
