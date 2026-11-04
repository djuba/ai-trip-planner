// Public wire contract (CLAUDE.md §4). The web app and backends may import this entry point.
export * from './enums.ts';
export * from './constants.ts';
export * from './trip-profile.ts';
export * from './extraction.ts';
export * from './rule-violation.ts';
export * from './recommendation.ts';
export * from './presentation.ts';
export * from './envelopes.ts';
export { buildFixture } from './build-fixture.ts';
export {
  CONTRACT_SCHEMAS,
  LLM_FACING_IDS,
  contractRegistry,
  type ContractSchemaId,
} from './registry.ts';
