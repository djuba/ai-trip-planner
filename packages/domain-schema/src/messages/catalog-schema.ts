// The shape of a message catalog, `spec/messages/<locale>.json` (spec/messages.md). The wording
// itself is hand-written in spec/; this schema only gives its shape to TS and, through `gen`, to
// every other reader as `spec/generated/MessageCatalog.schema.json`.
import { z } from 'zod';
import {
  Climate,
  Experience,
  RuleCode,
  TravelMode,
  UserType,
  Verification,
} from '../wire/models/enums.ts';

/**
 * One required, non-empty string per enum value. A `z.object` rather than a `z.record`, so the
 * generated JSON Schema lists every key under `required`. Extra keys are rejected by the catalog
 * test, not by the schema, which stays open like every generated schema.
 */
function keyedBy<const T extends string>(values: readonly T[]) {
  const shape = Object.fromEntries(values.map((value) => [value, z.string().min(1)]));
  return z.object(shape as { [K in T]: z.ZodString });
}

export const MessageCatalog = z.object({
  /** BCP 47 language tag; it matches the file name. */
  locale: z.string().min(1),
  /** One ICU MessageFormat template per rule code. */
  violations: keyedBy(RuleCode.options),
  /** Display text for each value of the closed enums a client shows. */
  labels: z.object({
    experience: keyedBy(Experience.options),
    climate: keyedBy(Climate.options),
    travelMode: keyedBy(TravelMode.options),
    userType: keyedBy(UserType.options),
    verification: keyedBy(Verification.options),
  }),
});
export type MessageCatalog = z.infer<typeof MessageCatalog>;
