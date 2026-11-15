// What /present maps in code rather than asking the model (WU-11 plan D6, AC-PRESENT-03/04/05):
// card ids and claims, the re-check of `fixture` labels against the request, and the fallback copy
// used when the model's card is missing or unusable. Pure: no I/O.
import type { FactualClaim, Recommendation, TripProfile } from '@vp/domain-schema/wire';
import { fixtureStatement } from '../recommend-output.ts';
import { resolveOrigin, type RouteData, type RouteOrigin } from '../routes.ts';

/**
 * The request is client-supplied, so a `fixture` label is trusted only when it still checks out:
 * a flight claim whose statement is exactly what code writes for a non-stop listed from the
 * traveler's resolved origin. Anything else becomes `unverified` (statement unchanged).
 */
export function recheckClaim(
  claim: FactualClaim,
  origin: RouteOrigin | null,
  routes: RouteData,
): FactualClaim {
  if (claim.verification !== 'fixture') return claim;
  if (
    claim.kind === 'flight' &&
    origin !== null &&
    (routes.origins.find((o) => o.airport === origin.airport)?.nonstop ?? []).some(
      (d) => claim.statement === fixtureStatement(origin.airport, d),
    )
  ) {
    return claim;
  }
  return { ...claim, verification: 'unverified' };
}

export interface CardData {
  recommendationId: string;
  claims: FactualClaim[];
}

export function cardData(
  recommendations: Recommendation[],
  profile: TripProfile,
  routes: RouteData,
): CardData[] {
  const origin = resolveOrigin(routes, profile.departure?.city);
  return recommendations.map((recommendation) => ({
    recommendationId: recommendation.id,
    claims: recommendation.claims.map((claim) => recheckClaim(claim, origin, routes)),
  }));
}

/** Copy written by code when the model's is missing: the caps guarantee it fits a card. */
export function fallbackCopy(recommendation: Recommendation): {
  title: string;
  blurb: string;
  highlights: string[];
} {
  return { title: recommendation.destination, blurb: recommendation.summary, highlights: [] };
}
