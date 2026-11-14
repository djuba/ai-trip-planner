// Turns model drafts into wire recommendations (WU-10 plan D3, D8; approval changes 3 and 4). Code
// assigns ids and verification labels, writes the statement of every fixture claim, and discards
// (never truncates) anything over a wire cap. Pure: no clock, no I/O.
import type { Discarded } from '@vp/domain-schema/rules';
import {
  codePointLength,
  MAX_CLAIM_LENGTH,
  MAX_CLAIMS,
  MAX_CRITIQUE_ISSUE_LENGTH,
  MAX_RECOMMENDATIONS,
  MAX_SHORT_TEXT_LENGTH,
  MAX_SUMMARY_LENGTH,
  MAX_UNRESOLVED_ISSUES,
  type ClaimDraft,
  type CritiqueIssue,
  type FactualClaim,
  type Recommendation,
  type RecommendationDraft,
  type TripProfile,
} from '@vp/domain-schema/wire';
import {
  findNonstop,
  normalizeAirportCode,
  resolveOrigin,
  type RouteData,
  type RouteOrigin,
} from './routes.ts';

/** `rec-<n>`, from the draft's original index, so ids never shift after a discard. */
export function recommendationId(index: number): string {
  return `rec-${index + 1}`;
}

/**
 * `fixture` only for a flight claim whose non-stop route leaves the traveler's own airport and is
 * listed in the route data; its statement is then written here, never taken from the model.
 * Everything else is `unverified` with the model's statement. `nonstopRoute` never goes on the wire.
 */
export function labelClaim(
  claim: ClaimDraft,
  origin: RouteOrigin | null,
  routes: RouteData,
): FactualClaim {
  if (claim.kind === 'flight' && claim.nonstopRoute !== null && origin !== null) {
    const { from, to } = claim.nonstopRoute;
    if (normalizeAirportCode(from) === origin.airport) {
      const destination = findNonstop(routes, origin.airport, to);
      if (destination !== null) {
        return {
          kind: 'flight',
          statement: `Non-stop service ${origin.airport}–${destination.airport} (${destination.city}) is listed in our sample route data; check current schedules.`,
          verification: 'fixture',
        };
      }
    }
  }
  return { kind: claim.kind, statement: claim.statement, verification: 'unverified' };
}

function dedupe<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

export function toWireRecommendations(
  drafts: RecommendationDraft[],
  profile: TripProfile,
  routes: RouteData,
): { recommendations: Recommendation[]; discarded: Discarded[] } {
  const discarded: Discarded[] = [];
  const recommendations: Recommendation[] = [];
  const origin = resolveOrigin(routes, profile.departure?.city);

  if (drafts.length > MAX_RECOMMENDATIONS) {
    discarded.push({
      path: `/recommendations/${MAX_RECOMMENDATIONS}`,
      reason: 'too_many_items',
      limit: MAX_RECOMMENDATIONS,
      actual: drafts.length,
    });
  }

  drafts.forEach((draft, index) => {
    if (index >= MAX_RECOMMENDATIONS) return;
    const base = `/recommendations/${index}`;
    let keep = true;
    const destinationLength = codePointLength(draft.destination);
    if (destinationLength > MAX_SHORT_TEXT_LENGTH) {
      discarded.push({
        path: `${base}/destination`,
        reason: 'too_long',
        limit: MAX_SHORT_TEXT_LENGTH,
        actual: destinationLength,
      });
      keep = false;
    }
    const summaryLength = codePointLength(draft.summary);
    if (summaryLength > MAX_SUMMARY_LENGTH) {
      discarded.push({
        path: `${base}/summary`,
        reason: 'too_long',
        limit: MAX_SUMMARY_LENGTH,
        actual: summaryLength,
      });
      keep = false;
    }
    if (!keep) return;

    const claims: ClaimDraft[] = [];
    draft.claims.forEach((claim, claimIndex) => {
      const length = codePointLength(claim.statement);
      if (length > MAX_CLAIM_LENGTH) {
        discarded.push({
          path: `${base}/claims/${claimIndex}/statement`,
          reason: 'too_long',
          limit: MAX_CLAIM_LENGTH,
          actual: length,
        });
        return;
      }
      claims.push(claim);
    });
    if (claims.length > MAX_CLAIMS) {
      discarded.push({
        path: `${base}/claims`,
        reason: 'too_many_items',
        limit: MAX_CLAIMS,
        actual: claims.length,
      });
    }

    recommendations.push({
      id: recommendationId(index),
      destination: draft.destination,
      summary: draft.summary,
      matchedExperiences: dedupe(draft.matchedExperiences),
      claims: claims.slice(0, MAX_CLAIMS).map((claim) => labelClaim(claim, origin, routes)),
    });
  });

  return { recommendations, discarded };
}

/** The open critic issues for the wire: only fits the caps, and never names a discarded id. */
export function toWireUnresolved(
  issues: CritiqueIssue[],
  keptIds: ReadonlySet<string>,
): { unresolved: CritiqueIssue[]; discarded: Discarded[] } {
  const discarded: Discarded[] = [];
  const unresolved: CritiqueIssue[] = [];
  issues.forEach((entry, index) => {
    const text = entry.issue.trim();
    if (text === '') return;
    const length = codePointLength(text);
    if (length > MAX_CRITIQUE_ISSUE_LENGTH) {
      discarded.push({
        path: `/critique/unresolved/${index}/issue`,
        reason: 'too_long',
        limit: MAX_CRITIQUE_ISSUE_LENGTH,
        actual: length,
      });
      return;
    }
    unresolved.push({
      recommendationId:
        entry.recommendationId !== null && keptIds.has(entry.recommendationId)
          ? entry.recommendationId
          : null,
      issue: text,
    });
  });
  if (unresolved.length > MAX_UNRESOLVED_ISSUES) {
    discarded.push({
      path: '/critique/unresolved',
      reason: 'too_many_items',
      limit: MAX_UNRESOLVED_ISSUES,
      actual: unresolved.length,
    });
  }
  return { unresolved: unresolved.slice(0, MAX_UNRESOLVED_ISSUES), discarded };
}
