// Language-neutral contract artifacts, read from disk as JSON (plan D2). The suite never imports
// TypeScript from apps/, backends/ or packages/, so it judges any backend the same way.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const GENERATED_DIR = fileURLToPath(new URL('../../../spec/generated/', import.meta.url));
export const PACTS_DIR = fileURLToPath(new URL('../../../contracts/pacts/', import.meta.url));

export const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

export interface ContractConstants {
  contractVersion: string;
  minPopulatedFields: number;
  maxRequestBodyBytes: number;
  maxMessageLength: number;
  maxShortTextLength: number;
  maxPeople: number;
}

export function loadConstants(): ContractConstants {
  const raw = readJson(`${GENERATED_DIR}constants.json`) as Partial<ContractConstants>;
  const {
    contractVersion,
    minPopulatedFields,
    maxRequestBodyBytes,
    maxMessageLength,
    maxShortTextLength,
    maxPeople,
  } = raw;
  if (
    typeof contractVersion !== 'string' ||
    typeof minPopulatedFields !== 'number' ||
    typeof maxRequestBodyBytes !== 'number' ||
    typeof maxMessageLength !== 'number' ||
    typeof maxShortTextLength !== 'number' ||
    typeof maxPeople !== 'number'
  ) {
    throw new Error('generated/constants.json is missing a contract constant');
  }
  return {
    contractVersion,
    minPopulatedFields,
    maxRequestBodyBytes,
    maxMessageLength,
    maxShortTextLength,
    maxPeople,
  };
}

/** Every `generated/*.schema.json`, parsed. */
export function loadSchemaFiles(): Record<string, unknown>[] {
  return readdirSync(GENERATED_DIR)
    .filter((name) => name.endsWith('.schema.json'))
    .sort()
    .map((name) => readJson(`${GENERATED_DIR}${name}`) as Record<string, unknown>);
}

/** The pact files the web consumer tests write (WU-12). */
export function listPactFiles(): string[] {
  try {
    return readdirSync(PACTS_DIR)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => `${PACTS_DIR}${name}`);
  } catch {
    return [];
  }
}

/** The backend under test. The runner sets it (scripts/run-contract.ts); `pnpm dev` otherwise. */
export const targetUrl = (): string =>
  (process.env.CONTRACT_TARGET_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

/** The origin the backend under test allows (CLAUDE.md §5 default). */
export const webOrigin = (): string => process.env.WEB_ORIGIN ?? 'http://localhost:3000';
