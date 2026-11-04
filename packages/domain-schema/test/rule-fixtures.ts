// Loader for the language-neutral rule fixtures in `fixtures/rules/` (rules.md, "Fixture format").
// The Zod schema below is test-only: fixtures are not an HTTP payload, so it is not contract surface.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { buildFixture, RuleViolation, TripProfile } from '../src/wire/index.ts';

export const RULE_FIXTURE_DIR = fileURLToPath(new URL('../fixtures/rules/', import.meta.url));

export const RuleFixtureCase = z.object({
  id: z.string(),
  ac: z.string(),
  description: z.string(),
  referenceDate: z.string(),
  profile: TripProfile,
  expectedViolations: z.array(RuleViolation),
});
export type RuleFixtureCase = z.infer<typeof RuleFixtureCase>;

const RuleFixtureFile = z.array(RuleFixtureCase);

export interface RuleFixtureFileData {
  /** File name without the `.json` extension: a rule code or `_multiple`. */
  name: string;
  cases: RuleFixtureCase[];
}

/**
 * Parse raw fixture data through the wire schemas. Zod strips unknown keys, so a typo such as
 * `agee` would otherwise vanish and the case would silently test something else (plan A5):
 * the parsed result must deep-equal the raw data.
 */
export function parseRuleFixtureFile(raw: unknown, source: string): RuleFixtureCase[] {
  const parsed = buildFixture(RuleFixtureFile, raw);
  if (!isDeepStrictEqual(parsed, raw)) {
    throw new Error(
      `${source}: parsing changed the fixture data (an unknown or misspelled key was stripped, or a value was coerced)`,
    );
  }
  return parsed;
}

export function loadRuleFixtureFile(name: string): RuleFixtureCase[] {
  const path = join(RULE_FIXTURE_DIR, `${name}.json`);
  return parseRuleFixtureFile(JSON.parse(readFileSync(path, 'utf8')) as unknown, `${name}.json`);
}

/** Every entry in the fixtures directory, as file names (so stray files are visible to tests). */
export function ruleFixtureEntries(): string[] {
  return readdirSync(RULE_FIXTURE_DIR).sort();
}

export function loadAllRuleFixtures(): RuleFixtureFileData[] {
  return ruleFixtureEntries()
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .map((name) => ({ name, cases: loadRuleFixtureFile(name) }));
}
