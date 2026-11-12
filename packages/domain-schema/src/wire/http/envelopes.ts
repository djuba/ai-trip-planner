// Request and response bodies of the v1 HTTP API (CLAUDE.md §5).
import { z } from 'zod';
import { ErrorCode } from '../models/enums.ts';
import { CritiqueIssue, Recommendation } from '../models/recommendation.ts';
import { RuleViolation } from '../models/rule-violation.ts';
import { TripProfile } from '../models/trip-profile.ts';

/** The client's local date, `YYYY-MM-DD`. Rules compare against it, never the server clock (§4.6). */
const ReferenceDate = z.iso.date();

export const ExtractRequest = z.object({
  message: z.string().min(1),
  currentProfile: TripProfile.optional(),
  referenceDate: ReferenceDate,
});
export type ExtractRequest = z.infer<typeof ExtractRequest>;

export const ExtractResponse = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('needs_clarification'),
    profile: TripProfile,
    violations: z.array(RuleViolation).min(1),
    clarificationQuestion: z.string().min(1),
  }),
  z.object({ status: z.literal('ready'), profile: TripProfile }),
]);
export type ExtractResponse = z.infer<typeof ExtractResponse>;

export const RecommendRequest = z.object({
  profile: TripProfile,
  referenceDate: ReferenceDate,
});
export type RecommendRequest = z.infer<typeof RecommendRequest>;

/** Critic already applied (§7 stage 2b); `unresolved` is empty when the critic passed. */
export const RecommendResponse = z.object({
  recommendations: z.array(Recommendation),
  critique: z.object({ pass: z.boolean(), unresolved: z.array(CritiqueIssue) }),
});
export type RecommendResponse = z.infer<typeof RecommendResponse>;

export const PresentRequest = z.object({
  profile: TripProfile,
  recommendations: z.array(Recommendation),
});
export type PresentRequest = z.infer<typeof PresentRequest>;

export const HealthResponse = z.object({
  status: z.literal('ok'),
  contractVersion: z.string().min(1),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

/** Body of every 413, 422, 502 and 500. `message` is for people and logs, not for branching. */
export const ErrorResponse = z.object({
  error: z.object({ code: ErrorCode, message: z.string() }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;
