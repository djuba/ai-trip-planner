import { CONTRACT_VERSION, HealthResponse } from '@vp/domain-schema/wire';
import { jsonResponse, openRoute, preflight } from '../../../http/route.ts';

export const dynamic = 'force-dynamic';

// Open: liveness and the startup probe need no invite code (WU-22 plan D2).
export const GET = openRoute(() =>
  jsonResponse(HealthResponse, {
    status: 'ok',
    contractVersion: CONTRACT_VERSION,
  }),
);

export const OPTIONS = preflight;
