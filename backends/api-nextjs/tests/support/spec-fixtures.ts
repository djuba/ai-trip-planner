// Reads the language-neutral fixtures in spec/fixtures/ as plain files (CLAUDE.md §4, WU-09 plan
// D7): no import from packages/domain-schema/tests or src/rules.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildFixture } from '@vp/domain-schema/testing';
import { ExtractionSchema, RuleViolation, TripProfile } from '@vp/domain-schema/wire';
import { z } from 'zod';

const FIXTURES_DIR = fileURLToPath(new URL('../../../../spec/fixtures/', import.meta.url));

const RuleCase = z.object({
  id: z.string(),
  ac: z.string(),
  description: z.string(),
  referenceDate: z.string(),
  profile: TripProfile,
  expectedViolations: z.array(RuleViolation),
});
export type RuleCase = z.infer<typeof RuleCase>;

const NormalizeCase = z.object({
  id: z.string(),
  ac: z.string(),
  description: z.string(),
  extraction: ExtractionSchema,
  expectedProfile: TripProfile,
});
export type NormalizeCase = z.infer<typeof NormalizeCase>;

export interface FixtureFile<C> {
  name: string;
  cases: C[];
}

function load<S extends z.ZodType>(dir: string, schema: S): FixtureFile<z.output<S>>[] {
  const root = `${FIXTURES_DIR}${dir}/`;
  return readdirSync(root)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => ({
      name: file.slice(0, -'.json'.length),
      cases: buildFixture(z.array(schema), JSON.parse(readFileSync(`${root}${file}`, 'utf8'))),
    }));
}

export const loadRuleFixtures = (): FixtureFile<RuleCase>[] => load('rules', RuleCase);
export const loadNormalizeFixtures = (): FixtureFile<NormalizeCase>[] =>
  load('normalize', NormalizeCase);
