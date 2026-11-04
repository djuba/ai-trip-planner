// Every named contract schema, by id. `gen` emits one `generated/<id>.schema.json` per entry, plus
// the OpenAPI `components.schemas`. A private registry keeps anything else out of `generated/`.
import { z } from 'zod';
import * as enums from './enums.ts';
import * as envelopes from './envelopes.ts';
import { ExtractionSchema } from './extraction.ts';
import { PresentationCard, PresentationModel } from './presentation.ts';
import {
  CritiqueIssue,
  FactualClaim,
  Recommendation,
  RecommendationSet,
} from './recommendation.ts';
import { RuleViolation } from './rule-violation.ts';
import { DateRange, Departure, TripProfile, Traveler } from './trip-profile.ts';

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
