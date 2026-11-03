// NON-PRODUCTION SPIKE (WU-03). See ../README.md.
//
// Probe schemas. `ExtractionProbe` mirrors CLAUDE.md §4.3 + §4.4 (every field required but
// nullable). It is NOT the contract; WU-04 writes the real one in packages/domain-schema.
import { z } from 'zod';

export const EXPERIENCES = [
  'beach',
  'pool',
  'golf',
  'go-karts',
  'hiking',
  'snorkeling',
  'theme-parks',
  'museums',
  'nightlife',
  'skiing',
] as const;

export const ExtractionProbe = z.object({
  departureCity: z.string().nullable(),
  dateRange: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('fixed'), start: z.iso.date(), end: z.iso.date() }),
      z.object({
        kind: z.literal('flexible'),
        month: z.int().min(1).max(12).nullable(),
        year: z.int().nullable(),
        durationNights: z.int().nullable(),
        note: z.string().nullable(),
      }),
    ])
    .nullable(),
  region: z.string().nullable(),
  climate: z.enum(['tropical', 'warm', 'temperate', 'cool', 'cold']).nullable(),
  experiences: z.array(z.enum(EXPERIENCES)).nullable(),
  unmappedExperiences: z.array(z.string()).nullable(),
  people: z
    .array(
      z.object({
        userType: z.enum(['adult', 'child']),
        age: z.int().nullable(),
        gender: z.string().nullable(),
      }),
    )
    .nullable(),
});

/** Same shape without numeric constraints: what we'd use if constraints cause failures. */
export const ExtractionProbeUnconstrained = ExtractionProbe.extend({
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
});

/** One schema per construct, to see how each is sent (sanitized) and whether the API accepts it. */
export const CONSTRUCTS = {
  optionalField: z.object({ a: z.string(), b: z.string().optional() }),
  nullableField: z.object({ a: z.string().nullable() }),
  intMinMax: z.object({ n: z.int().min(1).max(12) }),
  stringPattern: z.object({ s: z.string().regex(/^[A-Z]{3}$/) }),
  stringFormatDate: z.object({ d: z.iso.date() }),
  arrayMinMaxItems: z.object({ xs: z.array(z.string()).min(1).max(3) }),
  discriminatedUnion: z.object({
    u: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('a'), x: z.string() }),
      z.object({ kind: z.literal('b'), y: z.number() }),
    ]),
  }),
  plainUnion: z.object({ u: z.union([z.string(), z.number()]) }),
  record: z.object({ r: z.record(z.string(), z.string()) }),
  tuple: z.object({ t: z.tuple([z.string(), z.number()]) }),
  literal: z.object({ k: z.literal('fixed') }),
  defaultValue: z.object({ a: z.string().default('x') }),
} as const;

export type ConstructName = keyof typeof CONSTRUCTS;
