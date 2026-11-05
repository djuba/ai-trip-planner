// Every named contract schema, by id. `gen` emits one `generated/<id>.schema.json` per entry, plus
// the OpenAPI `components.schemas`. A private registry keeps anything else out of `generated/`.
import { z } from 'zod';
import * as envelopes from './http/envelopes.ts';
import { ExtractionSchema } from './llm/extraction.ts';
import { RecommendationSet } from './llm/recommendation-set.ts';
import * as enums from './models/enums.ts';
import { PresentationCard, PresentationModel } from './models/presentation.ts';
import { CritiqueIssue, FactualClaim, Recommendation } from './models/recommendation.ts';
import { RuleViolation } from './models/rule-violation.ts';
import { DateRange, Departure, TripProfile, Traveler } from './models/trip-profile.ts';

/** Registration order is emission order; keep it stable so `generated/` diffs stay small. */
export const CONTRACT_SCHEMAS = {
  Experience: enums.Experience,
  Climate: enums.Climate,
  UserType: enums.UserType,
  TravelMode: enums.TravelMode,
  RuleCode: enums.RuleCode,
  ErrorCode: enums.ErrorCode,
  ClaimKind: enums.ClaimKind,
  Verification: enums.Verification,
  BackendName: enums.BackendName,
  Departure,
  Traveler,
  DateRange,
  TripProfile,
  ExtractionSchema,
  RuleViolation,
  FactualClaim,
  Recommendation,
  RecommendationSet,
  CritiqueIssue,
  PresentationCard,
  PresentationModel,
  ExtractRequest: envelopes.ExtractRequest,
  ExtractResponse: envelopes.ExtractResponse,
  RecommendRequest: envelopes.RecommendRequest,
  RecommendResponse: envelopes.RecommendResponse,
  PresentRequest: envelopes.PresentRequest,
  HealthResponse: envelopes.HealthResponse,
  ErrorResponse: envelopes.ErrorResponse,
} as const satisfies Record<string, z.ZodType>;

export type ContractSchemaId = keyof typeof CONTRACT_SCHEMAS;

export const contractRegistry = z.registry<{ id: string }>();
for (const [id, schema] of Object.entries(CONTRACT_SCHEMAS)) {
  contractRegistry.add(schema, { id });
}

/** Schemas a model fills in: restricted to ADR 0001 Q3 constructs (CLAUDE.md §4.4). */
export const LLM_FACING_IDS = [
  'ExtractionSchema',
  'RecommendationSet',
  'PresentationModel',
] as const satisfies readonly ContractSchemaId[];

/**
 * Schemas only a model fills in. They never cross HTTP, so they stay out of `openapi.yaml`, but
 * still get a `generated/<id>.schema.json` because every backend gives them to its model.
 */
export const LLM_ONLY_IDS = [
  'ExtractionSchema',
  'RecommendationSet',
] as const satisfies readonly ContractSchemaId[];
