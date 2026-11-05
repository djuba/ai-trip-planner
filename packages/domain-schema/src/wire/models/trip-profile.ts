// The domain/wire profile (CLAUDE.md §4.3). Every field the model can fill is unconstrained here:
// range and format checks are rules (§4.5), so a `needs_clarification` response can carry the
// offending value and the client can send it back next turn.
import { z } from 'zod';
import { Climate, Experience, TravelMode, UserType } from './enums.ts';

export const Departure = z.object({
  city: z.string().nullable().optional(),
  mode: TravelMode.nullable().optional(),
  /** Most stops the traveler accepts: `0` = non-stop, `null` = no preference. */
  maxStops: z.int().nullable().optional(),
});
export type Departure = z.infer<typeof Departure>;

export const Traveler = z.object({
  userType: UserType,
  age: z.int().nullable().optional(),
  gender: z.string().nullable().optional(),
});
export type Traveler = z.infer<typeof Traveler>;

/** Dates are `YYYY-MM-DD` strings; their validity is the DATE_VALID rule, not a schema format. */
export const DateRange = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fixed'), start: z.string(), end: z.string() }),
  z.object({
    kind: z.literal('flexible'),
    month: z.int().optional(),
    year: z.int().optional(),
    durationNights: z.int().optional(),
    note: z.string().optional(),
  }),
]);
export type DateRange = z.infer<typeof DateRange>;

export const TripProfile = z.object({
  departure: Departure.nullable().optional(),
  dateRange: DateRange.nullable().optional(),
  region: z.string().nullable().optional(),
  climate: Climate.nullable().optional(),
  experiences: z.array(Experience).optional(),
  /** What the user asked for that has no `Experience` value. */
  unmappedExperiences: z.array(z.string()).optional(),
  people: z.array(Traveler).optional(),
});
export type TripProfile = z.infer<typeof TripProfile>;
