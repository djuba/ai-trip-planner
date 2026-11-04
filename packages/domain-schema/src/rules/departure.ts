// MAX_STOPS_RANGE (rules.md).
import type { RuleViolation, TripProfile } from '../wire/index.ts';

export function maxStopsRange(profile: TripProfile): RuleViolation[] {
  const maxStops = profile.departure?.maxStops;
  if (maxStops === null || maxStops === undefined || maxStops >= 0) return [];
  return [{ code: 'MAX_STOPS_RANGE', path: '/departure/maxStops', params: { value: maxStops } }];
}
