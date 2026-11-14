// Closed enums of the contract (CLAUDE.md §4.3). Adding a value is a `feat(domain-schema)`;
// removing or renaming one is a breaking change.
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
export const Experience = z.enum(EXPERIENCES);
export type Experience = z.infer<typeof Experience>;

export const Climate = z.enum(['tropical', 'warm', 'temperate', 'cool', 'cold']);
export type Climate = z.infer<typeof Climate>;

export const UserType = z.enum(['adult', 'child']);
export type UserType = z.infer<typeof UserType>;

export const TravelMode = z.enum(['plane', 'car', 'train']);
export type TravelMode = z.infer<typeof TravelMode>;

/** Invariant codes (§4.6). `rules.md` defines each one. */
export const RuleCode = z.enum([
  'CHILD_AGE_RANGE',
  'ADULT_AGE_RANGE',
  'DATE_ORDER',
  'DATE_NOT_PAST',
  'DATE_VALID',
  'PARTY_HAS_ADULT',
  'INSUFFICIENT_DETAIL',
  'MAX_STOPS_RANGE',
]);
export type RuleCode = z.infer<typeof RuleCode>;

/**
 * Error envelope codes (§5): 401 → UNAUTHORIZED; 429 → RATE_LIMITED or QUOTA_EXHAUSTED;
 * 413 → PAYLOAD_TOO_LARGE; 422 → VALIDATION_FAILED; 502 → LLM_*; 500 → INTERNAL_ERROR.
 */
export const ErrorCode = z.enum([
  'UNAUTHORIZED',
  'RATE_LIMITED',
  'QUOTA_EXHAUSTED',
  'PAYLOAD_TOO_LARGE',
  'VALIDATION_FAILED',
  'LLM_REFUSAL',
  'LLM_UPSTREAM_ERROR',
  'INTERNAL_ERROR',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ClaimKind = z.enum(['flight', 'lodging', 'price', 'activity', 'other']);
export type ClaimKind = z.infer<typeof ClaimKind>;

/** §7 factual honesty: there is no live data source, so a claim is unverified or fixture-backed. */
export const Verification = z.enum(['unverified', 'fixture']);
export type Verification = z.infer<typeof Verification>;
