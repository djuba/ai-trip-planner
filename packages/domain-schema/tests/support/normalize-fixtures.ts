// Loader for the language-neutral normalize fixtures in `spec/fixtures/normalize/` (`spec/normalize.md`,
// "Fixture format"). The Zod schema below is test-only: fixtures are not an HTTP payload.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { ExtractionSchema, TripProfile } from '../../src/wire/index.ts';
import { buildFixture } from './build-fixture.ts';

export const NORMALIZE_FIXTURE_DIR = fileURLToPath(
  new URL('../../../../spec/fixtures/normalize/', import.meta.url),
);

export const NormalizeFixtureCase = z.object({
  id: z.string(),
  ac: z.string(),
  description: z.string(),
  extraction: ExtractionSchema,
  expectedProfile: TripProfile,
});
export type NormalizeFixtureCase = z.infer<typeof NormalizeFixtureCase>;

const NormalizeFixtureFile = z.array(NormalizeFixtureCase);

export interface NormalizeFixtureFileData {
  /** File name without the `.json` extension: a `###` section of normalize.md. */
  name: string;
  cases: NormalizeFixtureCase[];
}

/**
 * Parse raw fixture data through the wire schemas. Zod strips unknown keys, so the parsed result
 * must deep-equal the raw data, or a misspelled key would silently test something else.
 */
export function parseNormalizeFixtureFile(raw: unknown, source: string): NormalizeFixtureCase[] {
  const parsed = buildFixture(NormalizeFixtureFile, raw);
  if (!isDeepStrictEqual(parsed, raw)) {
    throw new Error(
      `${source}: parsing changed the fixture data (an unknown or misspelled key was stripped, or a value was coerced)`,
    );
  }
  return parsed;
}

/** Every entry in the fixtures directory, as file names (so stray files are visible to tests). */
export function normalizeFixtureEntries(): string[] {
  return readdirSync(NORMALIZE_FIXTURE_DIR).sort();
}

export function loadAllNormalizeFixtures(): NormalizeFixtureFileData[] {
  return normalizeFixtureEntries()
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .map((name) => {
      const raw = JSON.parse(
        readFileSync(join(NORMALIZE_FIXTURE_DIR, `${name}.json`), 'utf8'),
      ) as unknown;
      return { name, cases: parseNormalizeFixtureFile(raw, `${name}.json`) };
    });
}
