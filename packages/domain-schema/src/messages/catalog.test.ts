// Links the message catalogs (spec/messages/*.json) to the rule codes, the enums, the generated
// RuleViolation schema and the rule fixtures, so the wording can't drift from the rules
// (spec/messages.md; docs/features/message-catalog.md).
import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import Ajv2020 from 'ajv/dist/2020.js';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { IntlMessageFormat } from 'intl-messageformat';
import { describe, expect, it } from 'vitest';
import { loadAllRuleFixtures } from '../../tests/support/rule-fixtures.ts';
import {
  Climate,
  Experience,
  RuleCode,
  TravelMode,
  UserType,
  Verification,
  type RuleViolation,
} from '../wire/index.ts';
import { EN_MESSAGES, MessageCatalog, violationArguments, violationField } from './index.ts';

const messagesDir = fileURLToPath(new URL('../../../../spec/messages/', import.meta.url));
const generatedDir = fileURLToPath(new URL('../../../../spec/generated/', import.meta.url));
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8')) as unknown;

const catalogFiles = readdirSync(messagesDir).filter((f) => f.endsWith('.json'));
const catalogs = catalogFiles.map((file) => ({ file, data: readJson(`${messagesDir}${file}`) }));
const parsedCatalogs = catalogs.map(({ file, data }) => ({
  file,
  catalog: MessageCatalog.parse(data),
}));

// Under `moduleResolution: bundler` this CJS package can surface as a namespace object.
interface AjvLike {
  compile(schema: object): ((data: unknown) => boolean) & { errors?: unknown };
}
type AjvCtor = new (opts: { strict: boolean; allErrors: boolean }) => AjvLike;
const interop = <T>(m: unknown): T => ((m as { default?: unknown }).default ?? m) as T;
const ajv = new (interop<AjvCtor>(Ajv2020))({ strict: true, allErrors: true });

/** Each rule code's `params` property names, read from the generated (language-neutral) schema. */
function paramsByCode(): Map<string, string[]> {
  const schema = readJson(`${generatedDir}RuleViolation.schema.json`) as {
    oneOf: {
      properties: {
        code: { const: string };
        params: { properties?: Record<string, unknown> };
      };
    }[];
  };
  return new Map(
    schema.oneOf.map((branch) => [
      branch.properties.code.const,
      Object.keys(branch.properties.params.properties ?? {}),
    ]),
  );
}
const PARAMS = paramsByCode();

/** `field` is the one derived argument any template may use (spec/messages.md, Arguments). */
const DERIVED_ARGUMENTS = ['field'];

/** A `'` next to `{` or `}`, which ICU reads as quoting the brace (spec/messages.md, Syntax). */
const APOSTROPHE_BY_BRACE = /'[{}]|[{}]'/;

/** Every element type a template may contain: the portable subset (spec/messages.md, Syntax). */
const ALLOWED_TYPES = new Set([TYPE.literal, TYPE.argument, TYPE.select]);

function walk(elements: MessageFormatElement[], visit: (e: MessageFormatElement) => void): void {
  for (const element of elements) {
    visit(element);
    if (element.type === TYPE.select || element.type === TYPE.plural) {
      for (const option of Object.values(element.options)) walk(option.value, visit);
    }
    if (element.type === TYPE.tag) walk(element.children, visit);
  }
}

function argumentNames(template: string): Set<string> {
  const names = new Set<string>();
  walk(parse(template), (e) => {
    if (e.type === TYPE.argument || e.type === TYPE.select) names.add(e.value);
  });
  return names;
}

/** The simple arguments the formatted text shows for these values, following each `select`. */
function shownArguments(elements: MessageFormatElement[], args: Record<string, string>): string[] {
  const shown: string[] = [];
  for (const e of elements) {
    if (e.type === TYPE.argument) shown.push(e.value);
    if (e.type === TYPE.select) {
      const branch = e.options[args[e.value] ?? ''] ?? e.options.other;
      if (branch) shown.push(...shownArguments(branch.value, args));
    }
  }
  return shown;
}

function format(template: string, locale: string, args: Record<string, string>): string {
  const out = new IntlMessageFormat(template, locale).format(args);
  if (typeof out !== 'string') throw new Error('a template formatted to rich text');
  return out;
}

describe('AC-MSG-01: every catalog file has the MessageCatalog shape', () => {
  const validate = ajv.compile(readJson(`${generatedDir}MessageCatalog.schema.json`) as object);

  it('finds at least the English catalog', () => {
    expect(catalogFiles).toContain('en.json');
  });

  it.each(catalogs)(
    '$file passes MessageCatalog.schema.json, and its locale names it',
    ({ file, data }) => {
      expect(validate(data), JSON.stringify(validate.errors)).toBe(true);
      expect((data as { locale: string }).locale).toBe(file.replace(/\.json$/, ''));
    },
  );

  it('EN_MESSAGES is the parsed spec/messages/en.json', () => {
    expect(EN_MESSAGES).toEqual(readJson(`${messagesDir}en.json`));
  });
});

describe('AC-MSG-02: one entry per rule code and enum value, and no extra keys', () => {
  it.each(catalogs)('$file', ({ data }) => {
    const raw = data as {
      violations: object;
      labels: Record<string, object>;
    } & Record<string, unknown>;
    expect(Object.keys(raw).sort()).toEqual(['labels', 'locale', 'violations']);
    expect(Object.keys(raw.violations).sort()).toEqual([...RuleCode.options].sort());
    expect(Object.keys(raw.labels).sort()).toEqual([
      'climate',
      'experience',
      'travelMode',
      'userType',
      'verification',
    ]);
    expect(Object.keys(raw.labels.experience ?? {}).sort()).toEqual([...Experience.options].sort());
    expect(Object.keys(raw.labels.climate ?? {}).sort()).toEqual([...Climate.options].sort());
    expect(Object.keys(raw.labels.travelMode ?? {}).sort()).toEqual([...TravelMode.options].sort());
    expect(Object.keys(raw.labels.userType ?? {}).sort()).toEqual([...UserType.options].sort());
    expect(Object.keys(raw.labels.verification ?? {}).sort()).toEqual(
      [...Verification.options].sort(),
    );
  });

  it('every rule code in the generated schema has its params listed', () => {
    expect([...PARAMS.keys()].sort()).toEqual([...RuleCode.options].sort());
  });
});

describe('AC-MSG-03: templates use only the portable subset and real arguments', () => {
  const templates = parsedCatalogs.flatMap(({ file, catalog }) =>
    RuleCode.options.map((code) => ({ file, code, template: catalog.violations[code] })),
  );

  it.each(templates)(
    '$file $code parses and uses only literals, arguments and select',
    ({ template }) => {
      walk(parse(template), (e) => {
        expect(ALLOWED_TYPES.has(e.type), `element type ${TYPE[e.type]}`).toBe(true);
        if (e.type === TYPE.select) expect(Object.keys(e.options)).toContain('other');
      });
    },
  );

  it.each(templates)('$file $code has no apostrophe next to a brace', ({ template }) => {
    expect(template).not.toMatch(APOSTROPHE_BY_BRACE);
  });

  it.each(templates)('$file $code uses only its params and field', ({ code, template }) => {
    const allowed = new Set([...(PARAMS.get(code) ?? []), ...DERIVED_ARGUMENTS]);
    for (const name of argumentNames(template)) {
      expect(allowed.has(name), `${code} uses {${name}}`).toBe(true);
    }
  });

  const labels = parsedCatalogs.flatMap(({ file, catalog }) =>
    Object.entries(catalog.labels).flatMap(([kind, values]) =>
      Object.entries(values).map(([value, text]) => ({ file, key: `${kind}.${value}`, text })),
    ),
  );

  it.each(labels)('$file label $key is plain text', ({ text }) => {
    const elements = parse(text);
    expect(elements.every((e) => e.type === TYPE.literal)).toBe(true);
    expect(text).not.toMatch(APOSTROPHE_BY_BRACE);
  });

  it('flags an apostrophe that would quote a brace (self-test)', () => {
    expect("it'{x}").toMatch(APOSTROPHE_BY_BRACE);
    expect("{x}'s").toMatch(APOSTROPHE_BY_BRACE);
    expect("isn't {x}").not.toMatch(APOSTROPHE_BY_BRACE);
  });

  it('rejects what the subset forbids (self-test of the checks)', () => {
    const types = (t: string) => {
      const seen: TYPE[] = [];
      walk(parse(t), (e) => seen.push(e.type));
      return seen;
    };
    expect(types('{n, plural, one {#} other {#}}')).toContain(TYPE.plural);
    expect(types('<b>x</b>')).toContain(TYPE.tag);
    expect(types('{n, number}')).toContain(TYPE.number);
    expect([...argumentNames('{a} {b, select, x {{c}} other {}}')].sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('AC-MSG-04: every rule fixture violation formats to text that shows its values', () => {
  const fromFixtures = loadAllRuleFixtures().flatMap(({ cases }) =>
    cases.flatMap((c) => c.expectedViolations.map((v) => ({ id: c.id, violation: v }))),
  );
  // DATE_VALID fields the fixtures don't reach, so every `field` branch is formatted (review fix 1).
  const extra: { id: string; violation: RuleViolation }[] = [
    {
      id: 'synthetic: invalid start',
      violation: { code: 'DATE_VALID', path: '/dateRange/start', params: { value: '2027-02-30' } },
    },
    {
      id: 'synthetic: zero nights',
      violation: { code: 'DATE_VALID', path: '/dateRange/durationNights', params: { value: 0 } },
    },
  ];
  const cases = parsedCatalogs.flatMap(({ file, catalog }) =>
    [...fromFixtures, ...extra].map((c) => ({ file, catalog, ...c })),
  );

  it.each(cases)('$file $id: $violation.code at "$violation.path"', ({ catalog, violation }) => {
    const template = catalog.violations[violation.code];
    const args = violationArguments(violation);
    const text = format(template, catalog.locale, args);
    expect(text.trim()).not.toBe('');
    for (const name of shownArguments(parse(template), args)) {
      expect(text, `{${name}}`).toContain(args[name]);
    }
  });

  it('reaches a distinct DATE_VALID wording for every date field', () => {
    const fields = ['start', 'end', 'month', 'year', 'durationNights'];
    const texts = fields.map((field) =>
      format(EN_MESSAGES.violations.DATE_VALID, 'en', { field, value: 'X' }),
    );
    expect(new Set(texts).size).toBe(fields.length);
    expect(texts).not.toContain(
      format(EN_MESSAGES.violations.DATE_VALID, 'en', { field: '', value: 'X' }),
    );
  });

  it('shows a year of 1000 or more without digit grouping (review fix 5)', () => {
    const text = format(
      EN_MESSAGES.violations.DATE_VALID,
      'en',
      violationArguments({ code: 'DATE_VALID', path: '/dateRange/year', params: { value: 2101 } }),
    );
    expect(text).toContain('2101');
  });
});

describe('violationField (spec/messages.md, Arguments)', () => {
  it.each([
    ['', ''],
    ['/people', 'people'],
    ['/people/2/age', 'age'],
    ['/dateRange/month', 'month'],
    ['/a~1b', 'a/b'],
    ['/a~0b', 'a~b'],
    ['/a~01', 'a~1'],
  ])('%j → %j', (path, field) => {
    expect(violationField(path)).toBe(field);
  });

  it('passes every param as a string, plus field', () => {
    expect(
      violationArguments({
        code: 'CHILD_AGE_RANGE',
        path: '/people/0/age',
        params: { age: 19, min: 0, max: 17 },
      }),
    ).toEqual({ field: 'age', age: '19', min: '0', max: '17' });
  });
});
