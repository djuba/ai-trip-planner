// Links the prose catalog (rules.md), RuleCode, the fixtures, the acceptance criteria and the
// committed generated/ schemas, so none of them can drift from the others.
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  loadAllRuleFixtures,
  parseRuleFixtureFile,
  ruleFixtureEntries,
} from '../../tests/support/rule-fixtures.ts';
import { RuleCode } from '../wire/index.ts';

const read = (url: string): string =>
  readFileSync(fileURLToPath(new URL(url, import.meta.url)), 'utf8');

const rulesMd = read('../../../../spec/rules.md');
const validationMd = read('../../../../docs/features/trip-validation.md');
const generatedDir = fileURLToPath(new URL('../../../../spec/generated/', import.meta.url));
const rulesDir = fileURLToPath(new URL('./', import.meta.url));

const fixtureFiles = loadAllRuleFixtures();
const allCases = fixtureFiles.flatMap(({ name, cases }) =>
  cases.map((c) => ({ file: name, ...c })),
);

// Under `moduleResolution: bundler` these CJS packages can surface as namespace objects.
interface AjvLike {
  addSchema(schema: object): unknown;
  getSchema(id: string): (((data: unknown) => boolean) & { errors?: unknown }) | undefined;
}
type AjvCtor = new (opts: { strict: boolean; allErrors: boolean }) => AjvLike;
const interop = <T>(m: unknown): T => ((m as { default?: unknown }).default ?? m) as T;

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

describe('rule catalog', () => {
  it('rules.md has one ### heading per RuleCode, in order', () => {
    const headings = [...rulesMd.matchAll(/^### (\S+)\s*$/gm)].map((m) => m[1]);
    expect(headings).toEqual([...RuleCode.options]);
  });

  it('every code has a fixture file and no unexpected files exist', () => {
    const expected = [...RuleCode.options.map((c) => `${c}.json`), '_multiple.json'].sort();
    expect(ruleFixtureEntries()).toEqual(expected);
  });

  describe.each(RuleCode.options)('%s fixtures', (code) => {
    const cases = fixtureFiles.find((f) => f.name === code)?.cases ?? [];

    it('has a case where the code fires', () => {
      expect(cases.some((c) => c.expectedViolations.some((v) => v.code === code))).toBe(true);
    });

    it('has a case where the code does not fire', () => {
      expect(cases.some((c) => c.expectedViolations.every((v) => v.code !== code))).toBe(true);
    });
  });

  it('fixture ids are unique across all files', () => {
    const ids = allCases.map((c) => c.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });
});

describe('acceptance criteria traceability', () => {
  const documented = [...validationMd.matchAll(/\*\*(AC-RULES-\d+):\*\*/g)].map(
    (m) => m[1] as string,
  );

  it('every fixture ac exists in trip-validation.md', () => {
    const unknown = allCases
      .filter((c) => !documented.includes(c.ac))
      .map((c) => `${c.id}: ${c.ac}`);
    expect(unknown).toEqual([]);
  });

  it('every documented AC appears in a fixture or in a unit test title', () => {
    const fromFixtures = new Set(allCases.map((c) => c.ac));
    const fromTitles = new Set<string>();
    for (const file of readdirSync(rulesDir).filter((f) => f.endsWith('.test.ts'))) {
      const source = readFileSync(`${rulesDir}${file}`, 'utf8');
      for (const m of source.matchAll(/\bit\(\s*['"`](AC-RULES-\d+)/g))
        fromTitles.add(m[1] as string);
    }
    const missing = documented.filter((ac) => !fromFixtures.has(ac) && !fromTitles.has(ac));
    expect(missing).toEqual([]);
  });
});

describe('fixtures against the committed generated schemas', () => {
  it.each(allCases)('$file / $id: request and expected violations validate', (c) => {
    const request = validator('RecommendRequest');
    expect(
      request({ profile: c.profile, referenceDate: c.referenceDate }),
      JSON.stringify(request.errors),
    ).toBe(true);
    const violation = validator('RuleViolation');
    for (const v of c.expectedViolations) {
      expect(violation(v), JSON.stringify(violation.errors)).toBe(true);
    }
  });
});

describe('fixture loader', () => {
  const valid = {
    id: 'x',
    ac: 'AC-RULES-01',
    description: 'd',
    referenceDate: '2027-03-01',
    profile: { people: [{ userType: 'adult', age: 18 }] },
    expectedViolations: [],
  };

  it('accepts a well-formed case', () => {
    expect(parseRuleFixtureFile([valid], 'self-test')).toHaveLength(1);
  });

  it('rejects a misspelled key that Zod would otherwise strip silently', () => {
    const typo = { ...valid, profile: { people: [{ userType: 'adult', agee: 18 }] } };
    expect(() => parseRuleFixtureFile([typo], 'self-test')).toThrow(/stripped/);
  });

  it('rejects a case that does not match the wire schema', () => {
    const bad = { ...valid, expectedViolations: [{ code: 'NOPE', path: '', params: {} }] };
    expect(() => parseRuleFixtureFile([bad], 'self-test')).toThrow(/contract/);
  });
});
