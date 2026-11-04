// What the extraction model fills in (CLAUDE.md §4.4). Every field is required and nullable
// (`null` = not mentioned), and only ADR 0001 Q3 "use" constructs appear: no optional, default,
// tuple, record, numeric/length/pattern constraints or string formats. `normalize()` (WU-05)
// turns it into a `TripProfile`.
import { z } from 'zod';
import { Climate, Experience, TravelMode, UserType } from './enums.ts';

export const ExtractionSchema = z.object({
  departure: z
    .object({
      city: z.string().nullable(),
      mode: TravelMode.nullable(),
      maxStops: z.int().nullable(),
    })
    .nullable(),
  dateRange: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('fixed'), start: z.string(), end: z.string() }),
      z.object({
        kind: z.literal('flexible'),
        month: z.int().nullable(),
        year: z.int().nullable(),
        durationNights: z.int().nullable(),
        note: z.string().nullable(),
      }),
    ])
    .nullable(),
  region: z.string().nullable(),
  climate: Climate.nullable(),
  experiences: z.array(Experience).nullable(),
  unmappedExperiences: z.array(z.string()).nullable(),
  people: z
    .array(
      z.object({
        userType: UserType,
        age: z.int().nullable(),
        gender: z.string().nullable(),
      }),
    )
    .nullable(),
});
export type ExtractionSchema = z.infer<typeof ExtractionSchema>;
