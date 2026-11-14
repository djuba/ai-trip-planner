// Request and response bodies of the v1 HTTP API (CLAUDE.md §5).
import { z } from 'zod';
import {
  MAX_CLARIFICATION_QUESTION_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_RECOMMENDATIONS,
  MAX_UNRESOLVED_ISSUES,
} from '../constants.ts';
import { ErrorCode } from '../models/enums.ts';
import { CritiqueIssue, Recommendation } from '../models/recommendation.ts';
import { RuleViolation } from '../models/rule-violation.ts';
import { TripProfile } from '../models/trip-profile.ts';

/** The client's local date, `YYYY-MM-DD`. Rules compare against it, never the server clock (§4.6). */
const ReferenceDate = z.iso.date();

export const ExtractRequest = z.object({
  message: z.string().min(1).max(MAX_MESSAGE_LENGTH),
  currentProfile: TripProfile.optional(),
  referenceDate: ReferenceDate,
});
export type ExtractRequest = z.infer<typeof ExtractRequest>;

export const ExtractResponse = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('needs_clarification'),
    profile: TripProfile,
    violations: z.array(RuleViolation).min(1),
    clarificationQuestion: z.string().min(1).max(MAX_CLARIFICATION_QUESTION_LENGTH),
  }),
  z.object({ status: z.literal('ready'), profile: TripProfile }),
]);
export type ExtractResponse = z.infer<typeof ExtractResponse>;

/** The profile must be `ready`: one with rule violations is a 422 (§5; WU-10 plan D7). */
export const RecommendRequest = z.object({
  profile: TripProfile,
  referenceDate: ReferenceDate,
});
export type RecommendRequest = z.infer<typeof RecommendRequest>;

/** Critic already applied (§7 stage 2b); `unresolved` is empty when the critic passed. */
export const RecommendResponse = z.object({
  recommendations: z.array(Recommendation).max(MAX_RECOMMENDATIONS),
  critique: z.object({
    pass: z.boolean(),
    unresolved: z.array(CritiqueIssue).max(MAX_UNRESOLVED_ISSUES),
  }),
});
export type RecommendResponse = z.infer<typeof RecommendResponse>;

export const PresentRequest = z.object({
  profile: TripProfile,
  recommendations: z.array(Recommendation).max(MAX_RECOMMENDATIONS),
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
