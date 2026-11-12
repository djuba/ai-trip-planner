// The domain/wire profile (CLAUDE.md §4.3). Range and format checks on the fields the model fills
// are rules, not schema constraints (§4.5), so a `needs_clarification` response can carry the
// offending value and the client can send it back next turn. The only constraints here are the
// resource caps of ADR 0004: string lengths and list sizes, which `normalize` guarantees.
import { z } from 'zod';
import {
  MAX_DATE_TEXT_LENGTH,
  MAX_EXPERIENCES,
  MAX_NOTE_LENGTH,
  MAX_PEOPLE,
  MAX_SHORT_TEXT_LENGTH,
  MAX_UNMAPPED_EXPERIENCES,
} from '../constants.ts';
import { Climate, Experience, TravelMode, UserType } from './enums.ts';

const shortText = () => z.string().max(MAX_SHORT_TEXT_LENGTH);
const dateText = () => z.string().max(MAX_DATE_TEXT_LENGTH);

export const Departure = z.object({
  city: shortText().nullable().optional(),
  mode: TravelMode.nullable().optional(),
  /** Most stops the traveler accepts: `0` = non-stop, `null` = no preference. */
  maxStops: z.int().nullable().optional(),
});
export type Departure = z.infer<typeof Departure>;

export const Traveler = z.object({
  userType: UserType,
  age: z.int().nullable().optional(),
  gender: shortText().nullable().optional(),
});
export type Traveler = z.infer<typeof Traveler>;

/** Dates are `YYYY-MM-DD` strings; their validity is the DATE_VALID rule, not a schema format. */
export const DateRange = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fixed'), start: dateText(), end: dateText() }),
  z.object({
    kind: z.literal('flexible'),
    month: z.int().optional(),
    year: z.int().optional(),
    durationNights: z.int().optional(),
    note: z.string().max(MAX_NOTE_LENGTH).optional(),
  }),
]);
export type DateRange = z.infer<typeof DateRange>;

export const TripProfile = z.object({
  departure: Departure.nullable().optional(),
  dateRange: DateRange.nullable().optional(),
  region: shortText().nullable().optional(),
  climate: Climate.nullable().optional(),
  experiences: z.array(Experience).max(MAX_EXPERIENCES).optional(),
  /** What the user asked for that has no `Experience` value. */
  unmappedExperiences: z.array(shortText()).max(MAX_UNMAPPED_EXPERIENCES).optional(),
  people: z.array(Traveler).max(MAX_PEOPLE).optional(),
});
export type TripProfile = z.infer<typeof TripProfile>;
