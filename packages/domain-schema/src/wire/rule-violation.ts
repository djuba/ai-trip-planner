// A business-rule result (CLAUDE.md §4.5). Messages are not part of the contract: clients and the
// clarification prompt render text from `code` + `params`, so `params` is typed per code.
// `path` is a JSON Pointer (RFC 6901) into the profile, e.g. `/people/2/age`; `""` = whole profile.
import { z } from 'zod';

const violation = <C extends string, P extends z.ZodObject>(code: C, params: P) =>
  z.object({ code: z.literal(code), path: z.string(), params });

/** `min` and `max` are inclusive bounds: child 0–17, adult 18–120. */
const ageRange = z.object({ age: z.int(), min: z.int(), max: z.int() });

export const RuleViolation = z.discriminatedUnion('code', [
  violation('CHILD_AGE_RANGE', ageRange),
  violation('ADULT_AGE_RANGE', ageRange),
  violation('DATE_ORDER', z.object({ start: z.string(), end: z.string() })),
  violation(
    'DATE_NOT_PAST',
    z.object({
      /** `YYYY-MM-DD` (fixed start), `YYYY-MM` (flexible month + year) or `YYYY` (year only). */
      value: z.string(),
      referenceDate: z.string(),
    }),
  ),
  /** `value` is the offending date string, flexible month, year or durationNights. */
  violation('DATE_VALID', z.object({ value: z.union([z.string(), z.int()]) })),
  violation('PARTY_HAS_ADULT', z.object({})),
  violation('INSUFFICIENT_DETAIL', z.object({ populated: z.int(), required: z.int() })),
  /** `value` is the offending `departure.maxStops`. */
  violation('MAX_STOPS_RANGE', z.object({ value: z.int() })),
]);
export type RuleViolation = z.infer<typeof RuleViolation>;
