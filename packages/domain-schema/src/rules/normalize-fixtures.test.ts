// Runs spec/fixtures/normalize/*.json through normalize, and links normalize.md, the fixtures, the
// acceptance criteria and the committed generated/ schemas, so none of them can drift (as
// catalog.test.ts does for the rules). Expectations come from normalize.md: a mismatch is a
// finding, never a reason to edit a case.
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  loadAllNormalizeFixtures,
  normalizeFixtureEntries,
  parseNormalizeFixtureFile,
} from '../../tests/support/normalize-fixtures.ts';
import { normalize } from './index.ts';

const read = (url: string): string =>
  readFileSync(fileURLToPath(new URL(url, import.meta.url)), 'utf8');

const normalizeMd = read('../../../../spec/normalize.md');
const featureDocs = [
  read('../../../../docs/features/input-limits.md'),
  read('../../../../docs/features/trip-validation.md'),
].join('\n');
const generatedDir = fileURLToPath(new URL('../../../../spec/generated/', import.meta.url));

const fixtureFiles = loadAllNormalizeFixtures();
const allCases = fixtureFiles.flatMap(({ name, cases }) =>
  cases.map((c) => ({ file: name, ...c })),
);
const sections = [...normalizeMd.matchAll(/^### (\S+)\s*$/gm)].map((m) => m[1] as string);

describe.each(fixtureFiles)('fixtures/normalize/$name', ({ cases }) => {
  it.each(cases)('$ac: $description', ({ extraction, expectedProfile }) => {
    expect(normalize(extraction).profile).toEqual(expectedProfile);
  });
});

describe('normalize catalog', () => {
  it('normalize.md has a ### section per fixture file, and each names its file', () => {
    expect(sections.length).toBeGreaterThan(0);
    expect(normalizeFixtureEntries()).toEqual(sections.map((s) => `${s}.json`).sort());
    for (const section of sections) {
      expect(normalizeMd).toContain(`**Fixtures:** \`fixtures/normalize/${section}.json\``);
    }
  });

  it('every file has at least one case, and ids are unique across files', () => {
    for (const { name, cases } of fixtureFiles) expect(cases.length, name).toBeGreaterThan(0);
    const ids = allCases.map((c) => c.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  it('every fixture ac is documented in input-limits.md or trip-validation.md', () => {
    const unknown = allCases
      .filter((c) => !featureDocs.includes(`**${c.ac}:**`))
      .map((c) => `${c.id}: ${c.ac}`);
    expect(unknown).toEqual([]);
  });
});

// Under `moduleResolution: bundler` these CJS packages can surface as namespace objects.
interface AjvLike {
  addSchema(schema: object): unknown;
  getSchema(id: string): (((data: unknown) => boolean) & { errors?: unknown }) | undefined;
}
type AjvCtor = new (opts: { strict: boolean; allErrors: boolean }) => AjvLike;
const interop = <T>(m: unknown): T => ((m as { default?: unknown }).default ?? m) as T;

describe('fixtures against the committed generated schemas', () => {
  const ajv = new (interop<AjvCtor>(Ajv2020))({ strict: true, allErrors: true });
  interop<(a: AjvLike) => unknown>(addFormats)(ajv);
  for (const file of readdirSync(generatedDir).filter((f) => f.endsWith('.schema.json'))) {
    ajv.addSchema(JSON.parse(readFileSync(`${generatedDir}${file}`, 'utf8')) as object);
  }
  const validator = (id: string) => {
    const validate = ajv.getSchema(`${id}.schema.json`);
    if (!validate) throw new Error(`no generated schema for ${id}`);
    return validate;
  };

  it.each(allCases)('$file / $id: extraction and expectedProfile validate', (c) => {
    const extraction = validator('ExtractionSchema');
    expect(extraction(c.extraction), JSON.stringify(extraction.errors)).toBe(true);
    const profile = validator('TripProfile');
    expect(profile(c.expectedProfile), JSON.stringify(profile.errors)).toBe(true);
  });
});

describe('normalize fixture loader', () => {
  const valid = {
    id: 'x',
    ac: 'AC-RULES-36',
    description: 'd',
    extraction: {
      departure: null,
      dateRange: null,
      region: null,
      climate: null,
      experiences: null,
      unmappedExperiences: null,
      people: null,
    },
    expectedProfile: {},
  };

  it('accepts a well-formed case', () => {
    expect(parseNormalizeFixtureFile([valid], 'self-test')).toHaveLength(1);
  });

  it('rejects a misspelled key that Zod would otherwise strip silently', () => {
    const typo = { ...valid, expectedProfile: { regoin: 'x' } };
    expect(() => parseNormalizeFixtureFile([typo], 'self-test')).toThrow(/stripped/);
  });

  it('rejects an expected profile over a cap', () => {
    const bad = { ...valid, expectedProfile: { region: 'a'.repeat(101) } };
    expect(() => parseNormalizeFixtureFile([bad], 'self-test')).toThrow(/contract/);
  });
});
