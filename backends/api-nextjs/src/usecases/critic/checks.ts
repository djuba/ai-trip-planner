// The critic's deterministic checks (CLAUDE.md §7 stage 2b; WU-10 plan D5). They run on the raw
// drafts, before any discard, and at most one issue per (recommendation, check) comes out.
// Issue text is fixed wording plus recommendation ids and route-data values only; it never contains
// a model string, because it is fed back into the revise prompt (approval change 5).
import {
  codePointLength,
  MAX_CLAIM_LENGTH,
  MAX_CLAIMS,
  MAX_RECOMMENDATIONS,
  MAX_SHORT_TEXT_LENGTH,
  MAX_SUMMARY_LENGTH,
  type CritiqueIssue,
  type RecommendationDraft,
  type TripProfile,
} from '@vp/domain-schema/wire';
import { labelClaim, recommendationId } from '../recommend-output.ts';
import {
  findNonstop,
  normalizeAirportCode,
  resolveOrigin,
  servesDestination,
  type RouteData,
} from '../routes.ts';
import { tripStart } from '../trip-month.ts';

export type CheckCode =
  | 'OVER_CAP'
  | 'EXPERIENCE_NOT_REQUESTED'
  | 'SEASON_MISMATCH'
  | 'BAD_MONTH'
  | 'PARTY_ADULTS_ONLY'
  | 'ROUTE_WRONG_ORIGIN'
  | 'ROUTE_NOT_IN_DATA'
  | 'ROUTE_OFF_DESTINATION'
  | 'NONSTOP_REQUIRED';

export interface CheckIssue extends CritiqueIssue {
  check: CheckCode;
}

export function runDeterministicChecks(
  drafts: RecommendationDraft[],
  profile: TripProfile,
  referenceDate: string,
  routes: RouteData,
): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const origin = resolveOrigin(routes, profile.departure?.city);
  const requested = new Set(profile.experiences ?? []);
  const start = tripStart(profile, referenceDate);
  const hasChild = (profile.people ?? []).some((person) => person.userType === 'child');
  const mode = profile.departure?.mode;
  const nonstopOnly =
    profile.departure?.maxStops === 0 && (mode === 'plane' || mode === null || mode === undefined);

  if (drafts.length > MAX_RECOMMENDATIONS) {
    issues.push({
      check: 'OVER_CAP',
      recommendationId: null,
      issue: `Give at most ${MAX_RECOMMENDATIONS} recommendations.`,
    });
  }

  drafts.forEach((draft, index) => {
    const id = recommendationId(index);
    const add = (check: CheckCode, issue: string): void => {
      issues.push({ check, recommendationId: id, issue });
    };
    const flights = draft.claims.flatMap((claim) =>
      claim.kind === 'flight' && claim.nonstopRoute !== null ? [claim.nonstopRoute] : [],
    );

    if (
      codePointLength(draft.destination) > MAX_SHORT_TEXT_LENGTH ||
      codePointLength(draft.summary) > MAX_SUMMARY_LENGTH ||
      draft.claims.some((claim) => codePointLength(claim.statement) > MAX_CLAIM_LENGTH) ||
      draft.claims.length > MAX_CLAIMS
    ) {
      add(
        'OVER_CAP',
        `${id}: the destination is over ${MAX_SHORT_TEXT_LENGTH} characters, the summary over ${MAX_SUMMARY_LENGTH}, a claim over ${MAX_CLAIM_LENGTH}, or there are more than ${MAX_CLAIMS} claims. Shorten them.`,
      );
    }

    if (draft.matchedExperiences.some((experience) => !requested.has(experience))) {
      add(
        'EXPERIENCE_NOT_REQUESTED',
        `${id}: matchedExperiences lists an experience the traveler did not ask for. List only requested experiences.`,
      );
    }

    if (start !== null && !draft.bestMonths.includes(start.month)) {
      add(
        'SEASON_MISMATCH',
        `${id}: the trip starts in month ${start.month}, which is not in bestMonths. Choose a destination that suits that month, or list it in bestMonths only if it does.`,
      );
    }

    if (draft.bestMonths.some((month) => !Number.isInteger(month) || month < 1 || month > 12)) {
      add('BAD_MONTH', `${id}: bestMonths must contain only whole months from 1 to 12.`);
    }

    if (hasChild && draft.adultsOnly) {
      add(
        'PARTY_ADULTS_ONLY',
        `${id}: the party includes a child, but this destination is marked adults only. Choose a family-suitable destination.`,
      );
    }

    if (origin !== null) {
      const onOrigin = flights.filter(
        (route) => normalizeAirportCode(route.from) === origin.airport,
      );
      if (onOrigin.length < flights.length) {
        add(
          'ROUTE_WRONG_ORIGIN',
          `${id}: a claim gives a non-stop route that does not leave from the traveler's airport (${origin.airport}).`,
        );
      }
      if (onOrigin.some((route) => findNonstop(routes, origin.airport, route.to) === null)) {
        add(
          'ROUTE_NOT_IN_DATA',
          `${id}: a claim gives a non-stop from ${origin.airport} that our route data does not list. Use only listed non-stops, or say none is listed.`,
        );
      }
      // A listed non-stop that lands somewhere else is true, but would read as support for this
      // recommendation (WU-10 unit review #1), so it is flagged and doesn't satisfy NONSTOP_REQUIRED.
      const listed = onOrigin.flatMap((route) => {
        const found = findNonstop(routes, origin.airport, route.to);
        return found === null ? [] : [found];
      });
      const offDestination = listed.find((route) => !servesDestination(route, draft.destination));
      if (offDestination !== undefined) {
        add(
          'ROUTE_OFF_DESTINATION',
          `${id}: a claim gives the listed non-stop ${origin.airport}–${offDestination.airport} (${offDestination.city}), which does not serve this recommendation's destination. Give only non-stops to the destination itself.`,
        );
      }
      const servesThis = draft.claims.some((claim) => {
        if (labelClaim(claim, origin, routes).verification !== 'fixture') return false;
        const to = claim.nonstopRoute?.to ?? '';
        const route = findNonstop(routes, origin.airport, to);
        return route !== null && servesDestination(route, draft.destination);
      });
      if (nonstopOnly && !servesThis) {
        add(
          'NONSTOP_REQUIRED',
          `${id}: the traveler wants non-stop flights only, and no claim gives a non-stop from ${origin.airport} that our route data lists. Choose a destination from the route data, or say plainly that no non-stop is listed.`,
        );
      }
    }
  });

  return issues;
}
