// Public wire contract (CLAUDE.md §4). The web app and backends may import this entry point.
export * from './constants.ts';
export * from './models/enums.ts';
export * from './models/trip-profile.ts';
export * from './models/rule-violation.ts';
export * from './models/recommendation.ts';
export * from './models/presentation.ts';
export * from './http/envelopes.ts';
export * from './llm/extraction.ts';
export * from './llm/recommendation-set.ts';
export {
  CONTRACT_SCHEMAS,
  LLM_FACING_IDS,
  LLM_ONLY_IDS,
  contractRegistry,
  type ContractSchemaId,
} from './registry.ts';
